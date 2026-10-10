// Read-aloud queue: plays one clip per sentence, in order. It gets the next clips before they are necessary:
// the current sentence first, then the next ones, at most PARALLEL at a time (the voice can make them in parallel).
// How far ahead (setting "speechAhead"):
// - "window": until about BUFFER_CHARACTERS of speech (about one minute) are ready ahead. Not more: a step or a stop
//   does not waste work, and memory stays small.
// - "end": all clips to the end of the text, while it plays.
// - "all": all clips first; then it plays (progress in onPrepare). The clips stay: a step back needs no new clip.
// Speed and volume change at once: they apply to the playing audio, not to the speech data.

import type { Sentence } from "../../io/plugins";

/** The part of an audio element that the queue uses. Tests give a fake. */
export type AudioOutput = {
  /** Plays the URL from its start. Resolves when the clip ends. Rejects on an error. */
  play(url: string): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  setRate(rate: number): void;
  setVolume(volume: number): void;
};

export type QueueEvents = {
  onSentence(index: number): void;
  onState(playing: boolean): void;
  /** True while the queue waits for the audio of the sentence to play (for example the first time a voice starts). */
  onLoading?(loading: boolean): void;
  onEnd(): void;
  onError(error: string): void;
  /** Mode "all": the clips that are ready before it plays (null: it plays now). */
  onPrepare?(progress: { done: number; total: number } | null): void;
};

export type SpeechAhead = "window" | "end" | "all";

/** Speech that the queue gets ready ahead of the current sentence: about one minute at normal speed. */
export const BUFFER_CHARACTERS = 900;
/** At least and at most this many clips ahead (mode "window"). */
const AHEAD = { min: 2, max: 20 };
/** Clips that the queue requests at the same time. More would only wait in the voice. */
export const PARALLEL = 2;

export class SpeechQueue {
  private clips = new Map<number, Promise<string>>();
  private index = 0;
  /** Each start or seek makes a new run. An old run stops at its next step. */
  private run = 0;
  private paused = false;
  /** True while a clip plays (also while it is paused). Between clips, pause and resume act on the queue only. */
  private clipPlaying = false;
  /** The run waits here while it is paused between clips. */
  private resumers: (() => void)[] = [];
  /** Each stop or refresh drops the clips: requests of an older epoch do not count. */
  private epoch = 0;
  private inFlight = 0;
  private ready = new Set<number>();
  private waiters: (() => void)[] = [];

  constructor(
    private readonly sentences: readonly Sentence[],
    private readonly fetchClip: (sentence: Sentence) => Promise<string>,
    private readonly audio: AudioOutput,
    private readonly events: QueueEvents,
    private readonly releaseClip: (url: string) => void = () => undefined,
    private readonly ahead: SpeechAhead = "window",
  ) {}

  start(from = 0): void {
    this.run += 1;
    this.paused = false;
    this.wakeResumers();
    this.audio.stop();
    this.index = Math.max(0, Math.min(from, this.sentences.length - 1));
    void this.playFrom(this.run);
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    if (this.clipPlaying) this.audio.pause();
    this.events.onState(false);
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.clipPlaying) this.audio.resume();
    this.wakeResumers();
    this.events.onState(true);
  }

  private wakeResumers(): void {
    const resumers = this.resumers;
    this.resumers = [];
    for (const resume of resumers) resume();
  }

  /**
   * Drops the clips made so far (for example after a change of the voice or the pitch) and plays the current
   * sentence again: the change shows at once.
   */
  refresh(): void {
    this.drop();
    this.start(this.index);
  }

  /** Goes to the sentence before or after the current one. */
  step(delta: number): void {
    this.start(this.index + delta);
  }

  stop(): void {
    this.run += 1;
    this.audio.stop();
    this.drop();
    this.wakeResumers();
  }

  private drop(): void {
    for (const clip of this.clips.values()) void clip.then(this.releaseClip, () => undefined);
    this.clips.clear();
    this.ready.clear();
    this.epoch += 1;
    this.inFlight = 0;
    this.wake();
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter();
  }

  currentIndex(): number {
    return this.index;
  }

  /** The clip of a sentence: it requests it now if it has no request yet. */
  private clipAt(index: number): Promise<string> {
    let clip = this.clips.get(index);
    if (clip === undefined) {
      const epoch = this.epoch;
      this.inFlight += 1;
      clip = this.fetchClip(this.sentences[index]!);
      this.clips.set(index, clip);
      const settle = () => {
        if (epoch !== this.epoch) return;
        this.inFlight -= 1;
        this.ready.add(index);
        this.wake();
        this.fill();
      };
      clip.then(settle, settle);
    }
    return clip;
  }

  /** The end (exclusive) of the clips to get ready ahead of the current sentence. */
  private aheadEnd(): number {
    if (this.ahead !== "window") return this.sentences.length;
    let buffered = 0;
    let end = this.index + 1;
    for (let ahead = 1; this.index + ahead < this.sentences.length && ahead <= AHEAD.max && (ahead <= AHEAD.min || buffered < BUFFER_CHARACTERS); ahead += 1) {
      buffered += this.sentences[this.index + ahead]!.speech.length;
      end = this.index + ahead + 1;
    }
    return end;
  }

  /** Requests the next clips that have no request yet, while fewer than PARALLEL run. */
  private fill(): void {
    const end = this.aheadEnd();
    for (let index = this.index; index < end && this.inFlight < PARALLEL; index += 1) {
      if (!this.clips.has(index)) void this.clipAt(index).catch(() => undefined);
    }
  }

  /** Mode "all": waits until each clip is ready (or failed). False if a new run started. */
  private async prepareAll(run: number): Promise<boolean> {
    const total = this.sentences.length;
    while (run === this.run && this.ready.size < total) {
      this.events.onPrepare?.({ done: this.ready.size, total });
      this.fill();
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.events.onPrepare?.(null);
    return run === this.run;
  }

  private async playFrom(run: number): Promise<void> {
    this.events.onState(true);
    if (this.ahead === "all" && !(await this.prepareAll(run))) return;
    while (run === this.run && this.index < this.sentences.length) {
      const index = this.index;
      // The current clip first (also when PARALLEL requests run), then the next ones.
      const current = this.clipAt(index);
      this.fill();
      this.events.onSentence(index);
      try {
        this.events.onLoading?.(true);
        const url = await current;
        this.events.onLoading?.(false);
        // A pause while the clip was made, or between two clips: the next clip waits for "resume".
        while (this.paused && run === this.run) await new Promise<void>((resolve) => this.resumers.push(resolve));
        if (run !== this.run) return;
        this.clipPlaying = true;
        try {
          await this.audio.play(url);
        } finally {
          this.clipPlaying = false;
        }
      } catch (error) {
        if (run === this.run) {
          this.events.onLoading?.(false);
          this.events.onState(false);
          this.events.onError(String(error));
        }
        return;
      }
      if (run !== this.run) return;
      this.index = index + 1;
      // Keep one played clip (for a step back). Release older ones. Mode "all" keeps all clips.
      if (this.ahead !== "all") {
        for (const [key, clip] of this.clips) {
          if (key < index) {
            this.clips.delete(key);
            this.ready.delete(key);
            void clip.then(this.releaseClip, () => undefined);
          }
        }
      }
    }
    if (run === this.run) {
      this.events.onState(false);
      this.events.onEnd();
    }
  }
}
