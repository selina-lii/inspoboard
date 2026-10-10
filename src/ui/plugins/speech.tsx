// Read aloud with a plugin that has the "speak-text" capability. See docs/PLUGINS.md.
// - The plugin splits the text into sentences and makes audio for each sentence.
// - The app plays the sentences in order. It highlights the sentence in the text, and can show it as a subtitle.
// - The skip rules (reading.ts) change the words to say. The highlight stays on the full sentence.
// - With a translation, the app reads the English text: the original or the translation.
// - The audio is in memory only. "Save audio file" lets the plugin write one file where the user selects.
// - Keys while it reads: Left and Right go to the previous and next sentence. Ctrl, ⌘, or Option + Left and Right
//   change the speed by 0.1.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Id } from "../../core/types";
import { readClip, readSentences, type Sentence } from "../../io/plugins";
import { SPEECH_RATE_RANGE, type SpeechMode } from "../../io/settings";
import { isTextTarget } from "../app/dom";
import { latinShare, prepareSentences } from "./reading";
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
};

export type SpeechValue = {
  state: SpeechState | null;
  error: string | null;
  read(plugin: string, itemId: Id): Promise<void>;
  /** Reads a text that is not an item text, for example a web page. `from`: a string index to start at. */
  readText(plugin: string, sourceId: string, text: string, from?: number): Promise<void>;
  saveAudio(plugin: string, itemId: Id): Promise<void>;
  pause(): void;
  resume(): void;
  step(delta: number): void;
  /** Plays from the sentence at a string index of the read text. */
  seekToOffset(offset: number): void;
  stop(): void;
  setRate(rate: number): void;
  setVolume(volume: number): void;
  setMode(mode: SpeechMode): void;
  /** The read-aloud keys (Left, Right, Ctrl+Left, Ctrl+Right). True if the key was used. For keys from a frame (a web page). */
  handleKey(event: KeyboardEvent): boolean;
};

const SpeechContext = createContext<SpeechValue | null>(null);

export function useSpeech(): SpeechValue | null {
  return useContext(SpeechContext);
}

export type Spoken = { text: string; sentence: Sentence; side: SpeechSide };

/** The sentence that is read now in this item (or web page), or null. In highlight mode and in subtitle mode. */
export function useSpokenSentence(sourceId: string): Spoken | null {
  const speech = useSpeech();
  const state = speech?.state;
  if (state === null || state === undefined || state.sourceId !== sourceId || state.preparing) return null;
  const sentence = state.sentences[state.current];
  return sentence === undefined ? null : { text: state.text, sentence, side: state.side };
}

export const WEB_SOURCE = "web:";

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
  const queue = useRef<SpeechQueue | null>(null);
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

  const begin = useCallback(
    async (plugin: string, sourceId: string, text: string, side: SpeechSide, from: number | undefined) => {
      if (hostValue === null) return;
      stop();
      setError(null);
      setState({ plugin, sourceId, text, side, sentences: [], current: 0, playing: false, preparing: true });
      try {
        const options = plugins.optionsOf(plugin);
        const split = readSentences(await hostValue.host.call(plugin, "sentences", { text, options }), text.length);
        const sentences = prepareSentences(text, split, settingsRef.current.speechSkip, settingsRef.current.speechMarkdown);
        if (sentences.length === 0) throw new Error("There is no text to read.");
        // The options when the clip is made: a change of the voice or the pitch applies to the next clips.
        const fetchClip = async (sentence: Sentence) => {
          const clip = readClip(await hostValue.host.call(plugin, "speak", { text: sentence.speech, options: optionsRef.current(plugin) }));
          return URL.createObjectURL(new Blob([base64Bytes(clip.audio)], { type: clip.mime }));
        };
        const next = new SpeechQueue(sentences, fetchClip, output(), {
          onSentence: (current) => setState((value) => (value === null ? null : { ...value, current })),
          onState: (playing) => setState((value) => (value === null ? null : { ...value, playing })),
          onLoading: (loading) => setState((value) => (value === null || value.loading === loading ? value : { ...value, loading })),
          onEnd: () => {
            queue.current = null;
            setState(null);
          },
          onError: (problem) => setError(problem),
          onPrepare: (prepare) => setState((value) => (value === null ? null : { ...value, prepare })),
        }, (url) => URL.revokeObjectURL(url), settingsRef.current.speechAhead);
        queue.current = next;
        setState({ plugin, sourceId, text, side, sentences, current: 0, playing: true, preparing: false });
        if (!sourceId.startsWith(WEB_SOURCE)) onShowItem(sourceId);
        next.start(from === undefined ? 0 : sentenceAt(sentences, from));
      } catch (problem) {
        setError(String(problem));
        setState(null);
      }
    },
    [hostValue, plugins, stop, output, onShowItem],
  );

  const read = useCallback(
    async (plugin: string, itemId: Id) => {
      const { text, side } = readableText(session.store.get("texts", itemId)?.body ?? "", plugins.overlay.get(itemId));
      // Start at the selected text, if the user selected text in this item (and its own text is read).
      const selection = side === "original" ? selectionOf(itemId) : undefined;
      await begin(plugin, itemId, text, side, selection?.from);
    },
    [session, plugins.overlay, begin],
  );

  const readText = useCallback(
    (plugin: string, sourceId: string, text: string, from?: number) => begin(plugin, sourceId, text, "original", from),
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
      const split = readSentences(await hostValue.host.call(plugin, "sentences", { text, options }), text.length);
      const speeches = prepareSentences(text, split, settingsRef.current.speechSkip, settingsRef.current.speechMarkdown).map((sentence) => sentence.speech);
      await plugins.callWithProgress(plugin, "export", {
        text,
        speeches,
        options,
        path,
        rate: speechRate,
        volume: speechVolume,
      });
    },
    [hostValue, plugins, session],
  );

  // A change of the options of the reading plugin (voice, pitch) while it reads: play the current sentence again with them.
  const readingPlugin = state !== null && !state.preparing ? state.plugin : null;
  const optionsKey = readingPlugin === null ? "" : JSON.stringify(plugins.optionsOf(readingPlugin));
  const lastOptions = useRef(optionsKey);
  useEffect(() => {
    if (optionsKey !== lastOptions.current && lastOptions.current !== "" && optionsKey !== "") queue.current?.refresh();
    lastOptions.current = optionsKey;
  }, [optionsKey]);

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
      void session.updateSettings({ speechRate: rate });
    },
    [session],
  );

  const handleKey = useCallback(
    (event: KeyboardEvent): boolean => {
      if (queue.current === null || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return false;
      // In a text field the keys move the caret. Sliders and buttons do not keep them (for example after a change of the speed).
      if (event.shiftKey || isTypingTarget(event.target)) return false;
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
      stop,
      setRate,
      setVolume: (volume) => {
        audio.current?.setVolume(volume);
        void session.updateSettings({ speechVolume: volume });
      },
      setMode: (mode) => void session.updateSettings({ speechMode: mode }),
      handleKey,
    }),
    [state, error, read, readText, saveAudio, stop, setRate, handleKey, session],
  );
  return <SpeechContext.Provider value={value}>{children}</SpeechContext.Provider>;
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

function base64Bytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Plays clips with one audio element. The speed keeps the pitch of the voice. */
class HtmlAudioOutput implements AudioOutput {
  private element = new Audio();
  private finish: (() => void) | null = null;
  private rate = 1;

  constructor() {
    this.element.preservesPitch = true;
    this.element.onended = () => this.done();
  }

  play(url: string): Promise<void> {
    this.done();
    return new Promise((resolve, reject) => {
      this.finish = resolve;
      this.element.onerror = () => reject(new Error("The audio could not play."));
      this.element.src = url;
      this.element.defaultPlaybackRate = this.rate;
      this.element.playbackRate = this.rate;
      this.element.play().catch(reject);
    });
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
    this.rate = rate;
    this.element.defaultPlaybackRate = rate;
    this.element.playbackRate = rate;
  }

  setVolume(volume: number): void {
    this.element.volume = Math.max(0, Math.min(1, volume));
  }

  private done(): void {
    const finish = this.finish;
    this.finish = null;
    finish?.();
  }
}
