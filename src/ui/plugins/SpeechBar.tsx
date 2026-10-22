// Read-aloud controls above the board: play, pause, sentence steps, speed, volume. In subtitle mode, a large subtitle.

import { Gauge, LoaderCircle, LocateFixed, Lock, LockOpen, Pause, Play, SkipBack, SkipForward, Square, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SPEECH_RATE_RANGE } from "../../io/settings";
import { useSessionState } from "../app/sessionContext";
import { useSpeech } from "./speech";
import { formatListenTime, wordsSeconds, wordsToEnd } from "./listenTime";
import { usePluginHost, usePlugins } from "./pluginsContext";
import { useSession } from "../app/sessionContext";
import { onShowSpoken, showSpoken, WEB_SOURCE, type SpeechState } from "./speech";
import { cachedPageTranslation } from "../web/pageTranslation";
import { pageCounterpart, textCounterpart } from "./sentencePairs";
import type { OverlayMap } from "./overlay";
import type { Store } from "../../core/store";
import type { Sentence } from "../../io/plugins";
import "./plugins.css";

/**
 * "Making the audio: 2000 / 6000 · 1 h 50 min left". The time left comes from the speed so far (`start`: the first
 * progress of this preparation). It shows after a few clips.
 */
function prepareLabel(prepare: { done: number; total: number }, start: { time: number; done: number } | null): string {
  const made = start === null ? 0 : prepare.done - start.done;
  const seconds = start === null ? 0 : (performance.now() - start.time) / 1000;
  if (made < 3 || seconds <= 0) return `Making the audio: ${prepare.done} / ${prepare.total}`;
  const left = formatListenTime(((prepare.total - prepare.done) * seconds) / made).replace("about ", "");
  return `Making the audio: ${prepare.done} / ${prepare.total} · ${left} left`;
}

/** A short bubble over the lock button: a click on the text did nothing because the lock is on. */
function LockReminder({ nudge }: { nudge: number }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (nudge === 0) return;
    setShown(true);
    const timer = window.setTimeout(() => setShown(false), 2200);
    return () => window.clearTimeout(timer);
  }, [nudge]);
  return shown ? <span className="speech-lock-reminder">Locked: unlock (the lock button) to jump to a sentence by clicking it</span> : null;
}

/** The speed as a number. A double-click makes it a field: type a speed, Enter (or leave the field) sets it, Esc cancels. */
function RateText({ rate, onRate }: { rate: number; onRate(rate: number): void }) {
  const [typing, setTyping] = useState<string | null>(null);
  // Enter or Esc ends the field; the blur that follows (the field goes away) must not set the speed again.
  const ended = useRef(false);
  const done = (save: boolean) => {
    if (ended.current) return;
    ended.current = true;
    const value = Number((typing ?? "").replace(",", ".").replace(/[×x]/g, ""));
    if (save && Number.isFinite(value) && value > 0) onRate(Math.min(SPEECH_RATE_RANGE.max, Math.max(SPEECH_RATE_RANGE.min, Math.round(value * 100) / 100)));
    setTyping(null);
  };
  if (typing === null) {
    return (
      <span className="speech-rate" onDoubleClick={(event) => (event.preventDefault(), (ended.current = false), setTyping(rate.toFixed(2)))}>
        {rate.toFixed(2)}×
      </span>
    );
  }
  return (
    <input
      className="speech-rate-input"
      autoFocus
      value={typing}
      onFocus={(event) => event.target.select()}
      onChange={(event) => setTyping(event.target.value)}
      onBlur={() => done(true)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") done(true);
        else if (event.key === "Escape") done(false);
      }}
    />
  );
}

export function SpeechBar() {
  const speech = useSpeech();
  const { settings } = useSessionState();
  const hostValue = usePluginHost();
  const state = speech?.state ?? null;
  // The start of the current "All audio first" preparation, for the time left.
  const prepareStart = useRef<{ time: number; done: number } | null>(null);
  if (state?.prepare == null) prepareStart.current = null;
  else prepareStart.current ??= { time: performance.now(), done: state.prepare.done };
  const sentence = state === null || state.preparing ? undefined : state.sentences[state.current];
  // The words to the end, counted one time for each document (not at each redraw).
  const sentences = state?.sentences;
  const wordsLeft = useMemo(() => (sentences === undefined ? null : wordsToEnd(sentences)), [sentences]);
  const showSubtitle = hostValue?.host.showSubtitle;
  const floating = settings.speechMode === "subtitle" && settings.subtitleFloating && showSubtitle !== undefined;
  const session = useSession();
  const plugins = usePlugins();
  const spokenText = sentence !== undefined && state !== null ? state.text.slice(sentence.start, sentence.end).trim() : null;
  // The second line of the subtitle: the matching sentence of the translation (or of the original).
  const second = settings.speechMode === "subtitle" && settings.subtitleBoth && sentence !== undefined && state !== null ? counterpartOf(state, sentence.start, plugins.overlay, session.store) : null;
  const floatingText = floating && spokenText !== null ? (second !== null ? `${spokenText}\u001e${second}` : spokenText) : null;
  // The floating subtitle: a window above all apps. It hides when the reading ends.
  useEffect(() => {
    if (showSubtitle === undefined) return;
    void showSubtitle.call(hostValue!.host, floatingText).catch(() => undefined);
  }, [floatingText, showSubtitle, hostValue]);
  if (speech === null) return null;
  const { error } = speech;
  if (state === null && error === null) return null;
  return (
    <div className="speech-layer">
      {state !== null && settings.speechMode === "subtitle" && !floating && sentence !== undefined && (
        <div className="speech-subtitle" dir="auto">
          {spokenText}
          {second !== null && <span className="speech-subtitle-second">{second}</span>}
        </div>
      )}
      <div className="speech-bar" role="toolbar" aria-label="Read aloud">
        {state === null ? (
          <span className="plugin-error">{error}</span>
        ) : state.preparing ? (
          <LoaderCircle size={16} className="spin" />
        ) : state.prepare != null ? (
          <span className="speech-prepare muted">
            <LoaderCircle size={14} className="spin" /> <span>{prepareLabel(state.prepare, prepareStart.current)}</span>
          </span>
        ) : (
          <>
            <LockReminder nudge={speech.lockNudge} />
            <button
              className={`icon-button small${settings.speechLock ? " active" : ""}`}
              data-tip={settings.speechLock ? "Locked: a click on the text does not move the reading (click to unlock)" : "Lock: a click on the text does not move the reading"}
              aria-pressed={settings.speechLock}
              onClick={() => speech.setLock(!settings.speechLock)}
            >
              {settings.speechLock ? <Lock size={14} /> : <LockOpen size={14} />}
            </button>
            <button className="icon-button small" data-tip="Show the text that is read now" onClick={() => showSpoken(state.sourceId)}>
              <LocateFixed size={14} />
            </button>
            <button
              className={`icon-button small${settings.speechShowReady ? " active" : ""}`}
              data-tip={settings.speechShowReady ? "Ready cursor: on (a bar where the ready audio ends; click to hide it)" : "Ready cursor: show where the ready audio ends (reading stops for a moment when it reaches the bar)"}
              aria-pressed={settings.speechShowReady}
              onClick={() => void session.updateSettings({ speechShowReady: !settings.speechShowReady })}
            >
              <Gauge size={14} />
            </button>
            <span className="speech-count muted" data-tip="Space pause and play · ← → previous and next sentence · ⌘, ⌥, or Ctrl + ← → speed">
              {state.current + 1} / {state.sentences.length}
            </span>
            <span className="speech-left muted" data-tip="Time left, about">
              {`${formatListenTime(wordsSeconds(wordsLeft?.[state.current] ?? 0, settings.speechRate)).replace("about ", "")} left`}
            </span>
            <button className="icon-button small" data-tip="Previous sentence" onClick={() => speech.step(-1)}>
              <SkipBack size={14} />
            </button>
            <button className="icon-button" data-tip={state.loading === true ? "Getting the voice ready…" : state.playing ? "Pause (Space)" : "Play (Space)"} onClick={() => (state.playing ? speech.pause() : speech.resume())}>
              {state.loading === true && state.playing ? <LoaderCircle size={16} className="spin" /> : state.playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button className="icon-button small" data-tip="Next sentence" onClick={() => speech.step(1)}>
              <SkipForward size={14} />
            </button>
            <label className="speech-slider" data-tip="Speed (double-click the number to type it)">
              <RateText rate={settings.speechRate} onRate={(rate) => speech.setRate(rate)} />
              <input
                type="range"
                min={SPEECH_RATE_RANGE.min}
                max={SPEECH_RATE_RANGE.max}
                step={0.05}
                value={settings.speechRate}
                onChange={(event) => speech.setRate(Number(event.target.value))}
              />
            </label>
            <label className="speech-slider" data-tip="Volume">
              <Volume2 size={14} />
              <input type="range" min={0} max={1} step={0.05} value={settings.speechVolume} onChange={(event) => speech.setVolume(Number(event.target.value))} />
            </label>
          </>
        )}
        <button className="icon-button small" data-tip={state === null ? "Close" : "Stop"} data-tip-end onClick={speech.stop}>
          {state === null ? <X size={14} /> : <Square size={13} />}
        </button>
      </div>
    </div>
  );
}

/**
 * The text with the spoken sentence marked. It scrolls the sentence into view. Read-only.
 * A click on a sentence goes to that sentence.
 */
export function SpokenText({ text, sentence }: { text: string; sentence: Sentence }) {
  const speech = useSpeech();
  const mark = useRef<HTMLElement>(null);
  useEffect(() => mark.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), [sentence.start]);
  // "Show the text that is read now" (the read-aloud bar): the sentence goes to the middle of the view.
  useEffect(() => onShowSpoken(() => mark.current?.scrollIntoView({ block: "center", behavior: "smooth" })), []);
  const sentences = speech?.state?.sentences ?? [sentence];
  const { settings } = useSessionState();
  // The "ready" cursor: after the last sentence whose audio is ready (only while it is ahead of the current one).
  const readyEnd = speech?.state?.readyEnd;
  const readyLast = settings.speechShowReady && readyEnd !== undefined && readyEnd - 1 > (speech?.state?.current ?? 0) ? readyEnd - 1 : -1;
  const parts: ReactNode[] = [];
  let at = 0;
  sentences.forEach((part, index) => {
    if (part.start > at) parts.push(text.slice(at, part.start));
    const current = part.start === sentence.start;
    parts.push(
      current ? (
        <mark key={index} ref={mark}>{text.slice(part.start, part.end)}</mark>
      ) : (
        <span key={index} className="spoken-sentence" onClick={() => speech?.clickSeek(part.start)}>
          {text.slice(part.start, part.end)}
        </span>
      ),
    );
    if (index === readyLast) parts.push(<span key={`ready:${index}`} className="ready-cursor" data-tip="The ready audio ends here" />);
    at = part.end;
  });
  parts.push(text.slice(at));
  return (
    <div className="transformed-text spoken-text" dir="auto">
      {parts}
    </div>
  );
}

/**
 * A read-only text with one line marked: the line that matches the spoken sentence in the other text
 * (for example the translation of the sentence that is read). A click on a line calls `onLine`.
 */
export function LineMarkedText({ text, line, onLine }: { text: string; line: number; onLine(line: number): void }) {
  const mark = useRef<HTMLDivElement>(null);
  useEffect(() => mark.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), [line]);
  return (
    <div className="transformed-text spoken-text line-marked" dir="auto">
      {text.split("\n").map((content, index) =>
        index === line ? (
          <div key={index} ref={mark} className="line-mark">
            {content === "" ? "\u200b" : content}
          </div>
        ) : (
          <div key={index} className="spoken-line" onClick={() => onLine(index)}>
            {content === "" ? "\u200b" : content}
          </div>
        ),
      )}
    </div>
  );
}

/** The text that matches the spoken sentence in the other version: the translation (or the original, when the translation is read). */
function counterpartOf(state: SpeechState, offset: number, overlay: OverlayMap, store: Store): string | null {
  if (state.sourceId.startsWith(WEB_SOURCE)) {
    const cached = cachedPageTranslation(state.sourceId.slice(WEB_SOURCE.length));
    if (cached === null) return null;
    const { paragraphs, texts } = cached;
    const pair = pageCounterpart(paragraphs, texts, offset);
    return pair === null ? null : (texts[pair.paragraph] ?? "").slice(pair.range.start, pair.range.end).trim() || null;
  }
  const result = overlay.get(state.sourceId);
  const other = state.side === "result" ? (store.get("texts", state.sourceId)?.body ?? null) : result?.shown === true ? (result.body ?? null) : null;
  if (other === null || other.trim() === "") return null;
  return textCounterpart(state.text, offset, other)?.trim() || null;
}
