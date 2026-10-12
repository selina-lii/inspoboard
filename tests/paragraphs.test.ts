import { describe, expect, it } from "vitest";
import { pairBlocks, paragraphBlocks } from "../src/ui/plugins/paragraphs";

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

describe("page paragraphs", () => {
  it("are the lines of the page text that have letters or digits, with their ranges", async () => {
    const { pageParagraphs } = await import("../src/ui/web/pageTranslation");
    const text = "Title\n  \n  First paragraph.  \n—\nSecond";
    expect(pageParagraphs(text)).toEqual([
      { start: 0, end: 5, text: "Title" },
      { start: 11, end: 27, text: "First paragraph." },
      { start: 32, end: 38, text: "Second" },
    ]);
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
