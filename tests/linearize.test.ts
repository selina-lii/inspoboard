import { describe, expect, it } from "vitest";
import { placeRecord } from "../src/core/actions";
import { linearize, readingOrder } from "../src/core/linearize";
import type { PlaceLink } from "../src/core/types";
import { DATA_INTEGRITY, loadTestContext, ROOT } from "./helpers";

function place(id: string, x: number, y: number): PlaceLink {
  return { id, kind: "place", from: "a", to: id, x, y, w: 100, h: 100, view: "note" };
}

describe("linearize", () => {
  it("writes each item one time and refers to it after that", () => {
    const context = loadTestContext();
    const text = linearize(context.store, context.graph, ROOT);
    expect(text.startsWith("# Inspoboard\n")).toBe(true);
    expect(text).toContain("## Tool research");
    expect(text).toContain("### Data integrity");
    expect(text).toContain("See: Data integrity");
    expect(text).toContain("- → Data integrity (depends on)");
    expect(text).toContain("[stamp: star]");
  });

  it("stops in a cycle", () => {
    const context = loadTestContext();
    context.history.run(placeRecord(context, { boardId: DATA_INTEGRITY, recordId: ROOT, view: "note", x: 0, y: 0, w: 1, h: 1 }).command);
    expect(linearize(context.store, context.graph, ROOT)).toContain("See: Inspoboard");
  });

  it("sorts placements in bands, then left to right", () => {
    const order = readingOrder([place("c", 0, 200), place("b", 300, 10), place("a", 0, 0)]);
    expect(order.map((link) => link.id)).toEqual(["a", "b", "c"]);
  });
});
