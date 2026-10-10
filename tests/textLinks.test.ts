import { describe, expect, it } from "vitest";
import { describeTarget, linksOf } from "../src/ui/app/textLinks";
import { loadTestContext, RELATION, ROOT } from "./helpers";

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
