import { describe, expect, it } from "vitest";
import { findAll } from "../src/ui/web/readerShared";
import { matchingSentence, pageCounterpart, sentenceRanges, textCounterpart } from "../src/ui/plugins/sentencePairs";

const slice = (text: string, range: { start: number; end: number } | null) => (range === null ? null : text.slice(range.start, range.end));

describe("matching sentences of a translation", () => {
  it("splits Latin and Chinese sentences", () => {
    const en = "The cell divides. Then it grows! Does it stop?";
    expect(sentenceRanges(en).map((range) => en.slice(range.start, range.end))).toEqual(["The cell divides.", "Then it grows!", "Does it stop?"]);
    const zh = "细胞分裂。然后它生长！它会停止吗？";
    expect(sentenceRanges(zh).map((range) => zh.slice(range.start, range.end))).toEqual(["细胞分裂。", "然后它生长！", "它会停止吗？"]);
  });

  it("finds the sentence with the same number, else the one at the same place", () => {
    const en = "The cell divides. Then it grows! Does it stop?";
    const zh = "细胞分裂。然后它生长！它会停止吗？";
    expect(slice(zh, matchingSentence(en, en.indexOf("Then"), zh))).toBe("然后它生长！");
    const two = "细胞分裂，然后生长。它会停止吗？";
    expect(slice(two, matchingSentence(en, en.indexOf("Does"), two))).toBe("它会停止吗？");
    expect(matchingSentence(en, 0, "")).toBeNull();
  });

  it("finds the paragraph of a web page and waits for its translation", () => {
    const paragraphs = [
      { start: 0, end: 10, text: "First one." },
      { start: 11, end: 31, text: "Second. And a third." },
    ];
    expect(pageCounterpart(paragraphs, ["第一。", "第二。还有第三。"], 20)).toEqual({ paragraph: 1, range: { start: 3, end: 8 } });
    expect(pageCounterpart(paragraphs, ["第一。", null], 20)).toBeNull();
  });

  it("finds the matching text of an item line by line", () => {
    expect(textCounterpart("Title\nOne. Two.", 12, "标题\n一。二。")).toBe("二。");
  });

  it("find in page: all places, not case-sensitive", () => {
    expect(findAll("Cell and cell and CELL", "cell")).toEqual([{ start: 0, end: 4 }, { start: 9, end: 13 }, { start: 18, end: 22 }]);
    expect(findAll("text", "  ")).toEqual([]);
  });
});
