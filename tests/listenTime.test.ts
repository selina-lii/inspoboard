import { describe, expect, it } from "vitest";
import { formatListenTime, listenSeconds, wordCount } from "../src/ui/plugins/listenTime";

describe("listen time", () => {
  it("counts words and CJK characters", () => {
    expect(wordCount("The quick brown fox — it's 2026.")).toBe(6);
    expect(wordCount("你好世界")).toBeCloseTo(2.4);
  });

  it("gives a rough time at a speed", () => {
    const text = "word ".repeat(165);
    expect(listenSeconds(text, 1)).toBeCloseTo(60);
    expect(listenSeconds(text, 2)).toBeCloseTo(30);
    expect(formatListenTime(12)).toBe("about 10 s");
    expect(formatListenTime(60 * 12.4)).toBe("about 12 min");
    expect(formatListenTime(60 * 80)).toBe("about 1 h 20 min");
    expect(formatListenTime(60 * 120)).toBe("about 2 h");
  });
});
