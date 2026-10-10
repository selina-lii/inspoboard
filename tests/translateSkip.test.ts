import { describe, expect, it } from "vitest";
import { NO_SKIP } from "../src/io/settings";
import { protectText, restoreText } from "../src/ui/plugins/translateSkip";

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
