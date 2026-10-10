import { describe, expect, it } from "vitest";
import { findInlineRefs, inlineRefMarkdown } from "../src/core/refs";

describe("inline references", () => {
  it("finds references with their offsets", () => {
    const body = "See [a](item:aaaaaaaaaaaa) and [b](item:bbbbbbbbbbbb).";
    const refs = findInlineRefs(body);
    expect(refs.map((ref) => ref.to)).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
    expect(body.slice(refs[0]!.start, refs[0]!.end)).toBe(inlineRefMarkdown("a", "aaaaaaaaaaaa"));
  });

  it("ignores references in code spans and fenced code blocks", () => {
    const body = "`[a](item:aaaaaaaaaaaa)`\n```\n[b](item:bbbbbbbbbbbb)\n```\n[c](item:cccccccccccc)";
    expect(findInlineRefs(body).map((ref) => ref.to)).toEqual(["cccccccccccc"]);
  });

  it("ignores IDs with the wrong form and normal URLs", () => {
    expect(findInlineRefs("[a](item:SHORT) [b](https://example.com)")).toEqual([]);
  });
});
