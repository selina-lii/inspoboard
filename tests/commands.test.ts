import { describe, expect, it } from "vitest";
import { createItemOnBoard, renameItem, setPlacementRects, writeText } from "../src/core/actions";
import { IDEAS, loadTestContext, ROOT } from "./helpers";

describe("history", () => {
  it("undoes and redoes a command", () => {
    const context = loadTestContext();
    const { command, itemId, placeId } = createItemOnBoard(context, { boardId: ROOT, view: "note", x: 5, y: 6, name: "New" });
    context.history.run(command);
    expect(context.store.get("items", itemId)?.name).toBe("New");
    context.history.undo();
    expect(context.store.has("items", itemId)).toBe(false);
    expect(context.store.has("links", placeId)).toBe(false);
    context.history.redo();
    expect(context.store.get("links", placeId)).toMatchObject({ x: 5, y: 6 });
  });

  it("clears the redo stack after a new command", () => {
    const context = loadTestContext();
    context.history.run(renameItem(context, IDEAS, "A"));
    context.history.undo();
    context.history.run(renameItem(context, IDEAS, "B"));
    expect(context.history.canRedo()).toBe(false);
  });

  it("does not change body text when it undoes a rename", () => {
    const context = loadTestContext();
    context.history.run(renameItem(context, IDEAS, "Renamed"));
    writeText(context.store, IDEAS, "typed after rename");
    context.history.undo();
    expect(context.store.get("items", IDEAS)?.name).toBe("Ideas");
    expect(context.store.get("texts", IDEAS)?.body).toBe("typed after rename");
  });

  it("restores text typed after create when redo follows undo", () => {
    const context = loadTestContext();
    const { command, itemId } = createItemOnBoard(context, { boardId: ROOT, view: "page", x: 0, y: 0 });
    context.history.run(command);
    writeText(context.store, itemId, "important words");
    context.history.undo();
    expect(context.store.has("texts", itemId)).toBe(false);
    context.history.redo();
    expect(context.store.get("texts", itemId)?.body).toBe("important words");
  });

  it("ignores a command with no ops", () => {
    const context = loadTestContext();
    context.history.run(renameItem(context, IDEAS, "Ideas"));
    expect(context.history.canUndo()).toBe(false);
  });

  it("moves many placements in one command", () => {
    const context = loadTestContext();
    const moves = new Map([
      ["p1a1a1a1a1a1", { x: 10 }],
      ["p2b2b2b2b2b2", { x: 20, y: 30 }],
    ]);
    context.history.run(setPlacementRects(context, moves));
    context.history.undo();
    expect(context.store.get("links", "p1a1a1a1a1a1")).toMatchObject({ x: 0 });
    expect(context.store.get("links", "p2b2b2b2b2b2")).toMatchObject({ x: 320, y: 0 });
    expect(context.history.canUndo()).toBe(false);
  });

  it("keeps records frozen", () => {
    const context = loadTestContext();
    const item = context.store.get("items", IDEAS)!;
    expect(() => {
      (item as { name: string }).name = "x";
    }).toThrow();
  });
});

describe("view steps", () => {
  it("puts a view step (no data change) on the undo stack, in order with commands", async () => {
    const { History } = await import("../src/core/commands");
    const { Store } = await import("../src/core/store");
    const store = new Store();
    const history = new History(store);
    let shown = true;
    history.recordView("show translation", { undo: () => (shown = false), redo: () => (shown = true) });
    const revision = store.getRevision();
    expect(history.nextUndoLabel()).toBe("show translation");
    history.undo();
    expect(shown).toBe(false);
    history.redo();
    expect(shown).toBe(true);
    // A view step never writes the store.
    expect(store.getRevision()).toBe(revision);
  });
});
