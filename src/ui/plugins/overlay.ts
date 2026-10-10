// View overlay: text from a plugin (for example a translation) that shows in place of the item text.
// It is view state only. It is never written to the store, to files, or to history.
// The workspace drops it when the vault closes.
//
// The overlay is also a cache: "Show originals" hides it, "Show translations" shows it again at once.
// An overlay keeps the original texts that it came from. If they change, it is not used again.

import type { PluginHost } from "../../io/backend";
import { transformTexts } from "../../io/plugins";
import type { Store } from "../../core/store";
import type { Id } from "../../core/types";

/** `null`: the plugin did not change this part. The original shows. */
export type Overlay = {
  plugin: string;
  /** The plugin options that made the text, for example the target language. */
  optionsKey: string;
  title: string | null;
  body: string | null;
  /** The original texts that the plugin got. */
  titleSource: string | null;
  bodySource: string | null;
  /** False: the original shows. The overlay stays as a cache. */
  shown: boolean;
};
export type OverlayMap = ReadonlyMap<Id, Overlay>;

type Slot = { id: Id; field: "title" | "body" };

/** Items in each plugin call. Results show after each call, and a cancel stops between calls. */
export const ITEMS_PER_CALL = 8;

/** A stable key for plugin options. */
export function optionsKeyOf(options: Record<string, string>): string {
  return JSON.stringify(Object.entries(options).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** The texts to send for some items: each name and each body. Empty texts and random codes are not sent. */
export function collectTexts(store: Store, ids: readonly Id[]): { slots: Slot[]; texts: string[] } {
  const slots: Slot[] = [];
  const texts: string[] = [];
  for (const id of new Set(ids)) {
    const item = store.get("items", id);
    if (item === undefined) continue;
    if (item.name.trim() !== "" && item.codeName !== true) {
      slots.push({ id, field: "title" });
      texts.push(item.name);
    }
    const body = store.get("texts", id)?.body ?? "";
    if (body.trim() !== "") {
      slots.push({ id, field: "body" });
      texts.push(body);
    }
  }
  return { slots, texts };
}

/**
 * True if the overlay of an item can show again: the same plugin and options, and the original texts
 * did not change since. Then the item needs no new plugin call.
 */
export function isFresh(store: Store, overlay: Overlay | undefined, plugin: string, optionsKey: string, id: Id): boolean {
  if (overlay === undefined || overlay.plugin !== plugin || overlay.optionsKey !== optionsKey) return false;
  const item = store.get("items", id);
  if (item === undefined) return false;
  const { slots, texts } = collectTexts(store, [id]);
  return slots.every((slot, index) => (slot.field === "title" ? overlay.titleSource === texts[index] && overlay.title !== null : overlay.bodySource === texts[index] && overlay.body !== null));
}

/** A new map with the results. The old map does not change. The results show. */
export function withResults(
  map: OverlayMap,
  plugin: string,
  optionsKey: string,
  slots: readonly Slot[],
  results: readonly string[],
  sources: readonly string[],
): OverlayMap {
  const next = new Map(map);
  slots.forEach((slot, index) => {
    const current = next.get(slot.id);
    const base: Overlay =
      current?.plugin === plugin && current.optionsKey === optionsKey
        ? current
        : { plugin, optionsKey, title: null, body: null, titleSource: null, bodySource: null, shown: true };
    const result = results[index] ?? null;
    const source = sources[index] ?? null;
    next.set(slot.id, slot.field === "title" ? { ...base, title: result, titleSource: source, shown: true } : { ...base, body: result, bodySource: source, shown: true });
  });
  return next;
}

/** Hides or shows overlays. They stay as a cache. `ids`: some items, or all items of a plugin. */
export function withShown(map: OverlayMap, ids: readonly Id[] | { plugin: string }, shown: boolean): OverlayMap {
  const next = new Map(map);
  for (const [id, overlay] of map) {
    const match = Array.isArray(ids) ? (ids as readonly Id[]).includes(id) : overlay.plugin === (ids as { plugin: string }).plugin;
    if (match && overlay.shown !== shown) next.set(id, { ...overlay, shown });
  }
  return next;
}

/** Removes overlays (for example, when the original text changed). */
export function without(map: OverlayMap, ids: readonly Id[] | "all"): OverlayMap {
  if (ids === "all") return new Map();
  const next = new Map(map);
  for (const id of ids) next.delete(id);
  return next;
}

export type TransformJob = {
  onResults(slots: Slot[], results: string[], sources: string[]): void;
  /** The plugin sends the text so far for a slot of the running call (index in `slots` of that call). */
  onCall?(slots: Slot[], sources: string[]): void;
  /** `done` and `total` count texts. */
  onProgress(done: number, total: number): void;
  isCancelled(): boolean;
};

/**
 * Sends the texts of the items to the plugin, some items at a time. The store is only read.
 * Returns the number of items that got a result.
 */
export async function runTransform(
  host: PluginHost,
  plugin: string,
  store: Store,
  ids: readonly Id[],
  options: Record<string, string>,
  job: TransformJob,
): Promise<number> {
  const unique = [...new Set(ids)];
  const total = collectTexts(store, unique).texts.length;
  let done = 0;
  let items = 0;
  job.onProgress(0, total);
  for (let start = 0; start < unique.length; start += ITEMS_PER_CALL) {
    if (job.isCancelled()) break;
    const part = unique.slice(start, start + ITEMS_PER_CALL);
    const { slots, texts } = collectTexts(store, part);
    if (texts.length === 0) continue;
    job.onCall?.(slots, texts);
    const results = await transformTexts(host, plugin, texts, options);
    job.onResults(slots, results, texts);
    done += texts.length;
    items += new Set(slots.map((slot) => slot.id)).size;
    job.onProgress(done, total);
  }
  return items;
}
