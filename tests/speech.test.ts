import { describe, expect, it } from "vitest";
import { readClip, readSentences, type Sentence } from "../src/io/plugins";
import { readSettings } from "../src/io/settings";
import { SpeechQueue, type AudioOutput } from "../src/ui/plugins/speechQueue";

/** Audio that ends each clip when the test says so. */
class FakeAudio implements AudioOutput {
  played: string[] = [];
  rate = 1;
  private finish: (() => void) | null = null;
  play(url: string): Promise<void> {
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
    expect(released).toContain("url-s0");
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
