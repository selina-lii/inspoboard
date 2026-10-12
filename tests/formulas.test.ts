import { describe, expect, it } from "vitest";
import { findFormulas, mergeFormulas, speakFormulas } from "../src/ui/plugins/formulas";

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
      { start: 0, end: 16, speech: "So a dot b holds." },
      { start: 17, end: 26, speech: "Next one." },
      { start: 27, end: text.length, speech: "x" },
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
