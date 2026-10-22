import { describe, expect, it } from "vitest";
import { countWords } from "../src/core/wordCount";

describe("countWords", () => {
  it("counts Latin words and each CJK character", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("Hello, world — it's 2026.")).toBe(4);
    expect(countWords("「繁體中文」")).toBe(4);
    expect(countWords("用 React寫的")).toBe(4);
    expect(countWords("# Title\n\n- one *two*")).toBe(3);
  });
});
