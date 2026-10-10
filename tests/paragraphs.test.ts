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
