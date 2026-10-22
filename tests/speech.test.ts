import { describe, expect, it, vi } from "vitest";
import { readClip, readSentences, type Sentence } from "../src/io/plugins";
import { readSettings } from "../src/io/settings";
import { AGE_STEP_MS, SpeechQueue, type AudioOutput } from "../src/ui/plugins/speechQueue";
import { formatListenTime, listenSeconds, wordCount, wordsSeconds, wordsToEnd } from "../src/ui/plugins/listenTime";

/** Audio that ends each clip when the test says so. */
class FakeAudio implements AudioOutput {
  played: string[] = [];
  preload?: (url: string) => void;
  rate = 1;
  private finish: (() => void) | null = null;
  play(url: string, _started?: () => void): Promise<void> {
    this.played.push(url);
    return new Promise((resolve) => (this.finish = resolve));
  }
  end(): void {
    const finish = this.finish;
    this.finish = null;
    finish?.();
  }
  pause(): void {}
  resume(): void {}
  stop(): void {
    this.end();
  }
  setRate(rate: number): void {
    this.rate = rate;
  }
  setVolume(): void {}
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function sentences(count: number): Sentence[] {
  return Array.from({ length: count }, (_, index) => ({ start: index * 10, end: index * 10 + 5, speech: `s${index}` }));
}

describe("speech queue", () => {
  it("plays each sentence in order and gets clips in advance", async () => {
    const audio = new FakeAudio();
    const fetched: string[] = [];
    const seen: number[] = [];
    let ended = false;
    const released: string[] = [];
    const queue = new SpeechQueue(
      sentences(4),
      async (sentence) => (fetched.push(sentence.speech), `url-${sentence.speech}`),
      audio,
      { onSentence: (index) => seen.push(index), onState: () => undefined, onEnd: () => (ended = true), onError: () => undefined },
      (url) => released.push(url),
    );
    queue.start();
    await flush();
    expect(audio.played).toEqual(["url-s0"]);
    // The current sentence first, then the next ones (short sentences: more of them, up to the buffer size).
    expect(fetched).toEqual(["s0", "s1", "s2", "s3"]);
    for (let index = 0; index < 4; index += 1) {
      audio.end();
      await flush();
    }
    expect(audio.played).toEqual(["url-s0", "url-s1", "url-s2", "url-s3"]);
    expect(seen).toEqual([0, 1, 2, 3]);
    expect(ended).toBe(true);
    // Played clips stay for a step back (KEEP_BEHIND) until the queue stops.
    expect(released).toEqual([]);
  });

  it("loads the next clip while a clip plays (double buffering)", async () => {
    const audio = new FakeAudio();
    const preloaded: string[] = [];
    audio.preload = (url) => preloaded.push(url);
    const queue = new SpeechQueue(sentences(3), async (sentence) => `url-${sentence.speech}`, audio, { onSentence: () => undefined, onState: () => undefined, onEnd: () => undefined, onError: () => undefined }, () => undefined);
    queue.start();
    await flush();
    // Clip 0 plays; clip 1 is loading in the other element before clip 0 ends.
    expect(audio.played).toEqual(["url-s0"]);
    expect(preloaded).toEqual(["url-s1"]);
    audio.end();
    await flush();
    expect(audio.played).toEqual(["url-s0", "url-s1"]);
    expect(preloaded).toEqual(["url-s1", "url-s2"]);
    queue.stop();
  });

  it("shows loading until the sound starts, not only until the clip is made", async () => {
    let started: (() => void) | undefined;
    const audio = new FakeAudio();
    const play = audio.play.bind(audio);
    audio.play = (url, onStarted) => ((started = onStarted), play(url));
    const loading: boolean[] = [];
    const queue = new SpeechQueue(sentences(2), async (sentence) => sentence.speech, audio, {
      onSentence: () => undefined,
      onState: () => undefined,
      onLoading: (value) => loading.push(value),
      onEnd: () => undefined,
      onError: () => undefined,
    });
    queue.start();
    await flush();
    // The clip is made and given to the audio, but the sound did not start yet.
    expect(audio.played).toEqual(["s0"]);
    expect(loading.at(-1)).toBe(true);
    started?.();
    expect(loading.at(-1)).toBe(false);
    // The next clip is ready: no loading state between the sentences.
    audio.end();
    await flush();
    expect(audio.played).toEqual(["s0", "s1"]);
    expect(loading.at(-1)).toBe(false);
  });

  it("drops the made clips of some sentences ahead and makes them again (formulas after a speed change)", async () => {
    const audio = new FakeAudio();
    const fetched: string[] = [];
    const released: string[] = [];
    let version = 1;
    const queue = new SpeechQueue(
      sentences(4),
      async (sentence) => (fetched.push(sentence.speech), `${sentence.speech}-v${version}`),
      audio,
      { onSentence: () => undefined, onState: () => undefined, onEnd: () => undefined, onError: () => undefined },
      (url) => released.push(url),
    );
    queue.start();
    await flush();
    version = 2;
    // Sentence 0 plays (it stays); sentence 2 is made again.
    queue.dropAhead([0, 2]);
    await flush();
    expect(fetched).toEqual(["s0", "s1", "s2", "s3", "s2"]);
    expect(released).toEqual(["s2-v1"]);
    for (let index = 0; index < 3; index += 1) {
      audio.end();
      await flush();
    }
    expect(audio.played).toEqual(["s0-v1", "s1-v1", "s2-v2", "s3-v1"]);
  });

  it("a step starts at the new sentence and the old run stops", async () => {
    const audio = new FakeAudio();
    const queue = new SpeechQueue(sentences(5), async (sentence) => sentence.speech, audio, {
      onSentence: () => undefined,
      onState: () => undefined,
      onEnd: () => undefined,
      onError: () => undefined,
    });
    queue.start();
    await flush();
    queue.step(2);
    await flush();
    expect(audio.played).toEqual(["s0", "s2"]);
    expect(queue.currentIndex()).toBe(2);
  });

  it("a pause between clips stops the reading until resume", async () => {
    const audio = new FakeAudio();
    const queue = new SpeechQueue(sentences(3), async (sentence) => sentence.speech, audio, {
      onSentence: () => undefined,
      onState: () => undefined,
      onEnd: () => undefined,
      onError: () => undefined,
    });
    queue.start();
    await flush();
    expect(audio.played).toEqual(["s0"]);
    // The clip ends, and the user pauses before the next one plays.
    audio.end();
    queue.pause();
    await flush();
    await flush();
    expect(audio.played).toEqual(["s0"]);
    queue.resume();
    await flush();
    expect(audio.played).toEqual(["s0", "s1"]);
  });

  it("reports a clip error and stops", async () => {
    const errors: string[] = [];
    const queue = new SpeechQueue(sentences(2), async () => Promise.reject(new Error("no voice")), new FakeAudio(), {
      onSentence: () => undefined,
      onState: () => undefined,
      onEnd: () => undefined,
      onError: (error) => errors.push(error),
    });
    queue.start();
    await flush();
    expect(errors).toEqual(["Error: no voice"]);
  });
});

describe("speech queue: audio ahead", () => {
  /** Clips that finish when the test says so. */
  function slowVoice() {
    const pending: { speech: string; finish(): void }[] = [];
    const fetch = (sentence: Sentence) => new Promise<string>((resolve) => pending.push({ speech: sentence.speech, finish: () => resolve(`url-${sentence.speech}`) }));
    return { pending, fetch };
  }
  const events = (extra: Partial<Parameters<typeof makeQueue>[2]> = {}) => ({ onSentence: () => undefined, onState: () => undefined, onEnd: () => undefined, onError: () => undefined, ...extra });
  const makeQueue = (count: number, voice: ReturnType<typeof slowVoice>, events: ConstructorParameters<typeof SpeechQueue>[3], ahead: "window" | "end" | "all", audio = new FakeAudio()) =>
    new SpeechQueue(sentences(count), voice.fetch, audio, events, () => undefined, ahead);

  it("asks for at most two clips at a time, and the next ones when a clip is ready", async () => {
    const voice = slowVoice();
    const queue = makeQueue(6, voice, events(), "window");
    queue.start();
    await flush();
    expect(voice.pending.map((clip) => clip.speech)).toEqual(["s0", "s1"]);
    voice.pending[0]!.finish();
    await flush();
    expect(voice.pending.map((clip) => clip.speech)).toEqual(["s0", "s1", "s2"]);
  });

  it("goes on making clips ahead while paused; an other reading takes the voice and the old clips age out", async () => {
    const released: string[] = [];
    const first = new SpeechQueue(sentences(8), async (sentence) => sentence.speech, new FakeAudio(), events(), (url) => released.push(url), "window");
    first.start();
    first.pause();
    for (let step = 0; step < 10; step += 1) await flush();
    const second = new SpeechQueue(sentences(2), async (sentence) => sentence.speech, new FakeAudio(), events(), () => undefined, "window");
    vi.useFakeTimers();
    try {
      second.start();
      expect(released).toEqual([]);
      await vi.advanceTimersByTimeAsync(AGE_STEP_MS);
      // The farthest clip goes first.
      expect(released).toEqual(["s7"]);
      await vi.advanceTimersByTimeAsync(AGE_STEP_MS * 2);
      expect(released).toEqual(["s7", "s6", "s5"]);
    } finally {
      vi.useRealTimers();
      first.stop();
      second.stop();
    }
  });

  it("mode all: makes all clips first, then plays", async () => {
    const voice = slowVoice();
    const audio = new FakeAudio();
    const progress: ({ done: number; total: number } | null)[] = [];
    const queue = makeQueue(3, voice, events({ onPrepare: (value) => progress.push(value) }), "all", audio);
    queue.start();
    for (let step = 0; step < 3; step += 1) {
      await flush();
      voice.pending[step]!.finish();
    }
    await flush();
    await flush();
    expect(voice.pending.map((clip) => clip.speech)).toEqual(["s0", "s1", "s2"]);
    expect(progress[0]).toEqual({ done: 0, total: 3 });
    expect(progress.at(-1)).toBeNull();
    expect(audio.played).toEqual(["url-s0"]);
  });
});

describe("speech replies and settings", () => {
  it("drops bad and overlapping sentences", () => {
    const value = {
      sentences: [
        { start: 0, end: 5, speech: "Hello" },
        { start: 3, end: 8, speech: "overlap" },
        { start: 6, end: 6, speech: "empty" },
        { start: 6, end: 99, speech: "too long" },
        { start: 6, end: 10, speech: "World" },
      ],
    };
    expect(readSentences(value, 10).map((sentence) => sentence.speech)).toEqual(["Hello", "World"]);
    expect(() => readClip({ audio: "", mime: "audio/wav" })).toThrow();
    expect(readClip({ audio: "AAA=", mime: "audio/mpeg" }).mime).toBe("audio/mpeg");
  });

  it("reads speech settings and plugin options with checks", () => {
    const settings = readSettings(JSON.stringify({ speechRate: 9, speechVolume: 0.5, speechMode: "subtitle", pluginOptions: { voice: { voice: "x", bad: 1 }, junk: 3 } }));
    expect(settings.speechRate).toBe(1);
    expect(settings.speechVolume).toBe(0.5);
    expect(settings.speechMode).toBe("subtitle");
    expect(settings.pluginOptions).toEqual({ voice: { voice: "x" } });
    expect(readSettings(undefined).pluginOptions).toEqual({});
  });
});

describe("ready cursor", () => {
  it("reports how far the audio is ready from the current sentence", async () => {
    const audio = new FakeAudio();
    const ready: number[] = [];
    const queue = new SpeechQueue(sentences(3), async (sentence) => sentence.speech, audio, {
      onSentence: () => undefined,
      onState: () => undefined,
      onEnd: () => undefined,
      onError: () => undefined,
      onReady: (end) => ready.push(end),
    });
    queue.start();
    await flush();
    expect(ready.at(-1)).toBe(3);
    audio.end();
    await flush();
    expect(ready.at(-1)).toBe(3);
  });
});

describe("listen time", () => {
  it("counts words and CJK characters", () => {
    expect(wordCount("The quick brown fox — it's 2026.")).toBe(6);
    expect(wordCount("你好世界")).toBeCloseTo(2.4);
  });

  it("gives a rough time at a speed", () => {
    const text = "word ".repeat(165);
    expect(listenSeconds(text, 1)).toBeCloseTo(60);
    expect(listenSeconds(text, 2)).toBeCloseTo(30);
    // The time left: counted one time for all sentences, the same as counting the rest of the text.
    const sentences = [{ speech: "One two three." }, { speech: "Four five." }, { speech: "Six." }];
    const after = wordsToEnd(sentences);
    expect([...after]).toEqual([6, 3, 1, 0]);
    expect(wordsSeconds(after[1]!, 1.5)).toBeCloseTo(listenSeconds("Four five. Six.", 1.5));
    expect(formatListenTime(12)).toBe("about 10 s");
    expect(formatListenTime(60 * 12.4)).toBe("about 12 min");
    expect(formatListenTime(60 * 80)).toBe("about 1 h 20 min");
    expect(formatListenTime(60 * 120)).toBe("about 2 h");
  });
});
