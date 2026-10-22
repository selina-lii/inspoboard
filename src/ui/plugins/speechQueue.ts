// Read-aloud queue: plays one clip per sentence, in order. It gets the next clips before they are necessary:
// the current sentence first, then the next ones, at most PARALLEL at a time (the voice can make them in parallel).
// How far ahead (setting "speechAhead"):
// - "window": up to AHEAD_MAX sentences ahead (default). It goes on while the reading is paused.
//   When an other reading starts to make audio (an other queue starts), this queue stops making new clips and
//   releases its clips one at a time (AGE_STEP_MS each, the clips farthest from its current sentence first): the
//   memory goes back slowly, and a quick return still finds the near clips. A start or resume of this queue stops that.
//   Played clips stay for a step back: at most KEEP_BEHIND of them.
// - "end": all clips to the end of the text, while it plays.
// - "all": all clips first; then it plays (progress in onPrepare). The clips stay: a step back needs no new clip.
// Speed and volume change at once: they apply to the playing audio, not to the speech data.

import type { Sentence } from "../../io/plugins";

/** The part of an audio element that the queue uses. Tests give a fake. */
export type AudioOutput = {
  /** Plays the URL from its start. Calls "started" when the sound starts. Resolves when the clip ends. Rejects on an error. */
  play(url: string, started?: () => void): Promise<void>;
  /** Loads the next clip while the current one plays, so that it starts at once (optional). */
  preload?(url: string): void;
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
  /** The audio is ready from the current sentence up to this sentence index (not included): the "ready" cursor. */
  onReady?(end: number): void;
};

export type SpeechAhead = "window" | "end" | "all";

/** At most this many clips ahead of the current sentence (mode "window"). */
export const AHEAD_MAX = 100;
/** Played clips that stay (for a step back). */
export const KEEP_BEHIND = 10;
/** A queue that gave the voice to an other queue releases one clip each this many ms. */
export const AGE_STEP_MS = 3000;

/** The queues that have clips (not stopped). The one that starts last has the voice. */
const queues = new Set<SpeechQueue>();
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
  /** An other queue started: this one makes no clips ahead, and releases its clips slowly. */
  private yielded = false;
  private ageTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly sentences: readonly Sentence[],
    private readonly fetchClip: (sentence: Sentence) => Promise<string>,
    private readonly audio: AudioOutput,
    private readonly events: QueueEvents,
    private readonly releaseClip: (url: string) => void = () => undefined,
    private readonly ahead: SpeechAhead = "window",
  ) {}

  /** This queue makes audio now: the other queues stop making clips ahead. */
  private takeVoice(): void {
    for (const other of queues) if (other !== this) other.yieldVoice();
    queues.add(this);
    this.yielded = false;
    if (this.ageTimer !== null) clearInterval(this.ageTimer);
    this.ageTimer = null;
  }

  private yieldVoice(): void {
    if (this.yielded) return;
    this.yielded = true;
    this.ageTimer = setInterval(() => this.ageOne(), AGE_STEP_MS);
  }

  /** Releases the ready clip farthest from the current sentence (not the current one). */
  private ageOne(): void {
    let farthest: number | null = null;
    for (const key of this.ready) if (key !== this.index && (farthest === null || Math.abs(key - this.index) > Math.abs(farthest - this.index))) farthest = key;
    if (farthest === null) {
      if (this.ageTimer !== null) clearInterval(this.ageTimer);
      this.ageTimer = null;
      return;
    }
    const clip = this.clips.get(farthest);
    this.clips.delete(farthest);
    this.ready.delete(farthest);
    if (clip !== undefined) void clip.then(this.releaseClip, () => undefined);
    this.reportReady();
  }

  start(from = 0): void {
    this.takeVoice();
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
    this.takeVoice();
    this.fill();
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

  /**
   * Drops the clips of these sentences after the current one (for example clips with formulas, made at an old speed):
   * they are made again. The current clip plays on.
   */
  dropAhead(indexes: Iterable<number>): void {
    for (const index of indexes) {
      if (index <= this.index) continue;
      const clip = this.clips.get(index);
      if (clip === undefined) continue;
      this.clips.delete(index);
      if (this.ready.delete(index)) void clip.then(this.releaseClip, () => undefined);
    }
    this.reportReady();
    this.fill();
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
    queues.delete(this);
    if (this.ageTimer !== null) clearInterval(this.ageTimer);
    this.ageTimer = null;
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
      const made = clip;
      const settle = () => {
        if (epoch !== this.epoch) return;
        this.inFlight -= 1;
        // A clip that was dropped while it was made (dropAhead): it does not count.
        if (this.clips.get(index) !== made) {
          void made.then(this.releaseClip, () => undefined);
          this.fill();
          return;
        }
        this.ready.add(index);
        this.reportReady();
        this.wake();
        this.fill();
      };
      clip.then(settle, settle);
    }
    return clip;
  }

  /** Tells how far the audio is ready without a gap, from the current sentence. */
  private reportReady(): void {
    let end = this.index;
    while (end < this.sentences.length && this.ready.has(end)) end += 1;
    this.events.onReady?.(end);
  }

  /** The end (exclusive) of the clips to get ready ahead of the current sentence. */
  private aheadEnd(): number {
    // A queue that gave the voice away makes only the clip that it must play now.
    if (this.yielded) return Math.min(this.sentences.length, this.index + 1);
    if (this.ahead !== "window") return this.sentences.length;
    return Math.min(this.sentences.length, this.index + 1 + AHEAD_MAX);
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
      this.reportReady();
      try {
        // "Loading" until the sound starts (not only until the clip is made): the first start of the audio can take time.
        const waiting = !this.ready.has(index);
        this.events.onLoading?.(waiting);
        const url = await current;
        // A pause while the clip was made, or between two clips: the next clip waits for "resume".
        while (this.paused && run === this.run) await new Promise<void>((resolve) => this.resumers.push(resolve));
        if (run !== this.run) return;
        this.clipPlaying = true;
        const started = () => {
          if (run === this.run) this.events.onLoading?.(false);
        };
        // The next clip, if it is made already (fill asked for it): it loads while this one plays.
        const next = this.clips.get(index + 1);
        if (next !== undefined && this.audio.preload !== undefined) void next.then((nextUrl) => run === this.run && this.audio.preload?.(nextUrl), () => undefined);
        try {
          await this.audio.play(url, started);
          started();
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
      // Keep some played clips (for a step back). Release older ones. Mode "all" keeps all clips.
      if (this.ahead !== "all") {
        for (const [key, clip] of this.clips) {
          if (key <= index - KEEP_BEHIND) {
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
