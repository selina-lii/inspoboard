import { describe, expect, it } from "vitest";
import { buzzText, buzzWord } from "../src/ui/plugins/buzzies/buzz";

describe("buzzies mode glyphs", () => {
  it("keeps spaces, line ends, and the number of characters", () => {
    const text = "Memory is never\nonly private.  We remember";
    const buzzed = buzzText(text);
    expect([...buzzed].length).toBe([...text].length);
    expect(buzzed.replace(/\S/gu, "x")).toBe(text.replace(/\S/gu, "x"));
    expect(/[A-Za-z]/.test(buzzed)).toBe(false);
  });

  it("gives the same word the same glyphs everywhere", () => {
    expect(buzzText("place and place")).toBe(`${buzzWord("place")} ${buzzWord("and")} ${buzzWord("place")}`);
    expect(buzzWord("memory")).toBe(buzzWord("memory"));
  });

  it("cuts wide text (no spaces) into short words: a mixture of wide symbols and blocks of different heights", () => {
    const text = "記憶從來不只是私人的事情，它總是和地方、物件與他人連在一起。老街的「記憶」在每一個轉角";
    const buzzed = buzzText(text);
    expect([...buzzed].length).toBe([...text].length);
    expect(/[\p{Script=Han}]/u.test(buzzed)).toBe(false);
    expect(buzzText(text)).toBe(buzzed);
    for (const glyph of buzzed) expect("！＠＃＄％＾＆＊（）▆▇█▄▅▂▃▯▭").toContain(glyph);
    // Both kinds, and blocks of more than one height.
    expect([...buzzed].some((glyph) => "！＠＃＄％＾＆＊（）".includes(glyph))).toBe(true);
    const heights = new Set([...buzzed].filter((glyph) => "▆▇█▄▅▂▃".includes(glyph)).map((glyph) => ("▆▇█".includes(glyph) ? "tall" : "▄▅".includes(glyph) ? "mid" : "low")));
    expect(heights.size).toBeGreaterThan(1);
  });

  it("works for any script: other letters get blocks of different heights, long runs are cut, marks give no glyph", () => {
    for (const text of ["Память никогда не бывает только частной, она всегда связана с местами и людьми", "الذاكرة ليست شخصية فقط بل هي مرتبطة دائما بالأماكن والأشياء والناس من حولنا", "ความทรงจำไม่เคยเป็นเรื่องส่วนตัวเท่านั้น"]) {
      const buzzed = buzzText(text);
      expect(/[\p{L}\p{M}]/u.test(buzzed)).toBe(false);
      const blocks = [...buzzed].filter((glyph) => "▆▇█▄▅▂▃".includes(glyph));
      expect(new Set(blocks.map((glyph) => ("▆▇█".includes(glyph) ? "tall" : "▄▅".includes(glyph) ? "mid" : "low"))).size).toBeGreaterThan(1);
    }
    // Thai (no spaces): symbols and blocks mixed.
    const thai = buzzText("ความทรงจำไม่เคยเป็นเรื่องส่วนตัวเท่านั้น");
    expect([...thai].some((glyph) => "!@#$%^&*()".includes(glyph))).toBe(true);
  });
});
