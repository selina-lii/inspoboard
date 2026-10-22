// Built-in plugin "Sorting tray" (docs/SPEC.md section 7.16): a sorting map is a board that pulls the items of other
// collections out, a few at a time, to sort them into a new order (for example a mind map of a calendar).
// - The map is an item with `sources`: collections (items with their own board) or groups (outlines, calendars).
// - Its cards are references: the items stay in their sources. A reference keeps the kind and the color of the card
//   in the source.
// - The tray: the items of the sources that are not on the map and not thrown away. It is not saved: a new item in a
//   source comes into the tray by itself.
// - Back to the tray: the reference goes off the map. Throw away: the same, and the item goes into `discarded` (the
//   tray of thrown-away items). Restore takes it out of `discarded` again. The items themselves never change.

import { makeOp, type Command, type Op } from "../../../core/commands";
import { createItemOnBoard, placeRecord, removeFromBoard, type ActionContext } from "../../../core/actions";
import type { Id, ItemRecord, PlaceLink } from "../../../core/types";
import { t } from "../../i18n/i18n";
import { lostTops } from "../../../core/lost";
import { ancestorsOf } from "../../../core/lineage";

/** True if the item is a sorting map. */
export function isSortingMap(context: Pick<ActionContext, "store">, itemId: Id): boolean {
  const item = context.store.get("items", itemId);
  return item?.sources !== undefined || item?.lostAndFound === true;
}

/** True if the ID can be a source: a collection item (it has its own board) or a group (an outline or a calendar). */
export function canBeSource(context: Pick<ActionContext, "store" | "graph">, id: Id): boolean {
  return context.store.has("outlines", id) || (context.store.has("items", id) && context.graph.isBoardItem(id));
}

/** The name of a source: the item name, or the group name. */
export function sourceName(context: Pick<ActionContext, "store">, id: Id): string {
  return context.store.get("items", id)?.name || context.store.get("outlines", id)?.name || "";
}

/** The items of one source, in the order of their cards: the cards of a collection, or the members of a group. */
export function sourceItems(context: Pick<ActionContext, "store" | "graph">, sourceId: Id): Id[] {
  const places = context.store.has("outlines", sourceId) ? context.graph.membersOf(sourceId) : context.graph.childrenOf(sourceId);
  const result: Id[] = [];
  for (const place of places) {
    const item = context.store.get("items", place.to);
    // Group cards (loose areas) are shapes of their board, not things to sort.
    if (item === undefined || place.view === "group" || result.includes(place.to)) continue;
    result.push(place.to);
  }
  return result;
}

/** The cards sorted on a map: its cards, and the cards in its boards at any depth (a card sorted into a collection). */
export function sortedPlaces(context: Pick<ActionContext, "store" | "graph">, mapId: Id): PlaceLink[] {
  const sources = new Set(context.store.get("items", mapId)?.sources ?? []);
  const places: PlaceLink[] = [];
  const boards = [mapId];
  const visited = new Set(boards);
  while (boards.length > 0) {
    for (const place of context.graph.childrenOf(boards.pop()!)) {
      places.push(place);
      // A source on the map is not opened: its items are not sorted by that.
      if (visited.has(place.to) || sources.has(place.to)) continue;
      visited.add(place.to);
      boards.push(place.to);
    }
  }
  return places;
}

/**
 * The items sorted on a map. A processing map (SPEC 7.16): also each item that a sorted item came from (at any depth),
 * so that an original is imported while its copy, or an item with a clip of it, is on the map.
 */
function sortedOn(context: Pick<ActionContext, "store" | "graph">, mapId: Id): Set<Id> {
  const sorted = new Set(sortedPlaces(context, mapId).map((place) => place.to));
  if (context.store.get("items", mapId)?.detached === true) for (const id of [...sorted]) for (const ancestor of ancestorsOf(context.store, id)) sorted.add(ancestor);
  return sorted;
}

/**
 * The items in the tray of a map: the items of its sources that are not sorted on the map and not thrown away. With
 * "Lost and found" (`rootId` needed): also the tops of the items that the root board cannot reach (core/lost.ts).
 */
export function trayItems(context: Pick<ActionContext, "store" | "graph">, mapId: Id, rootId?: Id): Id[] {
  const map = context.store.get("items", mapId);
  if (map === undefined || !isSortingMap(context, mapId)) return [];
  const onMap = sortedOn(context, mapId);
  const discarded = new Set(map.discarded ?? []);
  const result: Id[] = [];
  const lost = map.lostAndFound === true && rootId !== undefined ? [lostTops(context.store, context.graph, rootId)] : [];
  for (const items of [...(map.sources ?? []).map((sourceId) => sourceItems(context, sourceId)), ...lost]) {
    for (const itemId of items) {
      if (itemId === mapId || onMap.has(itemId) || discarded.has(itemId) || result.includes(itemId)) continue;
      result.push(itemId);
    }
  }
  return result;
}

/** The items of the tray that are new since `since` (an ISO time: the last visit of the map): made after it. */
export function newInTray(context: Pick<ActionContext, "store" | "graph">, mapId: Id, since: string | undefined, rootId?: Id): Id[] {
  if (since === undefined) return [];
  return trayItems(context, mapId, rootId).filter((itemId) => (context.store.get("items", itemId)?.created ?? "") > since);
}

/** The thrown-away items of a map that still exist. */
export function discardedItems(context: Pick<ActionContext, "store">, mapId: Id): Id[] {
  return (context.store.get("items", mapId)?.discarded ?? []).filter((itemId) => context.store.has("items", itemId));
}

/** The card of an item in its source: its kind, size, and color go to the reference. An item in the trash: its last card. */
function sourceCard(context: Pick<ActionContext, "store" | "graph">, mapId: Id, itemId: Id): Pick<PlaceLink, "view" | "w" | "h" | "color" | "expanded"> | undefined {
  const sources = new Set(context.store.get("items", mapId)?.sources ?? []);
  const places = context.graph.parentsOf(itemId);
  return places.find((place) => sources.has(place.from) || (place.outline !== undefined && sources.has(place.outline))) ?? context.graph.homeOf(itemId) ?? places[0] ?? context.store.get("items", itemId)?.trashedFrom;
}

/**
 * Takes `count` random items out of the tray and puts them on the map as references, spread around `center` in a
 * random order. `random` gives numbers in [0, 1) (tests give a fixed one). One command.
 */
export function pullFromTray(context: ActionContext, mapId: Id, count: number, center: { x: number; y: number }, random: () => number = Math.random, rootId?: Id, only?: readonly Id[]): { command: Command; placeIds: Id[] } {
  // `only`: take from these items of the tray (for example the new ones).
  const pool = trayItems(context, mapId, rootId).filter((itemId) => only === undefined || only.includes(itemId));
  // Fisher–Yates: the first `count` items of a shuffled copy.
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [pool[index], pool[other]] = [pool[other]!, pool[index]!];
  }
  const chosen = pool.slice(0, Math.max(0, Math.floor(count)));
  // A loose grid around the center, each card moved a little at random: a shuffled table, not a neat list.
  const columns = Math.max(1, Math.ceil(Math.sqrt(chosen.length)));
  const ops: Op[] = [];
  const placeIds: Id[] = [];
  chosen.forEach((itemId, index) => {
    const card = sourceCard(context, mapId, itemId);
    const w = card?.w ?? 200;
    const h = card?.h ?? 120;
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = Math.round(center.x + (column - (columns - 1) / 2) * 260 - w / 2 + (random() - 0.5) * 80);
    const y = Math.round(center.y + (row - (Math.ceil(chosen.length / columns) - 1) / 2) * 200 - h / 2 + (random() - 0.5) * 60);
    const { command, placeId } = placeRecord(context, { boardId: mapId, recordId: itemId, view: card?.view ?? "note", x, y, w, h });
    const op = command.ops[0]!;
    const place = { ...(op.after as PlaceLink) };
    if (card?.color !== undefined) place.color = card.color;
    if (card?.expanded === true) place.expanded = true;
    ops.push(makeOp("links", placeId, null, place));
    placeIds.push(placeId);
  });
  return { command: { label: chosen.length === 1 ? "Pull an item from the tray" : `Pull ${chosen.length} items from the tray`, ops }, placeIds };
}

/** Puts cards of the map back into the tray: their references go off the map. The items do not change. */
export function backToTray(context: ActionContext, placeIds: readonly Id[]): Command {
  const ops = placeIds.flatMap((placeId) => {
    const place = context.store.get("links", placeId);
    return place?.kind === "place" ? [makeOp("links", placeId, place, null)] : [];
  });
  return { label: "Back to the tray", ops };
}

/** Throws cards of the map away: their references go off the map, and their items go into `discarded`. */
export function throwAway(context: ActionContext, mapId: Id, placeIds: readonly Id[]): Command {
  const map = context.store.get("items", mapId);
  if (map === undefined) return { label: "Throw away", ops: [] };
  const back = backToTray(context, placeIds);
  const thrown = back.ops.map((op) => (op.before as PlaceLink).to);
  const discarded = [...new Set([...(map.discarded ?? []), ...thrown])];
  return { label: "Throw away", ops: [...back.ops, makeOp("items", mapId, map, { ...map, discarded })] };
}

/**
 * Delete on a sorting map (SPEC 7.16): a reference card is thrown away (as "Throw away"). A card of the map's own item
 * (a copy on a processing map, or a new card) is deleted as on any board; the originals of a copy are thrown away,
 * so they do not come back into the tray.
 */
export function deleteOnMap(context: ActionContext, mapId: Id, placeIds: readonly Id[]): Command {
  const map = context.store.get("items", mapId);
  const places = placeIds.map((placeId) => context.store.get("links", placeId)).filter((place): place is PlaceLink => place?.kind === "place");
  const references = places.filter((place) => place.ref === true);
  const own = places.filter((place) => place.ref !== true);
  const ops: Op[] = [...backToTray(context, references.map((place) => place.id)).ops];
  if (own.length > 0) ops.push(...removeFromBoard(context, own.map((place) => place.id)).ops);
  const originals = own.flatMap((place) => (context.store.get("items", place.to)?.madeFrom ?? []).map((source) => source.from));
  const thrown = [...new Set([...(map?.discarded ?? []), ...references.map((place) => place.to), ...originals])];
  if (map !== undefined && thrown.length !== (map.discarded ?? []).length) ops.push(makeOp("items", mapId, map, { ...map, discarded: thrown }));
  return { label: "Throw away", ops };
}

/** Takes items out of the thrown-away list of a map: they are in the tray again. */
export function restoreToTray(context: ActionContext, mapId: Id, itemIds: readonly Id[]): Command {
  const map = context.store.get("items", mapId);
  if (map?.discarded === undefined) return { label: "Restore to the tray", ops: [] };
  const after: ItemRecord = { ...map, discarded: map.discarded.filter((itemId) => !itemIds.includes(itemId)) };
  if (after.discarded!.length === 0) delete after.discarded;
  return { label: "Restore to the tray", ops: [makeOp("items", mapId, map, after)] };
}

/** Adds a source to a map (or makes the item a map). A source that is there already does not change. */
export function addSource(context: ActionContext, mapId: Id, sourceId: Id): Command {
  const map = context.store.get("items", mapId);
  if (map === undefined || sourceId === mapId || map.sources?.includes(sourceId) === true) return { label: "Add a source", ops: [] };
  return { label: "Add a source", ops: [makeOp("items", mapId, map, { ...map, sources: [...(map.sources ?? []), sourceId] })] };
}

/** Removes a source from a map. Its cards on the map stay. The map stays a map (with no sources, its tray is empty). */
export function removeSource(context: ActionContext, mapId: Id, sourceId: Id): Command {
  const map = context.store.get("items", mapId);
  if (map?.sources === undefined) return { label: "Remove a source", ops: [] };
  return { label: "Remove a source", ops: [makeOp("items", mapId, map, { ...map, sources: map.sources.filter((id) => id !== sourceId) })] };
}

/** Turns "Lost and found" on or off as a source of a map. */
export function setLostAndFound(context: ActionContext, mapId: Id, on: boolean): Command {
  const map = context.store.get("items", mapId);
  if (map === undefined || (map.lostAndFound === true) === on) return { label: "Lost and found", ops: [] };
  const after: ItemRecord = { ...map };
  if (on) after.lostAndFound = true;
  else delete after.lostAndFound;
  return { label: "Lost and found", ops: [makeOp("items", mapId, map, after)] };
}

/** The "Lost and found" map on the root board, or a new one (made with the command). */
export function lostAndFoundMap(context: ActionContext, rootId: Id, at: { x: number; y: number }): { mapId: Id; command: Command | null } {
  const existing = context.graph.childrenOf(rootId).find((place) => context.store.get("items", place.to)?.lostAndFound === true);
  if (existing !== undefined) return { mapId: existing.to, command: null };
  const created = createItemOnBoard(context, { boardId: rootId, view: "note", x: Math.round(at.x), y: Math.round(at.y), board: true, name: t("Lost and found") });
  const ops = created.command.ops.map((op) => (op.table === "items" && op.id === created.itemId && op.after !== null ? { ...op, after: { ...(op.after as ItemRecord), lostAndFound: true } } : op));
  return { mapId: created.itemId, command: { label: "Lost and found", ops } };
}

/** Makes a new sorting map on a board, with one source. The map is an empty board item named after the source. */
export function createSortingMap(context: ActionContext, input: { boardId: Id; x: number; y: number; sourceId: Id }): { command: Command; mapId: Id; placeId: Id } {
  // The name is data: it is written in the UI language of the moment.
  const name = t("Map of {0}", sourceName(context, input.sourceId) || t("items"));
  const created = createItemOnBoard(context, { boardId: input.boardId, view: "note", x: input.x, y: input.y, board: true, name });
  const ops = created.command.ops.map((op) => (op.table === "items" && op.id === created.itemId && op.after !== null ? { ...op, after: { ...(op.after as ItemRecord), sources: [input.sourceId] } } : op));
  return { command: { label: "Make a sorting map", ops }, mapId: created.itemId, placeId: created.placeId };
}
