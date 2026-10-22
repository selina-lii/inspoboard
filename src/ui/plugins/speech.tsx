// Read aloud with a plugin that has the "speak-text" capability. See docs/PLUGINS.md.
// - The plugin splits the text into sentences and makes audio for each sentence.
// - The app plays the sentences in order. It highlights the sentence in the text, and can show it as a subtitle.
// - The skip rules (reading.ts) change the words to say. The highlight stays on the full sentence.
// - With a translation, the app reads the English text: the original or the translation.
// - The audio is in memory only. "Save audio file" lets the plugin write one file where the user selects.
// - A change of a reading setting while it reads drops the ready audio. Reading goes on with the new setting, from
//   the current sentence. A change of the voice options plays the current sentence again with them.
// - Keys while it reads: Space pauses and plays. Left and Right go to the previous and next sentence. Ctrl, ⌘, or
//   Option + Left and Right change the speed by 0.1.
// - Formulas (LaTeX in a text, MathML in a web page): with a "math-text" plugin, they are said as words (formulas.ts).

import { logEvent } from "../app/debugLog";
import { formulaWords } from "./formulaWords";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Id } from "../../core/types";
import { readClip, readSentences, type Sentence } from "../../io/plugins";
import { findFormulas, mergeFormulas, speakFormulas, type Formula } from "./formulas";
import { SPEECH_RATE_RANGE, type SpeechMode } from "../../io/settings";
import { isTextTarget } from "../app/dom";
import { latinShare, leadOf, plainLetters, prepareSentences, speechCleaner } from "./reading";
import { useSession, useSessionState } from "../app/sessionContext";
import { usePluginHost, usePlugins } from "./pluginsContext";
import { SpeechQueue, type AudioOutput } from "./speechQueue";
import type { Overlay } from "./overlay";
import { selectionOf } from "../editor/selections";

/** Which text of an item is read: its own text, or the plugin result (for example a translation). */
export type SpeechSide = "original" | "result";

export type SpeechState = {
  plugin: string;
  /** What is read: an item ID, or "web:<key>" for a saved web page. */
  sourceId: string;
  /** The text that is read. */
  text: string;
  side: SpeechSide;
  sentences: Sentence[];
  current: number;
  playing: boolean;
  /** True while the app gets the sentences. */
  preparing: boolean;
  /** True while the audio of the current sentence is not ready yet. */
  loading?: boolean;
  /** Mode "all audio first": the clips that are ready before it plays. */
  prepare?: { done: number; total: number } | null;
  /** Formulas that the page gave (a web page). Formulas in the text itself are found again each time. */
  formulas?: readonly Formula[];
  /** "Read selected text": the reading stops at this string index (the end of the selection). */
  until?: number;
  /** A PDF: the words of a sentence with its formulas, made just before its clip (see SentenceResolver). */
  resolve?: SentenceResolver;
  /** The audio is ready up to this sentence index (not included), from the current sentence: the "ready" cursor. */
  readyEnd?: number;
};

/** What "Read aloud" reads: from the start, only the selected text, or from the selected text to the end. */
export type ReadMode = "start" | "selection" | "fromSelection";

export type SpeechValue = {
  state: SpeechState | null;
  error: string | null;
  /** Counts clicks on the text while the lock is on (the bar shows a short reminder at each one). */
  lockNudge: number;
  read(plugin: string, itemId: Id, mode?: ReadMode): Promise<void>;
  /**
   * Reads a text that is not an item text, for example a web page. `from`: a string index to start at. `formulas`:
   * formulas of the page. `until`: the reading stops at this string index (selected text only).
   */
  readText(plugin: string, sourceId: string, text: string, from?: number, formulas?: readonly Formula[], until?: number, resolve?: SentenceResolver): Promise<void>;
  saveAudio(plugin: string, itemId: Id): Promise<void>;
  pause(): void;
  resume(): void;
  step(delta: number): void;
  /** Plays from the sentence at a string index of the read text. */
  seekToOffset(offset: number): void;
  /** A click on the read text: plays from there, except when the lock is on (setting "speechLock"). */
  clickSeek(offset: number): void;
  setLock(locked: boolean): void;
  stop(): void;
  setRate(rate: number): void;
  setVolume(volume: number): void;
  setMode(mode: SpeechMode): void;
  /** The read-aloud keys (Space, Left, Right, Ctrl+Left, Ctrl+Right). True if the key was used. For keys from a frame (a web page). */
  handleKey(event: KeyboardEvent): boolean;
};

const SpeechContext = createContext<SpeechValue | null>(null);

/** All of read aloud: its state and its actions. The component renders again at each change of the state (several
 *  times for each sentence). Views that show only a part use useSpeechSelector, useSpokenSentence, or useSpeechNow. */
export function useSpeech(): SpeechValue | null {
  return useContext(SpeechContext);
}

/** The same value as SpeechContext, as a store: a view subscribes to the part that it shows (useSyncExternalStore). */
type SpeechStore = { get(): SpeechValue | null; subscribe(listener: () => void): () => void };
const SpeechStoreContext = createContext<SpeechStore>({ get: () => null, subscribe: () => () => undefined });

function makeSpeechStore(): SpeechStore & { set(value: SpeechValue | null): void } {
  let current: SpeechValue | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (value) => {
      current = value;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * A part of read aloud: the component renders again only when that part changes (`equal`: the same part). The
 * selector can change between renders (it is read at each change).
 */
export function useSpeechSelector<T>(select: (value: SpeechValue | null) => T, equal: (a: T, b: T) => boolean = Object.is): T {
  const store = useContext(SpeechStoreContext);
  const last = useRef<{ value: T } | null>(null);
  const selectRef = useRef(select);
  selectRef.current = select;
  const read = () => {
    const next = selectRef.current(store.get());
    if (last.current !== null && equal(last.current.value, next)) return last.current.value;
    last.current = { value: next };
    return next;
  };
  return useSyncExternalStore(store.subscribe, read);
}

/** Read aloud at the time of a call (for events: a click, a key). The component does not render again for it. */
export function useSpeechNow(): () => SpeechValue | null {
  return useContext(SpeechStoreContext).get;
}

/** Gives a read-aloud value to the views: as context (useSpeech) and as a store (the selectors). */
export function SpeechValueProvider({ value, children }: { value: SpeechValue | null; children: ReactNode }) {
  const store = useMemo(makeSpeechStore, []);
  useLayoutEffect(() => store.set(value), [store, value]);
  return (
    <SpeechStoreContext.Provider value={store}>
      <SpeechContext.Provider value={value}>{children}</SpeechContext.Provider>
    </SpeechStoreContext.Provider>
  );
}

export type Spoken = { text: string; sentence: Sentence; side: SpeechSide };

/** The sentence that is read now in this item (or web page), or null. In highlight mode and in subtitle mode.
 *  The component renders again only when the sentence changes. */
export function useSpokenSentence(sourceId: string): Spoken | null {
  return useSpeechSelector(
    (speech) => {
      const state = speech?.state;
      if (state == null || state.sourceId !== sourceId || state.preparing) return null;
      const sentence = state.sentences[state.current];
      return sentence === undefined ? null : { text: state.text, sentence, side: state.side };
    },
    (a, b) => a === b || (a !== null && b !== null && a.sentence === b.sentence && a.text === b.text && a.side === b.side),
  );
}

/** The state that the "ready" cursor needs (readyMarkOf), or null when it does not show: then no renders for it. */
export function useReadyState(sourceId: string, show: boolean): SpeechState | null {
  return useSpeechSelector(
    (speech) => (show && speech?.state?.sourceId === sourceId ? speech.state : null),
    (a, b) => a === b || (a !== null && b !== null && a.readyEnd === b.readyEnd && a.current === b.current && a.preparing === b.preparing && a.sentences === b.sentences),
  );
}

export const WEB_SOURCE = "web:";

const SHOW_EVENT = "inspoboard-show-spoken";
/**
 * "Show the text that is read now": the view that shows the read text scrolls the spoken sentence into view (a note or
 * page opens first if it does not show). The views listen with onShowSpoken.
 */
export function showSpoken(sourceId: string): void {
  window.dispatchEvent(new CustomEvent(SHOW_EVENT, { detail: sourceId }));
}
/** Calls `show` at each "Show the text that is read now". Returns the function that stops it. */
export function onShowSpoken(show: () => void): () => void {
  const listener = () => show();
  window.addEventListener(SHOW_EVENT, listener);
  return () => window.removeEventListener(SHOW_EVENT, listener);
}

type Props = {
  children: ReactNode;
  /** Shows the text of the item (for example, in a window), so that the highlight is visible. */
  onShowItem(itemId: Id): void;
};

export function SpeechProvider({ children, onShowItem }: Props) {
  const session = useSession();
  const { settings } = useSessionState();
  const hostValue = usePluginHost();
  const plugins = usePlugins();
  const [state, setState] = useState<SpeechState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lockNudge, setLockNudge] = useState(0);
  const queue = useRef<SpeechQueue | null>(null);
  /** The sentences (by start) whose clips have formula parts: a speed change makes them again. */
  const formulaStarts = useRef(new Set<number>());
  const audio = useRef<HtmlAudioOutput | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const optionsRef = useRef(plugins.optionsOf);
  optionsRef.current = plugins.optionsOf;

  const output = useCallback((): HtmlAudioOutput => {
    audio.current ??= new HtmlAudioOutput();
    audio.current.setRate(settingsRef.current.speechRate);
    audio.current.setVolume(settingsRef.current.speechVolume);
    return audio.current;
  }, []);

  const stop = useCallback(() => {
    queue.current?.stop();
    queue.current = null;
    setState(null);
  }, []);

  /** The sentences with each formula as words, if a "math-text" plugin is installed. Else (or on an error) as they are. */
  const withFormulas = useCallback(
    async (text: string, split: Sentence[], given: readonly Formula[] | undefined): Promise<Sentence[]> => {
      // "Formulas → words" off: no formula work (formulas are read as their text).
      const math = plugins.plugins.find((entry) => entry.details !== null && entry.capabilities.includes("math-text"));
      if (!settingsRef.current.formulaNotes || math === undefined || hostValue === null) return split;
      const formulas = mergeFormulas(given ?? [], findFormulas(text));
      if (formulas.length === 0) return split;
      const words = await formulaWords(hostValue.host, math.name, plugins.optionsOf(math.name), formulas);
      return speakFormulas(text, split, formulas, words.map((entry) => entry.speech));
    },
    [hostValue, plugins],
  );

  const begin = useCallback(
    async (plugin: string, sourceId: string, text: string, side: SpeechSide, from: number | undefined, formulas?: readonly Formula[], until?: number, resolve?: SentenceResolver, lead?: string) => {
      if (hostValue === null) return;
      stop();
      setError(null);
      setState({ plugin, sourceId, text, side, sentences: [], current: 0, playing: false, preparing: true, formulas, until, resolve });
      // Start the audio output now (while the plugin makes the first clip): else the first clip starts late.
      output().warm();
      try {
        const options = plugins.optionsOf(plugin);
        const split = await withFormulas(text, readSentences(await hostValue.host.call(plugin, "sentences", { text, options }), text.length), formulas);
        const all = prepareSentences(text, split, settingsRef.current.speechSkip, settingsRef.current.speechMarkdown);
        // Selected text only: the sentences that start before the end of the selection.
        const sentences = until === undefined ? all : all.filter((sentence) => sentence.start < until);
        // A page with a subtitle, read from its start: its title and subtitle come first (a sentence with no place in the text).
        if (lead !== undefined && from === undefined) sentences.unshift({ start: 0, end: 0, speech: lead });
        if (sentences.length === 0) throw new Error("There is no text to read.");
        // The options when the clip is made: a change of the voice or the pitch applies to the next clips.
        // A PDF with "Formulas → words": the formulas of the sentence are found and said now (just before its clip).
        const clean = speechCleaner(text, settingsRef.current.speechSkip, settingsRef.current.speechMarkdown);
        formulaStarts.current = new Set();
        const fetchClip = async (plain: Sentence) => {
          let sentence = plain;
          if (resolve !== undefined && settingsRef.current.formulaNotes) {
            const found = await resolve(plain).catch(() => null);
            const parts = found?.parts?.map((part) => ({ ...part, text: part.formula ? plainLetters(part.text) : clean(part.text).trim() })).filter((part) => part.text !== "");
            if (parts !== undefined && parts.some((part) => part.formula)) sentence = { ...plain, speech: parts.map((part) => part.text).join(" "), parts };
          }
          const slow = sentence.parts?.some((part) => part.formula) === true;
          if (slow) formulaStarts.current.add(plain.start);
          // Formulas: slower than the reading by `speechFormulaSlower` (the voice makes them slower; the clip plays at the reading speed).
          const rate = formulaRate(settingsRef.current.speechRate, settingsRef.current.speechFormulaSlower);
          const parts = slow ? sentence.parts!.map((part) => ({ text: part.text, rate: part.formula ? rate : 1 })) : undefined;
          // `text` too: a voice plugin without `parts` says the sentence at one speed.
          const clip = readClip(await hostValue.host.call(plugin, "speak", { text: sentence.speech, ...(parts === undefined ? {} : { parts }), options: optionsRef.current(plugin) }));
          return URL.createObjectURL(new Blob([base64Bytes(clip.audio)], { type: clip.mime }));
        };
        const next = new SpeechQueue(sentences, fetchClip, output(), {
          onSentence: (current) => setState((value) => (value === null ? null : { ...value, current })),
          onState: (playing) => setState((value) => (value === null ? null : { ...value, playing })),
          onLoading: (loading) => setState((value) => (value === null || value.loading === loading ? value : { ...value, loading })),
          onEnd: () => {
            logEvent("Read aloud: ended");
            queue.current = null;
            setState(null);
          },
          onError: (problem) => {
            logEvent(`Read aloud error: ${problem}`);
            setError(problem);
          },
          onPrepare: (prepare) => setState((value) => (value === null ? null : { ...value, prepare })),
          onReady: (readyEnd) => setState((value) => (value === null || value.readyEnd === readyEnd ? value : { ...value, readyEnd })),
        }, (url) => URL.revokeObjectURL(url), settingsRef.current.speechAhead);
        queue.current = next;
        logEvent(`Read aloud: ${sentences.length} sentences of ${sourceId}, ${formulas?.length ?? 0} formulas, audio ahead: ${settingsRef.current.speechAhead}`);
        setState({ plugin, sourceId, text, side, sentences, current: 0, playing: true, preparing: false, formulas, until, resolve });
        if (!sourceId.startsWith(WEB_SOURCE)) onShowItem(sourceId);
        next.start(from === undefined ? 0 : sentenceAt(sentences, from));
      } catch (problem) {
        setError(String(problem));
        setState(null);
      }
    },
    [hostValue, plugins, stop, output, onShowItem, withFormulas],
  );

  const read = useCallback(
    async (plugin: string, itemId: Id, mode: ReadMode = "fromSelection") => {
      const { text, side } = readableText(session.store.get("texts", itemId)?.body ?? "", plugins.overlay.get(itemId));
      // The selected text of this item (only if its own text is read): where to start, and (selected text only) stop.
      const selection = side === "original" && mode !== "start" ? selectionOf(itemId) : undefined;
      const range = selection !== undefined && selection.to > selection.from ? selection : undefined;
      await begin(plugin, itemId, text, side, range?.from, undefined, mode === "selection" ? range?.to : undefined, undefined, leadOf(session.store.get("items", itemId)));
    },
    [session, plugins.overlay, begin],
  );

  const readText = useCallback(
    (plugin: string, sourceId: string, text: string, from?: number, formulas?: readonly Formula[], until?: number, resolve?: SentenceResolver) => begin(plugin, sourceId, text, "original", from, formulas, until, resolve),
    [begin],
  );

  const saveAudio = useCallback(
    async (plugin: string, itemId: Id) => {
      if (hostValue === null) return;
      const name = (session.store.get("items", itemId)?.name ?? "").trim() || "Read aloud";
      const path = await hostValue.host.chooseSaveFile(name, ["mp3", "wav"]);
      if (path === null) return;
      const { speechRate, speechVolume } = settingsRef.current;
      const { text } = readableText(session.store.get("texts", itemId)?.body ?? "", plugins.overlay.get(itemId));
      const options = plugins.optionsOf(plugin);
      // The plugin speaks the words after the skip rules.
      const split = await withFormulas(text, readSentences(await hostValue.host.call(plugin, "sentences", { text, options }), text.length), undefined);
      const lead = leadOf(session.store.get("items", itemId));
      const speeches = [...(lead === undefined ? [] : [lead]), ...prepareSentences(text, split, settingsRef.current.speechSkip, settingsRef.current.speechMarkdown).map((sentence) => sentence.speech)];
      await plugins.callWithProgress(plugin, "export", {
        text,
        speeches,
        options,
        path,
        rate: speechRate,
        volume: speechVolume,
      });
    },
    [hostValue, plugins, session, withFormulas],
  );

  // A change of the options of the reading plugin (voice, pitch) while it reads: play the current sentence again with them.
  const readingPlugin = state !== null && !state.preparing ? state.plugin : null;
  const optionsKey = readingPlugin === null ? "" : JSON.stringify(plugins.optionsOf(readingPlugin));
  const lastOptions = useRef(optionsKey);
  useEffect(() => {
    if (optionsKey !== lastOptions.current && lastOptions.current !== "" && optionsKey !== "") queue.current?.refresh();
    lastOptions.current = optionsKey;
  }, [optionsKey]);

  // A change of a reading setting (skip rules, Markdown, how far ahead) while it reads: the ready audio is not right any
  // more. Drop it, and read again with the new setting from the sentence that is read now.
  const stateRef = useRef(state);
  stateRef.current = state;
  const readingKey = JSON.stringify([settings.speechSkip, settings.speechMarkdown, settings.speechAhead]);
  const lastReadingKey = useRef(readingKey);
  useEffect(() => {
    if (readingKey === lastReadingKey.current) return;
    lastReadingKey.current = readingKey;
    const now = stateRef.current;
    if (queue.current === null || now === null || now.preparing) return;
    const at = now.sentences[now.current]?.start ?? 0;
    void begin(now.plugin, now.sourceId, now.text, now.side, at, now.formulas, now.until, now.resolve);
  }, [readingKey, begin]);

  // "Show the text that is read now": a note or a page that does not show opens (its view then scrolls to the sentence).
  const stateNow = useRef(state);
  stateNow.current = state;
  useEffect(
    () =>
      onShowSpoken(() => {
        const sourceId = stateNow.current?.sourceId;
        if (sourceId !== undefined && !sourceId.startsWith(WEB_SOURCE)) onShowItem(sourceId);
      }),
    [onShowItem],
  );

  // A change of the text makes the sentence ranges wrong. Stop.
  useEffect(
    () =>
      session.store.subscribe((changes) => {
        const itemId = queue.current === null ? null : state?.sourceId;
        if (itemId !== undefined && itemId !== null && changes.some((change) => change.id === itemId)) stop();
      }),
    [session, state?.sourceId, stop],
  );
  useEffect(() => () => {
    queue.current?.stop();
    audio.current?.stop();
  }, []);

  const setRate = useCallback(
    (rate: number) => {
      audio.current?.setRate(rate);
      // Clips ahead with formulas were made for the old speed (their formula part is slower by a set amount).
      const now = stateRef.current;
      if (queue.current !== null && now !== null && formulaStarts.current.size > 0) {
        queue.current.dropAhead(now.sentences.flatMap((sentence, index) => (formulaStarts.current.has(sentence.start) ? [index] : [])));
      }
      void session.updateSettings({ speechRate: rate });
    },
    [session],
  );

  const handleKey = useCallback(
    (event: KeyboardEvent): boolean => {
      if (queue.current === null || (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== " ")) return false;
      // In a text field the keys move the caret. Sliders and buttons do not keep them (for example after a change of the speed).
      if (event.shiftKey || isTypingTarget(event.target)) return false;
      // Space: pause or play. (Not the click of a focused button.)
      if (event.key === " ") {
        if (event.ctrlKey || event.metaKey || event.altKey) return false;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return true;
        if (stateRef.current?.playing === true) queue.current.pause();
        else queue.current.resume();
        return true;
      }
      const delta = event.key === "ArrowLeft" ? -1 : 1;
      event.preventDefault();
      event.stopPropagation();
      // Ctrl, ⌘, or Option with ← → changes the speed. (On macOS, Ctrl + ← → can switch desktops before the app gets it.)
      if (event.ctrlKey || event.metaKey || event.altKey) {
        const next = Math.round((settingsRef.current.speechRate + delta * 0.1) * 100) / 100;
        setRate(Math.min(SPEECH_RATE_RANGE.max, Math.max(SPEECH_RATE_RANGE.min, next)));
      } else {
        queue.current.step(delta);
      }
      return true;
    },
    [setRate],
  );

  // The keys work while the app reads. Capture: before the board (which moves selected cards with arrow keys).
  const reading = state !== null && !state.preparing;
  useEffect(() => {
    if (!reading) return;
    const onKeyDown = (event: KeyboardEvent) => void handleKey(event);
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [reading, handleKey]);

  const value = useMemo<SpeechValue>(
    () => ({
      state,
      error,
      lockNudge,
      read,
      readText,
      saveAudio,
      pause: () => queue.current?.pause(),
      resume: () => queue.current?.resume(),
      step: (delta) => queue.current?.step(delta),
      seekToOffset: (offset) => {
        if (queue.current === null || state === null) return;
        queue.current.start(sentenceAt(state.sentences, offset));
      },
      clickSeek: (offset) => {
        if (queue.current === null || state === null) return;
        // Locked: the click does not move the reading. The user may not know why: the bar reminds them.
        if (settings.speechLock) {
          setLockNudge((count) => count + 1);
          return;
        }
        queue.current.start(sentenceAt(state.sentences, offset));
      },
      setLock: (locked) => void session.updateSettings({ speechLock: locked }),
      stop,
      setRate,
      setVolume: (volume) => {
        audio.current?.setVolume(volume);
        void session.updateSettings({ speechVolume: volume });
      },
      setMode: (mode) => void session.updateSettings({ speechMode: mode }),
      handleKey,
    }),
    [state, error, lockNudge, read, readText, saveAudio, stop, setRate, handleKey, session, settings.speechLock],
  );
  return <SpeechValueProvider value={value}>{children}</SpeechValueProvider>;
}

/** A field where arrow keys move a caret or change a choice. Not a slider, a check box, or a button. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!isTextTarget(target)) return false;
  const element = target as HTMLElement;
  return !(element instanceof HTMLInputElement && ["range", "checkbox", "radio", "button"].includes(element.type));
}

/**
 * The text to read for an item. The voice reads English. With a plugin result (for example a translation),
 * the text with more Latin letters is read: the translation of a Chinese text, or the original of an English text.
 */
export function readableText(original: string, overlay: Overlay | undefined): { text: string; side: SpeechSide } {
  const result = overlay?.shown === true ? overlay.body : null;
  if (result === null || result === undefined || result.trim() === "") return { text: original, side: "original" };
  return latinShare(result) > latinShare(original) ? { text: result, side: "result" } : { text: original, side: "original" };
}

/** The sentence that holds a string index, or the next one after it. */
export function sentenceAt(sentences: readonly Sentence[], offset: number): number {
  const index = sentences.findIndex((sentence) => sentence.end > offset);
  return index === -1 ? Math.max(0, sentences.length - 1) : index;
}

/**
 * The words of a sentence with its formulas, made just before its clip: the sentence in parts (a part is a formula
 * or text). A reader gives it when its formulas are found late (a PDF: see pdfFormulas.ts).
 */
export type SentenceResolver = (sentence: Sentence) => Promise<Sentence>;

/** The speed of a formula part, relative to the clip: the reading speed less `slower` (at least 0.3 of it). */
export function formulaRate(speed: number, slower: number): number {
  return Math.max(0.3, (speed - slower) / speed);
}

function base64Bytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Plays clips with two audio elements (double buffering): while one plays, the next clip loads in the other, so the
 * next sentence starts without a gap. The speed keeps the pitch of the voice. A speed change while a clip plays
 * pauses it and plays it again from the same place (the user saw the reading stop after a speed change).
 */
class HtmlAudioOutput implements AudioOutput {
  private elements = [new Audio(), new Audio()];
  private active = 0;
  private finish: (() => void) | null = null;
  private rate = 1;

  constructor() {
    for (const element of this.elements) {
      element.preservesPitch = true;
      element.preload = "auto";
      // Only the element that plays ends a clip.
      element.onended = () => {
        if (element === this.element) this.done();
      };
    }
  }

  private get element(): HTMLAudioElement {
    return this.elements[this.active]!;
  }

  private get idle(): HTMLAudioElement {
    return this.elements[1 - this.active]!;
  }

  play(url: string, started?: () => void): Promise<void> {
    this.done();
    // The clip is loaded in the other element already (preload): that one plays now.
    if (this.idle.src === url) {
      this.element.pause();
      this.active = 1 - this.active;
    }
    const element = this.element;
    return new Promise((resolve, reject) => {
      this.finish = resolve;
      element.onplaying = () => {
        element.onplaying = null;
        started?.();
      };
      element.onerror = () => reject(new Error("The audio could not play."));
      if (element.src !== url) element.src = url;
      else element.currentTime = 0;
      element.defaultPlaybackRate = this.rate;
      element.playbackRate = this.rate;
      element.play().catch(reject);
    });
  }

  preload(url: string): void {
    const idle = this.idle;
    if (idle.src === url) return;
    idle.onplaying = null;
    idle.onerror = null;
    idle.src = url;
    idle.load();
  }

  /** Pause and play again, from the same place. */
  private restart(): void {
    const at = this.element.currentTime;
    this.element.pause();
    this.element.currentTime = at;
    void this.element.play().catch(() => undefined);
  }

  /** Plays a short silence. The system audio starts, so that the first clip can play at once. */
  warm(): void {
    if (this.finish !== null) return;
    this.element.onplaying = null;
    this.element.onerror = null;
    this.element.src = silence();
    this.element.play().catch(() => undefined);
  }

  pause(): void {
    this.element.pause();
  }

  resume(): void {
    void this.element.play();
  }

  stop(): void {
    this.element.pause();
    this.done();
  }

  setRate(rate: number): void {
    if (rate === this.rate) return;
    this.rate = rate;
    for (const element of this.elements) {
      element.defaultPlaybackRate = rate;
      element.playbackRate = rate;
    }
    // A speed change while it plays: pause and play again (see above).
    if (this.finish !== null && !this.element.paused) this.restart();
  }

  setVolume(volume: number): void {
    for (const element of this.elements) element.volume = Math.max(0, Math.min(1, volume));
  }

  private done(): void {
    const finish = this.finish;
    this.finish = null;
    finish?.();
  }
}

let silenceUrl: string | null = null;

/** A WAV file of 0.2 seconds of silence (8 kHz, 16 bit, mono). */
function silence(): string {
  if (silenceUrl !== null) return silenceUrl;
  const samples = 1600;
  const view = new DataView(new ArrayBuffer(44 + samples * 2));
  const text = (at: number, value: string) => [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  silenceUrl = URL.createObjectURL(new Blob([view.buffer], { type: "audio/wav" }));
  return silenceUrl;
}
