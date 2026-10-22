import { describe, expect, it } from "vitest";
import { buildPdfText, characterBoxes, offsetOfSpan, pagesOf, textBoxes, type RawItem, type RawPage } from "../src/ui/web/pdfTextModel";

// A page of 600 × 800 units. The viewport transform of pdf.js at scale 1 flips y: [1, 0, 0, -1, 0, 800].
const FLIP = [1, 0, 0, -1, 0, 800];
/** A text item at (x, baseline y from the bottom), font size 10, 5 units for each character. */
const item = (str: string, x: number, y: number, extra: Partial<RawItem> = {}): RawItem => ({ str, transform: [10, 0, 0, 10, x, y], width: str.length * 5, height: 10, fontName: "f", ...extra });
const page = (number: number, items: RawItem[]): RawPage => ({ number, transform: FLIP, items, styles: { f: { fontFamily: "serif", ascent: 0.8 } } });

describe("the text of a PDF (from its text items, not from the screen)", () => {
  const pages = [
    page(1, [item("The first line of a long paragraph that goes", 50, 700), item("", 0, 0), item("on here.", 50, 686), item("12", 10, 700), item("12", 10, 686), item("12", 10, 672), item("Next", 50, 640), item("part", 75, 640)]),
    page(2, [item("Page two ﬁnds it.", 50, 700)]),
  ];
  // The numbers 12 at the left are line numbers (a column that does not count up: they stay).
  const model = buildPdfText(pages, (text) => text.replace("ﬁ", "fi"));

  it("joins items into lines and lines into paragraphs; empty items have no run", () => {
    expect(model.text.startsWith("The first line of a long paragraph that goes on here.")).toBe(true);
    expect(model.text).toContain("Next part");
    expect(model.text.endsWith("Page two finds it.")).toBe(true);
    expect(model.pages[0]!.map((run) => run.raw)).toEqual(["The first line of a long paragraph that goes", "on here.", "12", "12", "12", "Next", "part"]);
  });

  it("maps a place in a span of the text layer to the text (spans: the items with text, in order)", () => {
    const at = model.text.indexOf("on here.");
    expect(offsetOfSpan(model, 1, 1, 3)).toBe(at + 3);
    // A ligature is one character in the span and two in the text.
    const two = model.text.indexOf("finds");
    expect(offsetOfSpan(model, 2, 0, "Page two ﬁ".length, (text) => text.replace("ﬁ", "fi"))).toBe(two + 2);
  });

  it("makes the boxes of a text range from the places of the items, at any zoom", () => {
    const start = model.text.indexOf("first");
    const [box] = textBoxes(model, start, start + 5);
    // "first" starts after "The " (4 × 5 units): x = 50 + 20. The top: baseline 100 from the top, up 8 (ascent).
    expect(box).toEqual([1, 70, 92, 25, 10]);
    expect(pagesOf(model, 0, model.text.length)).toEqual([1, 2]);
    expect(textBoxes(model, model.text.indexOf("goes"), model.text.indexOf("here") + 4)).toHaveLength(2);
  });

  it("gives the box of each character near an area (formulas)", () => {
    const chars = characterBoxes(model, 1, (box) => box.top < 160 && box.top + box.height > 150);
    expect(chars.map((char) => model.text[char.offset]).join("")).toBe("Nextpart");
  });
});
