// Plugin state for the workspace: the plugin list, their details, the running job, and the view overlay.
// Without a plugin host (or with no plugins), the hooks give empty values and no controls show.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PluginHost, PluginInfo } from "../../io/backend";
import { defaultOptions, isValidOption, readDetails, readProgress, transformTexts, type PluginDetails } from "../../io/plugins";
import { replaceItemTexts } from "../../core/actions";
import { protectText, restoreText, skipsAny } from "./translateSkip";
import type { Id } from "../../core/types";
import { useRunCommand, useSession, useSessionState } from "../app/sessionContext";
import { isFresh, optionsKeyOf, runTransform, withResults, withShown, type Overlay, type OverlayMap } from "./overlay";

export type PluginHostValue = { host: PluginHost; chooseFolder(): Promise<string | null> };

/** The plugin host, or null. */
export function usePluginHost(): PluginHostValue | null {
  return useContext(PluginHostContext);
}

const PluginHostContext = createContext<PluginHostValue | null>(null);
export const PluginHostProvider = PluginHostContext.Provider;

/** The job that runs now. `done` and `total` count texts. */
export type PluginJob = { plugin: string; kind: "transform" | "action"; done: number; total: number; label: string };

export type Plugin = PluginInfo & { details: PluginDetails | null; error: string | null };

export type PluginsValue = {
  available: boolean;
  plugins: Plugin[];
  folder: string | null;
  reload(): Promise<void>;
  chooseFolder(): Promise<void>;
  /**
   * The plugin host for "transform" calls of the app: with "Do not translate" (Settings), the skipped parts go to the
   * plugin as markers and come back as they were. Null without a host.
   */
  transformHost: PluginHost | null;
  /** A key of the plugin options and the "Do not translate" choices: a result with a different key is old. */
  resultKey(plugin: string): string;
  /** The option values that the user selected, per plugin. */
  optionsOf(plugin: string): Record<string, string>;
  setOption(plugin: string, key: string, value: string): void;
  job: PluginJob | null;
  error: string | null;
  transform(plugin: string, ids: readonly Id[]): Promise<void>;
  /**
   * Capability "convert-text": the plugin result replaces the names and texts of the items in the vault
   * (for example Simplified ↔ Traditional Chinese). One command: undo gives the texts back.
   */
  convert(plugin: string, ids: readonly Id[]): Promise<void>;
  /**
   * Transforms a list of texts that are not items (for example the paragraphs of a saved web page), in parts.
   * `onPart` gets each part as it comes. Progress and Cancel show as for items. Returns false if it stopped early.
   */
  transformList(plugin: string, texts: readonly string[], onPart: (start: number, results: string[], partial?: boolean) => void): Promise<boolean>;
  /** A long call with progress in `job`. An error goes to `error` (and undefined returns), or with `throws` to the caller. */
  callWithProgress(plugin: string, method: string, params: unknown, throws?: boolean): Promise<unknown>;
  setError(error: string | null): void;
  runAction(plugin: string, action: string): Promise<void>;
  cancel(): void;
  /** All overlays, shown and hidden (the cache). */
  overlay: OverlayMap;
  /** Hides overlays: the originals show. The overlays stay as a cache. */
  showOriginal(ids: readonly Id[] | "all"): void;
  /** Shows the cached overlays again: of some items, or of all items of a plugin. */
  showTransformed(ids: readonly Id[] | { plugin: string }): void;
};

const PluginsContext = createContext<PluginsValue | null>(null);

export function usePlugins(): PluginsValue {
  const value = useContext(PluginsContext);
  if (value === null) throw new Error("usePlugins() needs a PluginsProvider.");
  return value;
}

/** The overlay of one item, if it shows. */
export function useOverlay(id: Id): Overlay | undefined {
  const overlay = useContext(PluginsContext)?.overlay.get(id);
  return overlay?.shown === true ? overlay : undefined;
}

/** The cached overlay of one item that does not show now (the original shows), or undefined. */
export function useHiddenOverlay(id: Id): Overlay | undefined {
  const overlay = useContext(PluginsContext)?.overlay.get(id);
  return overlay !== undefined && !overlay.shown ? overlay : undefined;
}

export function PluginsProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const hostValue = useContext(PluginHostContext);
  // Option values are vault settings: they stay after a restart.
  const options = useSessionState().settings.pluginOptions;
  const rawHost = hostValue?.host ?? null;
  const skip = useSessionState().settings.translateSkip;
  const skipRef = useRef(skip);
  skipRef.current = skip;
  /** The skipped parts of each text of the running transform call, by plugin (for partial results too). */
  const protectedParts = useRef(new Map<string, string[][]>());
  const pluginsRef = useRef<Plugin[]>([]);
  const host = useMemo<PluginHost | null>(() => {
    if (rawHost === null) return null;
    const isTranslator = (name: string) => pluginsRef.current.find((plugin) => plugin.name === name)?.capabilities.includes("transform-text") === true;
    return {
      folder: () => rawHost.folder(),
      setFolder: (path) => rawHost.setFolder(path),
      list: () => rawHost.list(),
      onProgress: (listener) => rawHost.onProgress(listener),
      chooseSaveFile: (name, extensions) => rawHost.chooseSaveFile(name, extensions),
      showSubtitle: rawHost.showSubtitle === undefined ? undefined : (text) => rawHost.showSubtitle!(text),
      call: async (name, method, params) => {
        const record = params as { texts?: unknown } | null;
        if (method !== "transform" || !isTranslator(name) || !skipsAny(skipRef.current) || !Array.isArray(record?.texts)) return rawHost.call(name, method, params);
        const done = (record.texts as unknown[]).map((text) => protectText(typeof text === "string" ? text : "", skipRef.current));
        protectedParts.current.set(name, done.map((entry) => entry.parts));
        try {
          const reply = (await rawHost.call(name, method, { ...record, texts: done.map((entry) => entry.text) })) as { texts?: unknown } | null;
          if (!Array.isArray(reply?.texts)) return reply;
          return { ...reply, texts: reply.texts.map((text, index) => (typeof text === "string" ? restoreText(text, done[index]?.parts ?? []) : text)) };
        } finally {
          protectedParts.current.delete(name);
        }
      },
    };
  }, [rawHost]);
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  pluginsRef.current = plugins;
  const [folder, setFolder] = useState<string | null>(null);
  const [job, setJob] = useState<PluginJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<OverlayMap>(new Map());
  const cancelled = useRef(false);
  /** The running transform call: the texts of the call get partial results from progress notes. */
  const currentCall = useRef<{ plugin: string; optionsKey: string; slots: { id: Id; field: "title" | "body" }[]; sources: string[] } | null>(null);
  /** The running list call (transformList): each finished text of the call shows at once. */
  const listCall = useRef<{ plugin: string; start: number; onPart(start: number, results: string[], partial?: boolean): void } | null>(null);
  /** Texts done before the current plugin call. Progress notes count inside the call. */
  const base = useRef(0);

  const loadDetails = useCallback(
    async (info: PluginInfo): Promise<Plugin> => {
      if (host === null || info.problem !== null) return { ...info, details: null, error: info.problem };
      try {
        return { ...info, details: readDetails(await host.call(info.name, "info", {}), info.title), error: null };
      } catch (problem) {
        return { ...info, details: null, error: String(problem) };
      }
    },
    [host],
  );

  const reload = useCallback(async () => {
    if (host === null) return;
    setFolder(await host.folder());
    const list = await host.list();
    setPlugins(await Promise.all(list.map(loadDetails)));
  }, [host, loadDetails]);

  /** Reads the details of one plugin again, for example after an action changed its state. */
  const refresh = useCallback(
    async (name: string) => {
      const info = plugins.find((plugin) => plugin.name === name);
      if (info === undefined) return;
      const updated = await loadDetails(info);
      setPlugins((current) => current.map((plugin) => (plugin.name === name ? updated : plugin)));
    },
    [plugins, loadDetails],
  );

  useEffect(() => {
    void reload().catch((problem: unknown) => setError(String(problem)));
  }, [reload]);

  useEffect(() => {
    if (host === null) return;
    const stop = host.onProgress((plugin, params) => {
      const progress = readProgress(params);
      if (progress === null) return;
      const call = currentCall.current;
      const list = listCall.current;
      // A partial result has the markers of "Do not translate": give the parts back.
      if (progress.partial !== null) progress.partial.text = restoreText(progress.partial.text, protectedParts.current.get(plugin)?.[progress.partial.index] ?? []);
      if (progress.partial !== null && list !== null && list.plugin === plugin) list.onPart(list.start + progress.partial.index, [progress.partial.text], true);
      if (progress.partial !== null && call !== null && call.plugin === plugin) {
        const slot = call.slots[progress.partial.index];
        const text = progress.partial.text;
        if (slot !== undefined) setOverlay((current) => withResults(current, plugin, call.optionsKey, [slot], [text], [call.sources[progress.partial!.index]!], true));
      }
      setJob((current) =>
        current === null || current.plugin !== plugin
          ? current
          : current.kind === "action"
            ? { ...current, done: progress.done, total: progress.total, label: progress.label }
            : { ...current, done: Math.min(current.total, base.current + progress.done), label: progress.label },
      );
    });
    return () => void stop.then((unlisten) => unlisten());
  }, [host]);

  // The overlay belongs to one vault. A new session starts with none.
  useEffect(() => setOverlay(new Map()), [session]);
  // An overlay of old text stays (as in a side-by-side view while the user types). The chip shows that it is outdated.
  const optionsOf = useCallback(
    (plugin: string) => {
      const details = plugins.find((entry) => entry.name === plugin)?.details;
      if (details === null || details === undefined) return {};
      // A saved value that the plugin no longer offers gives the default.
      const saved = options[plugin] ?? {};
      const valid = details.options.filter((option) => isValidOption(option, saved[option.key]));
      return { ...defaultOptions(details), ...Object.fromEntries(valid.map((option) => [option.key, saved[option.key]!])) };
    },
    [plugins, options],
  );

  const resultKey = useCallback(
    (plugin: string) => {
      const translator = plugins.find((entry) => entry.name === plugin)?.capabilities.includes("transform-text") === true;
      return optionsKeyOf(optionsOf(plugin)) + (translator && skipsAny(skip) ? `|skip:${JSON.stringify(skip)}` : "");
    },
    [plugins, optionsOf, skip],
  );

  const transform = useCallback(
    async (plugin: string, ids: readonly Id[]) => {
      if (host === null || job !== null) return;
      cancelled.current = false;
      setError(null);
      base.current = 0;
      const options = optionsOf(plugin);
      const optionsKey = resultKey(plugin);
      // Items with a cached result for the same text and options show it at once. Only the others go to the plugin.
      const fresh = ids.filter((id) => isFresh(session.store, overlay.get(id), plugin, optionsKey, id));
      if (fresh.length > 0) setOverlay((current) => withShown(current, fresh, true));
      // The result shows in place of the text: one step on the undo stack (⌘Z shows the original again).
      // A view step only: it never changes the data.
      const title = plugins.find((entry) => entry.name === plugin)?.details?.title ?? plugin;
      const recordShown = () =>
        session.history.recordView(`show ${title.toLowerCase()}`, {
          undo: () => setOverlay((current) => withShown(current, ids, false)),
          redo: () => setOverlay((current) => withShown(current, ids, true)),
        });
      const todo = ids.filter((id) => !fresh.includes(id));
      if (todo.length === 0) {
        if (fresh.length > 0) recordShown();
        return;
      }
      setJob({ plugin, kind: "transform", done: 0, total: 0, label: "" });
      try {
        await runTransform(host, plugin, session.store, todo, options, {
          onCall: (slots, sources) => {
            currentCall.current = { plugin, optionsKey, slots, sources };
          },
          onResults: (slots, results, sources) => setOverlay((current) => withResults(current, plugin, optionsKey, slots, results, sources)),
          onProgress: (done, total) => {
            base.current = done;
            setJob((current) => (current === null ? null : { ...current, done, total }));
          },
          isCancelled: () => cancelled.current,
        });
      } catch (problem) {
        if (!cancelled.current) setError(String(problem));
      } finally {
        currentCall.current = null;
        setJob(null);
        // Also after Cancel or an error: the results that came show, and ⌘Z hides them.
        recordShown();
      }
    },
    [host, job, session, optionsOf, overlay, plugins],
  );

  const runCommand = useRunCommand();
  const convert = useCallback(
    async (plugin: string, ids: readonly Id[]) => {
      if (host === null || job !== null || session.getState().readOnly) return;
      setError(null);
      const items = [...new Set(ids)].filter((id) => session.store.has("items", id));
      if (items.length === 0) return;
      const texts = items.flatMap((id) => [session.store.get("items", id)!.name, session.store.get("texts", id)?.body ?? ""]);
      setJob({ plugin, kind: "transform", done: 0, total: items.length, label: "" });
      try {
        const results = await transformTexts(host, plugin, texts, optionsOf(plugin));
        const changes = items.map((id, index) => ({ id, name: results[2 * index] ?? "", body: results[2 * index + 1] ?? "" }));
        const title = plugins.find((entry) => entry.name === plugin)?.details?.title ?? plugin;
        runCommand(replaceItemTexts(session.context, changes, `${title}: convert ${items.length === 1 ? "item" : `${items.length} items`}`));
      } catch (problem) {
        setError(String(problem));
      } finally {
        setJob(null);
      }
    },
    [host, job, session, optionsOf, plugins, runCommand],
  );

  const transformList = useCallback(
    async (plugin: string, texts: readonly string[], onPart: (start: number, results: string[], partial?: boolean) => void) => {
      if (host === null || job !== null) return false;
      cancelled.current = false;
      setError(null);
      const options = optionsOf(plugin);
      const PART = 12;
      setJob({ plugin, kind: "transform", done: 0, total: texts.length, label: "" });
      try {
        for (let start = 0; start < texts.length; start += PART) {
          if (cancelled.current) return false;
          const part = texts.slice(start, start + PART);
          // Each text that the plugin finishes (a progress note with "partial") shows before the whole part is done.
          base.current = start;
          listCall.current = { plugin, start, onPart };
          onPart(start, await transformTexts(host, plugin, part, options));
          setJob((current) => (current === null ? null : { ...current, done: Math.min(texts.length, start + PART) }));
        }
        return true;
      } catch (problem) {
        if (!cancelled.current) setError(String(problem));
        return false;
      } finally {
        listCall.current = null;
        setJob(null);
      }
    },
    [host, job, optionsOf],
  );

  /** A long call with progress notes, for example an action or an export. Returns the result, or undefined. */
  const callWithProgress = useCallback(
    async (plugin: string, method: string, params: unknown, throws = false): Promise<unknown> => {
      if (host === null) return undefined;
      if (job !== null) {
        if (throws) throw new Error("A plugin task runs now. Wait for it, or cancel it.");
        return undefined;
      }
      cancelled.current = false;
      setError(null);
      base.current = 0;
      setJob({ plugin, kind: "action", done: 0, total: 0, label: "" });
      try {
        return await host.call(plugin, method, params);
      } catch (problem) {
        if (throws) throw problem;
        if (!cancelled.current) setError(String(problem));
        return undefined;
      } finally {
        setJob(null);
      }
    },
    [host, job],
  );

  const runAction = useCallback(
    async (plugin: string, action: string) => {
      await callWithProgress(plugin, "run_action", { id: action });
      await refresh(plugin);
    },
    [callWithProgress, refresh],
  );

  const cancel = useCallback(() => {
    if (host === null || job === null) return;
    cancelled.current = true;
    void host.call(job.plugin, "cancel", {}).catch(() => undefined);
  }, [host, job]);

  const value = useMemo<PluginsValue>(
    () => ({
      available: host !== null,
      plugins,
      folder,
      reload,
      chooseFolder: async () => {
        if (hostValue === null) return;
        const chosen = await hostValue.chooseFolder();
        if (chosen === null) return;
        try {
          await hostValue.host.setFolder(chosen);
          await reload();
        } catch (problem) {
          setError(String(problem));
        }
      },
      optionsOf,
      transformHost: host,
      resultKey,
      setOption: (plugin, key, optionValue) =>
        void session.updateSettings({ pluginOptions: { ...options, [plugin]: { ...options[plugin], [key]: optionValue } } }),
      job,
      error,
      transform,
      convert,
      transformList,
      callWithProgress,
      setError,
      runAction,
      cancel,
      overlay,
      // "Show originals" and "Show translations" are view steps too: ⌘Z flips them back.
      showOriginal: (ids) => {
        const list = ids === "all" ? [...overlay.keys()] : ids;
        setOverlay((current) => withShown(current, list, false));
        session.history.recordView("show originals", {
          undo: () => setOverlay((current) => withShown(current, list, true)),
          redo: () => setOverlay((current) => withShown(current, list, false)),
        });
      },
      showTransformed: (ids) => {
        setOverlay((current) => withShown(current, ids, true));
        session.history.recordView("show results", {
          undo: () => setOverlay((current) => withShown(current, ids, false)),
          redo: () => setOverlay((current) => withShown(current, ids, true)),
        });
      },
    }),
    [host, hostValue, session, options, plugins, folder, reload, optionsOf, resultKey, job, error, transform, convert, transformList, callWithProgress, runAction, cancel, overlay],
  );

  return <PluginsContext.Provider value={value}>{children}</PluginsContext.Provider>;
}
