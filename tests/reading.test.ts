import { describe, expect, it } from "vitest";
import { NO_SKIP, readSettings, type SpeechSkip } from "../src/io/settings";
import { readingMode, looksLikeMarkdown, markdownSpeech, filterReference, filterSpeech, latinShare, lineAt, lineStart, matchingLine, prepareSentences, referenceRanges } from "../src/ui/plugins/reading";
import { readableText } from "../src/ui/plugins/speech";
import type { Overlay } from "../src/ui/plugins/overlay";

const skip = (fields: Partial<SpeechSkip>): SpeechSkip => ({ ...NO_SKIP, ...fields });

describe("read-aloud skip rules", () => {
  it("skips citations of each style, and keeps other text in parentheses", () => {
    const citations = skip({ authorDate: true, authorPage: true, numbered: true });
    expect(filterSpeech("Growth was fast (Smith, 2020).", citations)).toBe("Growth was fast.");
    expect(filterSpeech("As Smith (2020) said, it works.", citations)).toBe("As Smith said, it works.");
    expect(filterSpeech("It works (Lee & Park, 2019, p. 4; Kim et al., 2021).", citations)).toBe("It works.");
    expect(filterSpeech("Fast (Smith 23).", citations)).toBe("Fast.");
    expect(filterSpeech("Known [1] and [2, 5–7].", citations)).toBe("Known and.");
    expect(filterSpeech("It grew.12 The end.", citations)).toBe("It grew. The end.");
    expect(filterSpeech("Founded (in 1998) here; COVID-19 in 2020.", citations)).toBe("Founded (in 1998) here; COVID-19 in 2020.");
    expect(filterSpeech("A (b (c)) d [e] f.", skip({ parentheses: true, brackets: true }))).toBe("A d f.");
    expect(filterSpeech("Nothing (Smith, 2020) skipped.", NO_SKIP)).toBe("Nothing (Smith, 2020) skipped.");
  });

  it("reads reference entries without the skipped parts", () => {
    const all = skip({ referenceAuthors: true, referenceDates: true, referencePages: true, referenceLinks: true });
    expect(filterReference("- Smith, J. A., & Lee, K. (2020). Deep notes. *Journal of X*, 12(3), 45–67. https://doi.org/10.1/abc", all)).toBe("Deep notes. Journal of X, 12(3).");
    expect(filterReference("[1] J. Smith and K. Lee, “Deep notes,” IEEE Trans., vol. 3, pp. 4–9, 2020.", all)).toBe("“Deep notes,” IEEE Trans., vol. 3.");
    expect(filterReference("Smith, John. The Book of Notes. Penguin, 2019.", all)).toBe("The Book of Notes. Penguin.");
    expect(filterReference("Smith, J. (2020). Notes.", skip({ referenceAuthors: true }))).toBe("(2020). Notes.");
  });

  it("finds reference lists, reads each entry as one sentence, or skips the list", () => {
    const text = "Intro (Smith, 2020).\n\n## References\nSmith, J. (2020). A. B.\n\n## Next\nEnd.";
    expect(referenceRanges(text)).toEqual([{ start: 36, end: 61 }]);
    const sentences = [
      { start: 0, end: 20, speech: "Intro (Smith, 2020)." },
      { start: 36, end: 45, speech: "Smith, J." },
      { start: 46, end: 52, speech: "(2020)." },
      { start: 66, end: 70, speech: "End." },
    ];
    expect(prepareSentences(text, sentences, skip({ referenceAuthors: true, authorDate: true }), "markdown")).toEqual([
      { start: 0, end: 20, speech: "Intro." },
      { start: 36, end: 59, speech: "(2020). A. B." },
      { start: 66, end: 70, speech: "End." },
    ]);
    expect(prepareSentences(text, sentences, skip({ referenceList: true }), "markdown").map((sentence) => sentence.speech)).toEqual(["Intro (Smith, 2020).", "End."]);
    // Paper mode (and auto-detect, for a text with a reference list): the reference list is not read.
    expect(prepareSentences(text, sentences, NO_SKIP, "paper").map((sentence) => sentence.speech)).toEqual(["Intro (Smith, 2020).", "End."]);
    expect(prepareSentences(text, sentences, NO_SKIP, "auto").map((sentence) => sentence.speech)).toEqual(["Intro (Smith, 2020).", "End."]);
    expect(referenceRanges("Text\nBibliography\nA. 2020.")).toEqual([{ start: 18, end: 26 }]);
  });

  it("keeps skip settings and drops bad values", () => {
    const settings = readSettings(JSON.stringify({ speechSkip: { numbered: true, parentheses: "yes", junk: true }, transformLayout: "side", transformSplit: 0.9, subtitleFloating: false }));
    expect(settings.speechSkip).toEqual({ ...NO_SKIP, numbered: true });
    expect(settings.transformLayout).toBe("side");
    expect(settings.transformSplit).toBe(0.5);
    expect(settings.subtitleFloating).toBe(false);
  });
});

describe("read-aloud of Markdown", () => {
  it("reads Markdown without its marks", () => {
    expect(markdownSpeech("## Results and *more*")).toBe("Results and more");
    expect(markdownSpeech("- [x] **Done** with `code` and [the paper](https://a.example)")).toBe("Done with code and the paper");
    expect(markdownSpeech("> A quote ![chart](images/a.png)")).toBe("A quote chart");
    expect(markdownSpeech("| Name | Year |")).toBe("Name, Year");
    expect(markdownSpeech("snake_case stays, 2 * 3 too")).toBe("snake_case stays, 2 3 too");
    expect(looksLikeMarkdown("# Title\ntext")).toBe(true);
    expect(looksLikeMarkdown("Plain words. More words.")).toBe(false);
  });

  it("uses the voice-out mode: auto-detect, markdown, paper", () => {
    const text = "# Title\nPlain.";
    const sentences = [{ start: 0, end: 7, speech: "# Title" }, { start: 8, end: 14, speech: "Plain." }];
    expect(readingMode(text, "auto")).toBe("markdown");
    expect(readingMode("Plain words.", "auto")).toBe("plain");
    expect(readingMode("Text.\nReferences\nA.", "auto")).toBe("paper");
    expect(prepareSentences(text, sentences, NO_SKIP, "auto")[0]!.speech).toBe("Title");
    expect(prepareSentences("A *b*", [{ start: 0, end: 5, speech: "A *b*" }], NO_SKIP, "markdown")[0]!.speech).toBe("A b");
    expect(readSettings(JSON.stringify({ speechMarkdown: "always" })).speechMarkdown).toBe("markdown");
    expect(readSettings(JSON.stringify({ speechMarkdown: "never" })).speechMarkdown).toBe("auto");
  });
});

describe("read-aloud with a translation", () => {
  const overlay = (body: string, shown = true): Overlay => ({ plugin: "t", optionsKey: "", title: null, body, titleSource: null, bodySource: "", shown });

  it("reads the English text: the original of an English text, the translation of a Chinese text", () => {
    expect(readableText("Hello there.", overlay("你好。"))).toEqual({ text: "Hello there.", side: "original" });
    expect(readableText("你好。", overlay("Hello."))).toEqual({ text: "Hello.", side: "result" });
    expect(readableText("你好。", overlay("Hello.", false))).toEqual({ text: "你好。", side: "original" });
    expect(readableText("Hi", undefined)).toEqual({ text: "Hi", side: "original" });
    expect(latinShare("abc 中文")).toBeCloseTo(0.6);
  });

  it("maps lines between a text and its translation", () => {
    const text = "a\nbb\nccc";
    expect(lineAt(text, 0)).toBe(0);
    expect(lineAt(text, 3)).toBe(1);
    expect(lineStart(text, 2)).toBe(5);
    expect(lineStart(text, 9)).toBe(text.length);
    expect(matchingLine(2, 3, 3)).toBe(2);
    expect(matchingLine(2, 3, 5)).toBe(4);
    expect(matchingLine(0, 1, 4)).toBe(0);
  });
});
