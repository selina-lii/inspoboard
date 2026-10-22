import { describe, expect, it } from "vitest";
import type { PlaceLink } from "../src/core/types";
import { schemaErrors } from "../src/core/validate";
import { addSource, backToTray, createSortingMap, discardedItems, pullFromTray, removeSource, restoreToTray, sourceItems, throwAway, trayItems } from "../src/ui/plugins/tray/tray";
import { loadTestContext, ROOT } from "./helpers";

/** A map on the root board, fed by the root board itself. */
function withMap() {
  const context = loadTestContext();
  const { command, mapId } = createSortingMap(context, { boardId: ROOT, x: 0, y: 0, sourceId: ROOT });
  context.history.run(command);
  return { context, mapId };
}

const fixedRandom = () => 0.5;

describe("sorting tray", () => {
  it("makes a map whose tray holds the items of its source, not the map itself", () => {
    const { context, mapId } = withMap();
    const map = context.store.get("items", mapId)!;
    expect(map.sources).toEqual([ROOT]);
    expect(schemaErrors("items", map)).toEqual([]);
    const tray = trayItems(context, mapId);
    expect(tray).not.toContain(mapId);
    expect(tray.length).toBeGreaterThan(1);
    expect(tray.every((itemId) => sourceItems(context, ROOT).includes(itemId))).toBe(true);
  });

  it("pulls X items onto the map as references with the kind and color of their source card", () => {
    const { context, mapId } = withMap();
    const before = trayItems(context, mapId);
    const { command, placeIds } = pullFromTray(context, mapId, 2, { x: 100, y: 100 }, fixedRandom);
    context.history.run(command);
    expect(placeIds).toHaveLength(2);
    const after = trayItems(context, mapId);
    expect(after).toHaveLength(before.length - 2);
    for (const placeId of placeIds) {
      const place = context.store.get("links", placeId) as PlaceLink;
      expect(place.from).toBe(mapId);
      expect(place.ref).toBe(true);
      const source = context.graph.parentsOf(place.to).find((other) => other.from === ROOT)!;
      expect(place.view).toBe(source.view);
      expect(place.color).toBe(source.color);
    }
    // More than the tray holds: all that is left.
    const rest = pullFromTray(context, mapId, 999, { x: 0, y: 0 }, fixedRandom);
    expect(rest.placeIds).toHaveLength(after.length);
  });

  it("back to the tray, throw away, and restore", () => {
    const { context, mapId } = withMap();
    const { command, placeIds } = pullFromTray(context, mapId, 2, { x: 0, y: 0 }, fixedRandom);
    context.history.run(command);
    const [first, second] = placeIds.map((placeId) => (context.store.get("links", placeId) as PlaceLink).to);

    context.history.run(backToTray(context, [placeIds[0]!]));
    expect(trayItems(context, mapId)).toContain(first);

    context.history.run(throwAway(context, mapId, [placeIds[1]!]));
    expect(context.store.has("links", placeIds[1]!)).toBe(false);
    expect(trayItems(context, mapId)).not.toContain(second);
    expect(discardedItems(context, mapId)).toEqual([second]);
    // The item itself stays in its source.
    expect(context.store.has("items", second!)).toBe(true);
    expect(sourceItems(context, ROOT)).toContain(second);

    context.history.run(restoreToTray(context, mapId, [second!]));
    expect(trayItems(context, mapId)).toContain(second);
    expect("discarded" in context.store.get("items", mapId)!).toBe(false);
  });

  it("an item sorted into a collection on the map stays out of the tray", async () => {
    const { createItemOnBoard, placeRecord } = await import("../src/core/actions");
    const { context, mapId } = withMap();
    const box = createItemOnBoard(context, { boardId: mapId, view: "note", x: 0, y: 0, board: true, name: "Box" });
    context.history.run(box.command);
    const itemId = trayItems(context, mapId).find((id) => id !== box.itemId)!;
    context.history.run(placeRecord(context, { boardId: box.itemId, recordId: itemId, view: "note", x: 0, y: 0, w: 200, h: 120 }).command);
    expect(trayItems(context, mapId)).not.toContain(itemId);
    // A source on the map is not opened: its items stay in the tray.
    context.history.run(placeRecord(context, { boardId: mapId, recordId: ROOT, view: "note", x: 0, y: 0, w: 200, h: 120 }).command);
    expect(trayItems(context, mapId).length).toBeGreaterThan(1);
  });

  it("Delete on a map throws away: a reference goes to the thrown-away list; a copy goes, and its original is thrown away", async () => {
    const { copyBeside, detachMap } = await import("../src/ui/plugins/tray/processing");
    const { deleteOnMap } = await import("../src/ui/plugins/tray/tray");
    const { context, mapId } = withMap();
    const { command, placeIds } = pullFromTray(context, mapId, 3, { x: 0, y: 0 }, fixedRandom);
    context.history.run(command);
    const cards = placeIds.map((id) => context.store.get("links", id) as PlaceLink).filter((place) => context.store.get("items", place.to)?.board !== true);
    context.history.run(deleteOnMap(context, mapId, [cards[0]!.id]));
    expect(discardedItems(context, mapId)).toContain(cards[0]!.to);
    expect(context.store.has("items", cards[0]!.to)).toBe(true);
    // A processing map: a copy is deleted (to the trash), and its original does not come back into the tray.
    context.history.run(detachMap(context, mapId, "edit").command);
    const copy = copyBeside(context, cards[1]!.id);
    context.history.run(copy.command);
    context.history.run(backToTray(context, [cards[1]!.id]));
    const copyCard = context.graph.parentsOf(copy.copyId!).find((place) => place.from === mapId)!;
    context.history.run(deleteOnMap(context, mapId, [copyCard.id]));
    expect(context.graph.parentsOf(copy.copyId!)).toHaveLength(0);
    expect(trayItems(context, mapId)).not.toContain(cards[1]!.to);
    expect(discardedItems(context, mapId)).toContain(cards[1]!.to);
  });

  it("items made in a source after the last visit are new; Pull new takes only them", async () => {
    const { createItemOnBoard } = await import("../src/core/actions");
    const { newInTray } = await import("../src/ui/plugins/tray/tray");
    const { context, mapId } = withMap();
    expect(newInTray(context, mapId, undefined)).toEqual([]);
    const since = "2000-01-01T00:00:00.000Z";
    const old = new Set(trayItems(context, mapId).filter((id) => (context.store.get("items", id)?.created ?? "") <= since));
    const created = createItemOnBoard(context, { boardId: ROOT, view: "note", x: 0, y: 0, name: "Fresh" });
    context.history.run(created.command);
    const fresh = newInTray(context, mapId, since);
    expect(fresh).toContain(created.itemId);
    expect(fresh.some((id) => old.has(id))).toBe(false);
    const pulled = pullFromTray(context, mapId, 5, { x: 0, y: 0 }, fixedRandom, undefined, [created.itemId]);
    context.history.run(pulled.command);
    expect(pulled.placeIds).toHaveLength(1);
    expect(newInTray(context, mapId, since)).not.toContain(created.itemId);
  });

  it("adds and removes sources", () => {
    const { context, mapId } = withMap();
    context.history.run(removeSource(context, mapId, ROOT));
    expect(trayItems(context, mapId)).toEqual([]);
    context.history.run(addSource(context, mapId, ROOT));
    expect(context.store.get("items", mapId)!.sources).toEqual([ROOT]);
    expect(addSource(context, mapId, ROOT).ops).toHaveLength(0);
  });
});

describe("lost and found", () => {
  it("finds items in the trash and rings of boards that no board reaches, and the tray salvages them", async () => {
    const { createItemOnBoard, placeRecord, removeFromBoard } = await import("../src/core/actions");
    const { lostTops, reachedItems } = await import("../src/core/lost");
    const { lostAndFoundMap, setLostAndFound } = await import("../src/ui/plugins/tray/tray");
    const context = loadTestContext();
    const before = new Set(lostTops(context.store, context.graph, ROOT));
    // Board A on the root, B on A, a card on B. Then A also on B, and A leaves the root: A and B hold each other only.
    const a = createItemOnBoard(context, { boardId: ROOT, view: "note", x: 0, y: 0, board: true, name: "A" });
    context.history.run(a.command);
    const b = createItemOnBoard(context, { boardId: a.itemId, view: "note", x: 0, y: 0, board: true, name: "B" });
    context.history.run(b.command);
    const card = createItemOnBoard(context, { boardId: b.itemId, view: "note", x: 0, y: 0, name: "Card" });
    context.history.run(card.command);
    context.history.run(placeRecord(context, { boardId: b.itemId, recordId: a.itemId, view: "note", x: 0, y: 0, w: 200, h: 160 }).command);
    context.history.run(removeFromBoard(context, [a.placeId]));
    // And one item in the trash.
    const trashed = createItemOnBoard(context, { boardId: ROOT, view: "note", x: 0, y: 0, name: "Gone" });
    context.history.run(trashed.command);
    context.history.run(removeFromBoard(context, [trashed.placeId]));

    const reached = reachedItems(context.store, context.graph, ROOT);
    expect([a.itemId, b.itemId, card.itemId, trashed.itemId].some((id) => reached.has(id))).toBe(false);
    const tops = lostTops(context.store, context.graph, ROOT).filter((id) => !before.has(id));
    // One top for the ring (its oldest item: A), one for the trashed item. The card comes with its board.
    expect(new Set(tops)).toEqual(new Set([a.itemId, trashed.itemId]));

    const made = lostAndFoundMap(context, ROOT, { x: 0, y: 0 });
    context.history.run(made.command!);
    expect(lostAndFoundMap(context, ROOT, { x: 0, y: 0 }).command).toBeNull();
    expect(trayItems(context, made.mapId, ROOT)).toEqual(expect.arrayContaining([a.itemId, trashed.itemId]));
    const pulled = pullFromTray(context, made.mapId, 50, { x: 0, y: 0 }, fixedRandom, ROOT);
    context.history.run(pulled.command);
    const now = reachedItems(context.store, context.graph, ROOT);
    for (const id of [a.itemId, b.itemId, card.itemId, trashed.itemId]) expect(now.has(id)).toBe(true);
    context.history.run(setLostAndFound(context, made.mapId, false));
    expect(trayItems(context, made.mapId, ROOT)).toEqual([]);
  });
});
