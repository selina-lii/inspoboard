import { describe, expect, it } from "vitest";
import { placeRecord, removeFromBoard } from "../src/core/actions";
import { deleteForever, restoreFromTrash, trashEntries, withTrashMarks } from "../src/core/trash";
import { decodeVault, encodeVault } from "../src/core/format";
import type { Command } from "../src/core/commands";
import { DATA_INTEGRITY, IDEAS, loadTestContext, ROOT, TOOL_RESEARCH, type TestContext } from "./helpers";

const run = (context: TestContext, command: Command) => context.history.run(withTrashMarks(context, ROOT, command));

describe("trash", () => {
  it("marks an item that loses its last card, with its last card", () => {
    const context = loadTestContext();
    const place = context.store.get("links", "p1a1a1a1a1a1");
    run(context, removeFromBoard(context, ["p1a1a1a1a1a1"]));
    const item = context.store.get("items", TOOL_RESEARCH)!;
    expect(item.trashed).toBe("2026-10-07T12:00:00.000Z");
    expect(place?.kind === "place" && item.trashedFrom).toEqual(place?.kind === "place" ? { board: place.from, x: place.x, y: place.y, w: place.w, h: place.h, view: place.view } : null);
    expect(trashEntries(context, ROOT).map((entry) => entry.itemId)).toEqual([TOOL_RESEARCH]);
  });

  it("does not mark an item that stays on a different board", () => {
    const context = loadTestContext();
    run(context, removeFromBoard(context, ["p4d4d4d4d4d4"]));
    expect(context.store.get("items", DATA_INTEGRITY)!.trashed).toBeUndefined();
  });

  it("undo takes the item out of the trash with its fields", () => {
    const context = loadTestContext();
    run(context, removeFromBoard(context, ["p1a1a1a1a1a1"]));
    context.history.undo();
    expect(context.store.get("items", TOOL_RESEARCH)!.trashed).toBeUndefined();
    expect(trashEntries(context, ROOT)).toEqual([]);
  });

  it("restores the item on its last board at its last place, and clears the fields", () => {
    const context = loadTestContext();
    const place = context.store.get("links", "p1a1a1a1a1a1")!;
    run(context, removeFromBoard(context, ["p1a1a1a1a1a1"]));
    const { command, boardId } = restoreFromTrash(context, ROOT, TOOL_RESEARCH, { boardId: IDEAS, x: 0, y: 0 });
    run(context, command);
    expect(boardId).toBe(place.from);
    const [card] = context.graph.parentsOf(TOOL_RESEARCH);
    expect(card && place.kind === "place" && [card.x, card.y]).toEqual(place.kind === "place" ? [place.x, place.y] : null);
    const item = context.store.get("items", TOOL_RESEARCH)!;
    expect(item.trashed).toBeUndefined();
    expect(item.trashedFrom).toBeUndefined();
  });

  it("clears the fields when the item gets a card in a different way", () => {
    const context = loadTestContext();
    run(context, removeFromBoard(context, ["p1a1a1a1a1a1"]));
    run(context, placeRecord(context, { boardId: IDEAS, recordId: TOOL_RESEARCH, view: "note", x: 0, y: 0, w: 200, h: 160 }).command);
    expect(context.store.get("items", TOOL_RESEARCH)!.trashed).toBeUndefined();
  });

  it("saves and reads the trash fields (valid records)", () => {
    const context = loadTestContext();
    run(context, removeFromBoard(context, ["p1a1a1a1a1a1"]));
    const { store, problems } = decodeVault(encodeVault(context.store, { format: 2, root: ROOT }));
    expect(problems.filter((problem) => problem.severity === "error")).toEqual([]);
    expect(store.get("items", TOOL_RESEARCH)!.trashedFrom).toEqual(context.store.get("items", TOOL_RESEARCH)!.trashedFrom);
  });

  it("delete forever removes the item and its links, and undo brings them back", () => {
    const context = loadTestContext();
    run(context, removeFromBoard(context, ["p1a1a1a1a1a1"]));
    const links = [...context.store.all("links")].length;
    run(context, deleteForever(context, TOOL_RESEARCH));
    expect(context.store.has("items", TOOL_RESEARCH)).toBe(false);
    expect(context.graph.relationsFrom(TOOL_RESEARCH).length + context.graph.relationsTo(TOOL_RESEARCH).length + context.graph.childrenOf(TOOL_RESEARCH).length).toBe(0);
    context.history.undo();
    expect(context.store.has("items", TOOL_RESEARCH)).toBe(true);
    expect([...context.store.all("links")].length).toBe(links);
  });
});
