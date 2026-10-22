import { describe, expect, it } from "vitest";
import { createItemOnBoard, deleteThread } from "../src/core/actions";
import { createInside, insideEntries, insideEntryOf, moveIn, moveOut, pointInside, resizeInside } from "../src/core/inside";
import { deleteForever, trashEntries, withTrashMarks } from "../src/core/trash";
import { decodeVault, encodeVault } from "../src/core/format";
import { schemaErrors } from "../src/core/validate";
import type { Command } from "../src/core/commands";
import { DATA_INTEGRITY, loadTestContext, ROOT, TOOL_RESEARCH, type TestContext } from "./helpers";

const PAGE = TOOL_RESEARCH;
const run = (context: TestContext, command: Command) => context.history.run(withTrashMarks(context, ROOT, command));

describe("small items inside a page", () => {
  it("are vault items with an inside link; the page stays a page, and they are not in the trash", () => {
    const context = loadTestContext();
    const { command, itemId, linkId } = createInside(context, { homeId: PAGE, view: "todo", at: [10, 20], body: "Check", quote: "Tool", quoteAt: 0 });
    run(context, command);
    expect(context.store.get("links", linkId)).toEqual({ id: linkId, kind: "inside", from: PAGE, to: itemId, view: "todo", x: 10, y: 20, quote: "Tool", at: 0 });
    expect(context.graph.isBoardItem(PAGE)).toBe(false);
    expect(trashEntries(context, ROOT)).toEqual([]);
    const [entry] = insideEntries(context.store, context.graph, PAGE);
    expect(entry).toMatchObject({ view: "todo", at: [10, 20], quote: "Tool", quoteAt: 0, link: { id: linkId } });
    // The vault files keep it, and read it again with no problems.
    const decoded = decodeVault(encodeVault(context.store, { format: 2, root: ROOT }));
    expect(decoded.problems.filter((problem) => problem.severity === "error")).toEqual([]);
    expect(decoded.store.get("links", linkId)).toEqual(context.store.get("links", linkId));
  });

  it("change size by hand: width and height, or (in the comment column) only the height", () => {
    const context = loadTestContext();
    const { command, linkId } = createInside(context, { homeId: PAGE, view: "quote", at: [0, 0], w: 170 });
    run(context, command);
    const entry = () => insideEntries(context.store, context.graph, PAGE)[0]!;
    run(context, resizeInside(context, entry(), 240, 130));
    expect(context.store.get("links", linkId)).toMatchObject({ w: 240, h: 130 });
    run(context, resizeInside(context, entry(), null, 90));
    expect(context.store.get("links", linkId)).toMatchObject({ w: 240, h: 90 });
    context.history.undo();
    expect(context.store.get("links", linkId)).toMatchObject({ w: 240, h: 130 });
  });

  it("checks inside links", () => {
    expect(schemaErrors("links", { id: "abcdefghijkl", kind: "inside", from: "abcdefghijk1", to: "abcdefghijk2", view: "comment" })).toEqual([]);
    expect(schemaErrors("links", { id: "abcdefghijkl", kind: "inside", from: "abcdefghijk1", to: "abcdefghijk2", view: "page" })).not.toEqual([]);
    expect(schemaErrors("links", { id: "abcdefghijkl", kind: "inside", from: "abcdefghijk1", to: "abcdefghijk2", view: "note", x: 1 })).not.toEqual([]);
    expect(schemaErrors("links", { id: "abcdefghijkl", kind: "inside", from: "abcdefghijk1", to: "abcdefghijk2", view: "note", at: 3 })).not.toEqual([]);
  });

  it("a comment on a card that is not a page stays attached (not inside)", () => {
    const context = loadTestContext();
    const { command, itemId } = createItemOnBoard(context, { boardId: ROOT, view: "comment", x: 600, y: 240, on: DATA_INTEGRITY });
    run(context, command);
    expect(insideEntryOf(context.store, context.graph, itemId)).toBeNull();
  });

  it("move out to a board and back in; pointing to text", () => {
    const context = loadTestContext();
    const { command, itemId } = createInside(context, { homeId: PAGE, view: "note", at: null, quote: "x" });
    run(context, command);
    run(context, pointInside(context, insideEntryOf(context.store, context.graph, itemId)!, "Tool research", 4));
    expect(context.graph.insideHomeOf(itemId)).toMatchObject({ quote: "Tool research", at: 4 });
    const { command: out, placeId } = moveOut(context, insideEntryOf(context.store, context.graph, itemId)!, ROOT, 700, 80);
    run(context, out);
    expect(context.graph.insideHomeOf(itemId)).toBeUndefined();
    expect(context.store.get("links", placeId)).toMatchObject({ kind: "place", from: ROOT, view: "note", x: 700, y: 80 });
    run(context, moveIn(context, placeId, PAGE, [5, 6]).command);
    expect(context.graph.parentsOf(itemId)).toEqual([]);
    // Inside a page: not in the trash, and no trash fields.
    expect(context.store.get("items", itemId)?.trashed).toBeUndefined();
    expect(trashEntries(context, ROOT)).toEqual([]);
    expect(context.graph.insideHomeOf(itemId)).toMatchObject({ view: "note", x: 5, y: 6 });
  });

  it("delete of a comment removes its inside link; delete forever of the page removes the items in it", () => {
    const context = loadTestContext();
    const first = createInside(context, { homeId: PAGE, view: "comment", at: null, author: "Ann" });
    run(context, first.command);
    run(context, deleteThread(context, first.itemId));
    expect(context.store.get("links", first.linkId)).toBeUndefined();
    const second = createInside(context, { homeId: PAGE, view: "note", at: [1, 2] });
    run(context, second.command);
    run(context, deleteForever(context, PAGE));
    expect(context.store.get("items", second.itemId)).toBeUndefined();
    expect(context.store.get("links", second.linkId)).toBeUndefined();
  });
});
