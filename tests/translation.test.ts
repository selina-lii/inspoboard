import { describe, expect, it } from "vitest";
import { pairBlocks, paragraphBlocks } from "../src/ui/plugins/paragraphs";
import { findAll } from "../src/ui/web/readerShared";
import { matchingSentence, pageCounterpart, sentenceRanges, textCounterpart } from "../src/ui/plugins/sentencePairs";
import { NO_SKIP } from "../src/io/settings";
import { protectText, restoreText } from "../src/ui/plugins/translateSkip";

const texts = (text: string) => paragraphBlocks(text).map((block) => text.slice(block.from, block.to));

describe("paragraph blocks", () => {
  it("splits at empty lines; headings, list items, and code blocks are blocks of their own", () => {
    expect(texts("\n# Title\nFirst line\nsame paragraph\n\nNext.\n- a\n- b\n```\nx\n\ny\n```\nEnd")).toEqual([
      "\n# Title\n",
      "First line\nsame paragraph\n\n",
      "Next.\n",
      "- a\n",
      "- b\n",
      "```\nx\n\ny\n```\n",
      "End",
    ]);
    expect(texts("")).toEqual([""]);
  });

  it("pairs one to one, or in proportion when the counts differ", () => {
    expect(pairBlocks(3, 3)).toEqual([
      { left: [0, 1], right: [0, 1] },
      { left: [1, 2], right: [1, 2] },
      { left: [2, 3], right: [2, 3] },
    ]);
    // Four right blocks for two left blocks: two each.
    expect(pairBlocks(2, 4)).toEqual([
      { left: [0, 1], right: [0, 2] },
      { left: [1, 2], right: [2, 4] },
    ]);
    // One right block for three left blocks: one row.
    expect(pairBlocks(3, 1)).toEqual([{ left: [0, 3], right: [0, 1] }]);
  });
});

describe("page paragraphs (translation layout)", () => {
  it("text units are the lines of the page text that have letters or digits", async () => {
    const { textUnits } = await import("../src/ui/web/pageTranslation");
    expect(textUnits("Title\n  \n  First paragraph.  \n—\nSecond")).toEqual([
      { start: 0, end: 5 },
      { start: 11, end: 27 },
      { start: 32, end: 38 },
    ]);
  });

  /** A PDF page: each line of `rows` is [text, left, top, width, height]. The text joins with "\n" (one unit each). */
  async function pdf(rows: [string, number, number, number, number][]) {
    const { layoutParagraphs } = await import("../src/ui/web/pageTranslation");
    let text = "";
    const units: { start: number; end: number }[] = [];
    const boxes = new Map<number, { left: number; top: number; width: number; height: number }>();
    for (const [line, left, top, width, height] of rows) {
      if (text !== "") text += "\n";
      units.push({ start: text.length, end: text.length + line.length });
      boxes.set(text.length, { left, top, width, height });
      text += line;
    }
    return layoutParagraphs(text, units, (start) => (boxes.has(start) ? [boxes.get(start)!] : []), true);
  }

  it("joins PDF lines into paragraphs by their places, and keeps small parts in their line", async () => {
    const paragraphs = await pdf([
      ["The first paragraph starts here and the line goes", 72, 100, 450, 12],
      ["2", 523, 96, 5, 7], // A superscript of the line above.
      ["to the right edge of the column, as text does in", 72, 114, 452, 12],
      ["a short last line.", 72, 128, 120, 12],
      ["    The second paragraph has an indent at its first", 90, 142, 434, 12],
      ["line, and it goes on to the next line here.", 72, 156, 300, 12],
      ["A new block after a larger space between the lines", 72, 190, 450, 12],
      ["12", 300, 760, 12, 10], // The page number.
    ]);
    expect(paragraphs.map((paragraph) => paragraph.text.slice(0, 20))).toEqual(["The first paragraph ", "The second paragraph", "A new block after a ", "12"]);
    expect(paragraphs[0]!.box).toEqual({ left: 72, top: 96, width: 456, height: 44 });
    expect(paragraphs.map((paragraph) => paragraph.translate)).toEqual([true, true, true, false]);
  });

  it("keeps the two columns of a PDF page apart, and a heading apart from its text", async () => {
    const paragraphs = await pdf([
      ["A Heading Of The Page", 72, 60, 300, 20],
      ["Left column text of the page, first line of it", 72, 90, 220, 10],
      ["and the second line of the left column of it.", 72, 102, 220, 10],
      ["Right column text at the same height as the left", 320, 90, 220, 10],
      ["one, and its second line goes on here as well.", 320, 102, 220, 10],
    ]);
    expect(paragraphs.map((paragraph) => paragraph.text.split(" ")[0])).toEqual(["A", "Left", "Right"]);
    expect(paragraphs[2]!.box!.left).toBe(320);
  });

  it("does not translate single words or formulas", async () => {
    const { isTranslatable } = await import("../src/ui/web/pageTranslation");
    expect(isTranslatable("Introduction")).toBe(false);
    expect(isTranslatable("𝑃(𝑥) = ∑ 𝛼ᵢ 𝑥ⁱ + 𝛽")).toBe(false);
    expect(isTranslatable("Two words")).toBe(true);
    expect(isTranslatable("離線翻譯")).toBe(true);
  });
});

describe("aligned paragraphs by content", () => {
  it("pairs a translation that joined two paragraphs, and keeps headings with headings", async () => {
    const { alignBlocks } = await import("../src/ui/plugins/paragraphs");
    const left = [
      "# Offline translation\n",
      "Small models now run on a laptop without a network connection, and they are good enough to read with.\n\n",
      "See 2024 data.\n\n",
      "They are not perfect. Researchers improve them every year, and new methods appear often, in 3 labs.\n",
    ];
    // The plugin joined paragraphs 2 and 3.
    const right = ["# 離線翻譯\n", "小型模型現在無需網絡即可在筆記本電腦上運行，足以用來閱讀。參見 2024 年數據。\n\n", "它們並不完美。研究人員每年都在改進，新方法層出不窮，3 個實驗室。\n"];
    expect(alignBlocks(left, right)).toEqual([
      { left: [0, 1], right: [0, 1] },
      { left: [1, 3], right: [1, 2] },
      { left: [3, 4], right: [2, 3] },
    ]);
    // Same counts and similar sizes: one to one.
    expect(alignBlocks(["a long first paragraph here\n\n", "second one\n"], ["第一段很長的內容\n\n", "第二段\n"])).toEqual([
      { left: [0, 1], right: [0, 1] },
      { left: [1, 2], right: [1, 2] },
    ]);
  });
});

describe("PDF lines into paragraphs", () => {
  const line = (top: number, text: string, left = 50, right = 550, height = 12, page = 1) => ({ page, top, left, right, height, text });
  it("leaves out line numbers and page numbers in the side margins, never content", async () => {
    const { sideNumbers } = await import("../src/ui/web/webText");
    const run = (text: string, left: number, right: number, top: number, page = 1) => ({ text, left, right, top, page });
    const long = (top: number, page = 1) => run("The text of the page runs on to the right edge", 50, 550, top, page);
    // Line numbers: a straight column at the left that counts up. A page number alone at the right.
    expect(sideNumbers([run("1", 20, 30, 10), long(10), run("2", 20, 30, 25), long(25), run("3", 20, 30, 40), long(40), run("2024", 300, 330, 50), run("7", 560, 570, 800)])).toEqual([
      true, false, true, false, true, false, false, true,
    ]);
    // Numbers of a wide table that stick out at the right: they do not count up, so they stay.
    expect(sideNumbers([long(10), run("42", 560, 580, 20), run("17", 560, 580, 35), run("93", 560, 580, 50)])).toEqual([false, false, false, false]);
    // A lone number at the side next to the text (a label of a figure): it stays.
    expect(sideNumbers([long(10), long(60), run("5", 560, 570, 30)])).toEqual([false, false, false]);
    // Two numbers on one side: not clear, so they stay. No long text on a page: nothing goes.
    expect(sideNumbers([long(10), run("4", 20, 30, 20), run("9", 20, 30, 35), run("12", 20, 30, 10, 2)])).toEqual([false, false, false, false]);
  });
  it("joins wrapped lines and breaks at short lines, larger gaps, indents, headings, and new pages", async () => {
    const { pdfSeparators } = await import("../src/ui/web/webText");
    const lines = [
      line(10, "A Title Here", 50, 300, 18),
      line(40, "The first paragraph starts here and runs to"),
      line(55, "the right edge, and then it wraps again to"),
      line(70, "end here.", 50, 120),
      line(85, "Second paragraph after a short line, to the"),
      line(100, "right edge again and on."),
      line(125, "A third one after a larger gap goes to the"),
      line(140, "edge and ends with a full stop at the edge."),
      line(155, "An indented fourth paragraph to the edge", 70),
      line(170, "• a list item"),
      line(10, "Next page text", 50, 550, 12, 2),
    ];
    expect(pdfSeparators(lines)).toEqual(["\n", " ", " ", "\n", " ", "\n", " ", "\n", "\n", "\n"]);
  });
  it("joins CJK lines without a space", async () => {
    const { pdfSeparators } = await import("../src/ui/web/webText");
    expect(pdfSeparators([line(10, "這是第一行文字"), line(25, "這是第二行文字"), line(40, "結束。", 50, 100)])).toEqual(["", ""]);
  });
});

describe("quotes in a page text", () => {
  it("are found when spaces and line ends differ", async () => {
    const { findQuote } = await import("../src/ui/web/savedPages");
    const text = "Line one ends\nline two (a) starts. 這是第一行這是第二行";
    expect(findQuote(text, "ends line two (a)")).toEqual({ start: 9, end: 26 });
    expect(findQuote(text, "第一行 這是")).toEqual({ start: text.indexOf("第一行"), end: text.indexOf("第一行") + 5 });
    expect(findQuote(text, "missing")).toBeNull();
  });
});

describe("equations in PDF text", () => {
  it("knows equation lines, and makes them paragraphs of their own", async () => {
    const { isEquationText, pdfSeparators } = await import("../src/ui/web/webText");
    expect(isEquationText("𝑃(𝑿 = 𝒙) = 𝑃1𝑺(𝑿) = 𝑺(𝒙)234444544446𝑃1 𝑿 = 𝒙 ∣∣ 𝑺(𝑿) = 𝑺(𝒙)")).toBe(true);
    expect(isEquationText("(3)")).toBe(true);
    expect(isEquationText("The probability of the event is given by the following equation.")).toBe(false);
    expect(isEquationText("where 𝑺 is a statistic")).toBe(false);
    const line = (top: number, text: string, left = 50, right = 550, height = 12) => ({ page: 1, top, left, right, height, text });
    const lines = [
      line(10, "The value follows from the next relation, which we use"),
      line(25, "𝑃(𝑿 = 𝒙) = 𝑓(𝑺(𝒙)) 𝑔(𝒙)", 150, 450),
      line(33, "𝑖=1", 160, 190, 8),
      line(45, "and this is the text after the equation that goes on."),
    ];
    expect(pdfSeparators(lines)).toEqual(["\n", " ", "\n"]);
  });
});

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

describe("do not translate", () => {
  it("puts markers on citations and gives them back after the plugin", () => {
    const text = "Growth was fast (Smith, 2020). See [3] and (Lee 4–6).";
    const done = protectText(text, { ...NO_SKIP, authorDate: true, numbered: true, authorPage: true });
    expect(done.text).toBe("Growth was fast ⟦1⟧. See ⟦2⟧ and ⟦3⟧.");
    expect(done.parts).toEqual(["(Smith, 2020)", "[3]", "(Lee 4–6)"]);
    // A plugin translated the words; it kept two markers and changed one a little.
    expect(restoreText("增长很快 ⟦1⟧。见 [[2]] 和 ⟦ 3 ⟧。", done.parts)).toBe("增长很快 (Smith, 2020)。见 [3] 和 (Lee 4–6)。");
    // A lost marker: its part goes at the end.
    expect(restoreText("增长很快。", ["(Smith, 2020)"])).toBe("增长很快。 (Smith, 2020)");
  });

  it("keeps the whole reference list, or parts of its entries", () => {
    const text = "Body text here.\n\n## References\n\nSmith, J. (2020). A title. https://doi.org/x\n";
    const whole = protectText(text, { ...NO_SKIP, referenceList: true });
    expect(whole.text).toBe("Body text here.\n\n## References\n\n⟦1⟧\n");
    const parts = protectText(text, { ...NO_SKIP, referenceAuthors: true, referenceLinks: true, referenceDates: true });
    expect(parts.text).toBe("Body text here.\n\n## References\n\n⟦1⟧ ⟦2⟧. A title. ⟦3⟧\n");
    expect(restoreText(parts.text, parts.parts)).toBe(text);
  });

  it("changes nothing without skip rules", () => {
    expect(protectText("Text (Smith, 2020).", NO_SKIP)).toEqual({ text: "Text (Smith, 2020).", parts: [] });
  });
});
