import { describe, expect, it } from "vitest";
import { describeTarget, linksOf } from "../src/ui/app/textLinks";
import { loadTestContext, RELATION, ROOT } from "./helpers";
import { findInlineRefs, inlineRefMarkdown } from "../src/core/refs";

describe("links for the views", () => {
  it("lists the links of an item in both directions, and describes a text link target", () => {
    const context = loadTestContext();
    const link = context.store.get("links", RELATION)!;
    if (link.kind !== "link") throw new Error("not a relation");
    const from = linksOf(context.store, context.graph, ROOT, link.from);
    expect(from.outgoing).toContainEqual(expect.objectContaining({ itemId: link.to, linkId: RELATION }));
    const to = linksOf(context.store, context.graph, ROOT, link.to);
    expect(to.incoming).toContainEqual(expect.objectContaining({ itemId: link.from }));
    expect(describeTarget(context.store, context.graph, ROOT, { kind: "link", id: RELATION })).toMatchObject({ itemId: link.to, linkId: RELATION });
    expect(describeTarget(context.store, context.graph, ROOT, { kind: "item", id: "zzzzzzzzzzzz" })).toBeNull();
  });
});

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
