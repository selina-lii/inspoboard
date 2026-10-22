import { describe, expect, it } from "vitest";
import { createItemOnBoard, renameItem, writeText } from "../src/core/actions";
import { acceptChanges, addSources, ancestorsOf, changedSources, descendantsOf, isOutdated, newestOf, versionOf } from "../src/core/lineage";
import type { PlaceLink } from "../src/core/types";
import { schemaErrors } from "../src/core/validate";
import { asCopies, copiesOnEdit, copyBeside, copyCard, attachMap, canAttach, copyOnWrite, copySignature, detachMap, processingMapOf, detachScope, updatesOf } from "../src/ui/plugins/tray/processing";
import { backToTray, createSortingMap, pullFromTray, trayItems } from "../src/ui/plugins/tray/tray";
import { loadTestContext, ROOT } from "./helpers";

const fixedRandom = () => 0.5;

/** A processing map on the root board, fed by the root board, with two pulled reference cards. */
function processingMap() {
  const context = loadTestContext();
  const made = createSortingMap(context, { boardId: ROOT, x: 0, y: 0, sourceId: ROOT });
  context.history.run(made.command);
  const mapId = made.mapId;
  context.history.run(detachMap(context, mapId, "edit").command);
  // Only items that can be copied (not collections), so that the test cards are notes or pages.
  const pulled = pullFromTray(context, mapId, 50, { x: 0, y: 0 }, fixedRandom);
  context.history.run(pulled.command);
  const cards = pulled.placeIds.map((id) => context.store.get("links", id) as PlaceLink).filter((place) => context.store.get("items", place.to)?.board !== true);
  return { context, mapId, cards };
}

describe("lineage", () => {
  it("a copy remembers its original and the version it saw; a change of the original makes it outdated", () => {
    const { context, mapId, cards } = processingMap();
    const card = cards[0]!;
    const original = card.to;
    expect(copiesOnEdit(context, card)).toBe(true);
    const made = copyCard(context, card.id);
    context.history.run({ label: "copy", ops: made.ops });
    const copyId = made.copyId!;
    expect((context.store.get("links", card.id) as PlaceLink).to).toBe(copyId);
    expect((context.store.get("links", card.id) as PlaceLink).ref).toBeUndefined();
    expect(context.store.get("texts", copyId)?.body).toBe(context.store.get("texts", original)?.body ?? undefined);
    expect(context.store.get("items", copyId)!.madeFrom).toEqual([{ from: original, seen: versionOf(context.store, original) }]);
    expect(schemaErrors("items", context.store.get("items", copyId)!)).toEqual([]);
    // Still imported: its copy is on the map.
    expect(trayItems(context, mapId)).not.toContain(original);

    writeText(context.store, original, "Changed upstream.");
    expect(changedSources(context.store, copyId)).toEqual([original]);
    expect(updatesOf(context, mapId)).toEqual([copyId]);
    context.history.run(acceptChanges(context, [copyId]));
    expect(isOutdated(context.store, copyId)).toBe(false);
    expect(updatesOf(context, mapId)).toEqual([]);

    // Back to the tray: the original can be pulled again.
    context.history.run(backToTray(context, [card.id]));
    expect(trayItems(context, mapId)).toContain(original);
  });

  it("clips give many sources; an item can feed many items; the newest versions are the last generation", () => {
    const { context, cards } = processingMap();
    const [a, b] = [cards[0]!.to, cards[1]!.to];
    const one = copyBeside(context, cards[0]!.id);
    context.history.run(one.command);
    const two = copyBeside(context, cards[1]!.id);
    context.history.run(two.command);
    // A summary: clips of both copies.
    context.history.run(addSources(context, one.copyId!, [two.copyId!]));
    expect(context.store.get("items", one.copyId!)!.madeFrom!.map((source) => source.from)).toEqual([a, two.copyId]);
    expect(ancestorsOf(context.store, one.copyId!)).toEqual(new Set([a, two.copyId, b]));
    expect(descendantsOf(context.store, b)).toEqual(new Set([two.copyId, one.copyId]));
    expect(newestOf(context.store, b)).toEqual([one.copyId]);
    // A source that is there already is not added again.
    expect(addSources(context, one.copyId!, [a]).ops).toHaveLength(0);
  });

  it("detach with 'all' copies the reference cards now; a collection stays a reference; pulls can copy", () => {
    const context = loadTestContext();
    const made = createSortingMap(context, { boardId: ROOT, x: 0, y: 0, sourceId: ROOT });
    context.history.run(made.command);
    const pulled = pullFromTray(context, made.mapId, 50, { x: 0, y: 0 }, fixedRandom);
    context.history.run(pulled.command);
    expect(detachScope(context, made.mapId).length).toBeGreaterThan(0);
    const detached = detachMap(context, made.mapId, "all");
    context.history.run(detached.command);
    for (const placeId of pulled.placeIds) {
      const place = context.store.get("links", placeId) as PlaceLink;
      const item = context.store.get("items", place.to)!;
      if (item.board === true) expect(place.ref).toBe(true);
      else expect(item.madeFrom).toHaveLength(1);
    }
    expect(detached.copied.length).toBeGreaterThan(0);
    // A later pull with copies: no references for items that can be copied.
    context.history.run(backToTray(context, pulled.placeIds));
    const again = asCopies(context, pullFromTray(context, made.mapId, 3, { x: 0, y: 0 }, fixedRandom).command);
    context.history.run(again.command);
    expect(again.copied.length).toBeGreaterThan(0);
  });

  it("copy on write: a change on the map changes a copy; the original stays; undo takes the copy away", () => {
    const { context, mapId, cards } = processingMap();
    const card = cards[0]!;
    const original = card.to;
    const before = { item: context.store.get("items", original), text: context.store.get("texts", original) };
    const { command } = copyOnWrite(context, mapId, renameItem(context, original, "Renamed on the map"));
    context.history.run(command);
    const copyId = (context.store.get("links", card.id) as PlaceLink).to;
    expect(copyId).not.toBe(original);
    expect(context.store.get("items", copyId)!.name).toBe("Renamed on the map");
    expect(context.store.get("items", copyId)!.madeFrom![0]!.from).toBe(original);
    expect(context.store.get("items", original)).toEqual(before.item);
    expect(context.store.get("texts", original)).toEqual(before.text);
    // A small item on a reference card goes on a copy.
    const other = cards[1]!;
    const comment = createItemOnBoard(context, { boardId: mapId, view: "comment", x: 0, y: 0, on: other.to, body: "Note" });
    context.history.run(copyOnWrite(context, mapId, comment.command).command);
    const otherCopy = (context.store.get("links", other.id) as PlaceLink).to;
    expect(otherCopy).not.toBe(other.to);
    expect(context.store.get("items", comment.itemId)!.on).toBe(otherCopy);
    context.history.undo();
    context.history.undo();
    expect(context.store.get("links", card.id)).toEqual(card);
    expect(context.store.has("items", copyId)).toBe(false);
    // The delete of an original from the map is left out (only its card goes).
    const remove = { label: "Delete", ops: [{ table: "items", id: original, before: before.item, after: null }] } as never;
    expect(copyOnWrite(context, mapId, remove).command.ops.some((op) => op.table === "items" && op.id === original)).toBe(false);
    // Off the map, nothing changes.
    const off = renameItem(context, original, "Elsewhere");
    expect(copyOnWrite(context, ROOT, off).command).toBe(off);
  });

  it("copy on write: a collection gets a copy with reference cards of the same items; its original board stays", () => {
    const context = loadTestContext();
    const made = createSortingMap(context, { boardId: ROOT, x: 0, y: 0, sourceId: ROOT });
    context.history.run(made.command);
    context.history.run(detachMap(context, made.mapId, "edit").command);
    const pulled = pullFromTray(context, made.mapId, 50, { x: 0, y: 0 }, fixedRandom);
    context.history.run(pulled.command);
    const card = pulled.placeIds.map((id) => context.store.get("links", id) as PlaceLink).find((place) => context.graph.childrenOf(place.to).length > 0)!;
    const collection = card.to;
    const cardsBefore = context.graph.childrenOf(collection).map((place) => place.id);
    const signatureBefore = copySignature(context.store, context.graph, collection);
    // A new card in the collection (a drop on its card on the map).
    const added = createItemOnBoard(context, { boardId: collection, view: "note", x: 0, y: 0, name: "New" });
    context.history.run(copyOnWrite(context, made.mapId, added.command).command);
    const copyId = (context.store.get("links", card.id) as PlaceLink).to;
    expect(copyId).not.toBe(collection);
    expect(context.graph.childrenOf(collection).map((place) => place.id)).toEqual(cardsBefore);
    expect(copySignature(context.store, context.graph, collection)).toBe(signatureBefore);
    const inCopy = context.graph.childrenOf(copyId);
    expect(inCopy).toHaveLength(cardsBefore.length + 1);
    expect(inCopy.filter((place) => place.ref === true).map((place) => place.to).sort()).toEqual(context.graph.childrenOf(collection).filter((place) => !context.store.has("stamps", place.to)).map((place) => place.to).sort());
    expect(processingMapOf(context, inCopy[0]!)).toBe(made.mapId);
  });

  it("attach again: only while no card is copied", () => {
    const { context, mapId, cards } = processingMap();
    expect(canAttach(context, mapId)).toBe(true);
    context.history.run({ label: "copy", ops: copyCard(context, cards[0]!.id).ops });
    expect(canAttach(context, mapId)).toBe(false);
    expect(attachMap(context, mapId).ops).toHaveLength(0);
    context.history.undo();
    context.history.run(attachMap(context, mapId));
    expect(context.store.get("items", mapId)!.detached).toBeUndefined();
  });
});
