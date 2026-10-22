import { describe, expect, it } from "vitest";
import { findFormulas, formulaSentence, mergeFormulas, speakFormulas } from "../src/ui/plugins/formulas";
import { prepareSentences } from "../src/ui/plugins/reading";
import { NO_SKIP } from "../src/io/settings";
import { fileText, readFile } from "../src/ui/web/pdfFormulas";
import { formulaRate } from "../src/ui/plugins/speech";

const texts = (text: string) => findFormulas(text).map((formula) => [text.slice(formula.start, formula.end), formula.tex, formula.display]);

describe("formulas in Markdown", () => {
  it("finds $…$, $$…$$, \\(…\\), \\[…\\], and math code blocks", () => {
    const text = "Let $x^2$ be big. Then\n$$\n\\frac{a}{b}\n$$\nand \\(y\\) or \\[z\\].\n```math\nE = mc^2\n```\nEnd.";
    expect(texts(text)).toEqual([
      ["$x^2$", "x^2", false],
      ["$$\n\\frac{a}{b}\n$$", "\\frac{a}{b}", true],
      ["\\(y\\)", "y", false],
      ["\\[z\\]", "z", true],
      ["```math\nE = mc^2\n```", "E = mc^2", true],
    ]);
  });

  it("skips amounts, escaped dollars, code, and other code blocks", () => {
    expect(texts("It costs $5 and $10 today.")).toEqual([]);
    expect(texts("Pay \\$3 or \\$4 now, $ 1 $ is not math.")).toEqual([]);
    expect(texts("Code `$x$` and\n```js\nconst a = $b$;\n```\nbut $y$ is.")).toEqual([["$y$", "y", false]]);
  });
});

describe("formulas in read-aloud sentences", () => {
  it("says each formula as words and joins sentences that a formula crosses", () => {
    const text = "So $a. b$ holds. Next one.\n```math\nx\n```";
    const formulas = findFormulas(text);
    // The voice split inside the first formula, and does not read the code block.
    const sentences = [
      { start: 0, end: 6, speech: "So $a." },
      { start: 7, end: 16, speech: "b$ holds." },
      { start: 17, end: 26, speech: "Next one." },
    ];
    expect(speakFormulas(text, sentences, formulas, ["a dot b", "x"])).toEqual([
      { start: 0, end: 16, speech: "So a dot b holds.", parts: [{ text: "So", formula: false }, { text: "a dot b", formula: true }, { text: "holds.", formula: false }] },
      { start: 17, end: 26, speech: "Next one." },
      { start: 27, end: text.length, speech: "x", parts: [{ text: "x", formula: true }] },
    ]);
    // No words for a formula (an error): its LaTeX stays.
    expect(speakFormulas("A $\\bad$ one.", [{ start: 0, end: 13, speech: "A $\\bad$ one." }], findFormulas("A $\\bad$ one."), [""])[0]!.speech).toBe("A \\bad one.");
  });

  it("page formulas come first; text formulas that overlap them are left out", () => {
    const page = [{ start: 5, end: 9, tex: "x", display: false }];
    const text = [{ start: 6, end: 8, tex: "y", display: false }, { start: 20, end: 25, tex: "z", display: false }];
    expect(mergeFormulas(page, text).map((formula) => formula.tex)).toEqual(["x", "z"]);
  });
});

describe("formulas said in their sentence (a PDF: words made just before the clip)", () => {
  it("makes parts; a formula that runs into the next sentence is said in the first one only", () => {
    const text = "We use E=mc2. Then. It holds.";
    // The PDF text of the formula ("E=mc2. Then") runs past the end of the first sentence (13).
    const formula = { start: 7, end: 18, tex: "E=mc^2", display: false, words: "E equals m c squared" };
    const first = formulaSentence(text, 0, 13, [formula]);
    expect(first.parts).toEqual([
      { text: "We use", formula: false },
      { text: "E equals m c squared", formula: true },
    ]);
    expect(first.end).toBe(18);
    // The next sentence starts inside the formula: the formula text is left out there.
    expect(formulaSentence(text, 14, 29, [formula]).parts).toEqual([{ text: ". It holds.", formula: false }]);
    // No words (an error): the LaTeX is said.
    expect(formulaSentence(text, 0, 13, [{ ...formula, words: "" }]).parts[1]).toEqual({ text: "E=mc^2", formula: true });
  });

  it("cleans the text parts and keeps the formula words", () => {
    const sentences = [{ start: 0, end: 20, speech: "So **x** (Smith, 2020)", parts: [{ text: "So **bold**", formula: false }, { text: "x squared", formula: true }] }];
    const [prepared] = prepareSentences("So **bold**", sentences, NO_SKIP, "markdown");
    expect(prepared!.parts).toEqual([{ text: "So bold", formula: false }, { text: "x squared", formula: true }]);
    expect(prepared!.speech).toBe("So bold x squared");
  });

  it("says formulas slower than the reading speed by the set amount", () => {
    expect(formulaRate(1.5, 0.5)).toBeCloseTo(1 / 1.5);
    expect(formulaRate(1, 0)).toBe(1);
    expect(formulaRate(0.6, 0.5)).toBe(0.3);
  });

  it("keeps found formulas of a PDF in a cache file, per page; an other PDF does not use it", () => {
    const found = new Map([[2, [{ page: 2, box: { left: 1, top: 2, width: 3, height: 4 }, display: true, tex: "x" }, { page: 2, box: { left: 5, top: 6, width: 7, height: 8 }, display: false }]]]);
    const text = fileText(found, 1000, 10);
    expect(readFile(text, 1000, 10)).toEqual(found);
    expect(readFile(text, 999, 10).size).toBe(0);
    expect(readFile(text, 1000, 11).size).toBe(0);
    expect(readFile("not json", 1000, 10).size).toBe(0);
  });
});
