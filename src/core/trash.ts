// The trash: items that are on no board. See docs/SPEC.md section 5.4.
// - A delete on a board removes only the card (the place link). When an item loses its last card, it goes to the
//   trash: the command also writes `trashed` (the time) and `trashedFrom` (its last card) on the item.
// - When the item gets a card again (Restore, "Show an item here", Undo), the same rule removes the two fields.
// - Items that are on no board and have no `trashed` field (older versions) show in the trash too, as "older".
// - Nothing leaves the trash by itself. Only "Delete forever" deletes the item record and its text (the text file
//   goes to .inspoboard/trash, as for each delete).

import { makeOp, type Command, type Op } from "./commands";
import { deleteItem, placeRecord, threadOf, type ActionContext } from "./actions";
import { insideEntries } from "./inside";
import type { GraphIndex } from "./graph";
import type { Store } from "./store";
import type { Id, ItemRecord, PlaceLink, TrashedFrom } from "./types";

/** An item in the trash. `trashed` is null for an item of an older version (no time is known). */
export type TrashEntry = { itemId: Id; trashed: string | null; from: TrashedFrom | null };

/**
 * Adds the trash fields to a command: `trashed` and `trashedFrom` on each item that loses its last card, and their
 * removal on each item in the trash that gets a card. Other commands come back unchanged.
 */
export function withTrashMarks(context: ActionContext, rootId: Id, command: Command): Command {
  if (command.view !== undefined || command.ops.length === 0) return command;
  // The item records that the command writes (the last value), and the cards that it removes or adds.
  const itemAfter = new Map<Id, ItemRecord | null>();
  const touched = new Set<Id>();
  for (const op of command.ops) {
    if (op.table === "items") itemAfter.set(op.id, op.after as ItemRecord | null);
    if (op.table !== "links") continue;
    for (const link of [op.before, op.after]) if (link !== null && (link as PlaceLink).kind === "place") touched.add((link as PlaceLink).to);
  }
  if (touched.size === 0) return command;

  const extra: Op[] = [];
  const changed = new Map<Id, ItemRecord>();
  for (const itemId of touched) {
    const before = context.store.get("items", itemId);
    // A new item, or an item that the command deletes: no trash fields.
    if (before === undefined || itemAfter.get(itemId) === null) continue;
    if (itemId === rootId || isAttached(context.store, before)) continue;
    // A small item inside a page (now, or after the command): it is not on a board, and not in the trash.
    if (insideAfter(context, command.ops, itemId)) continue;
    const cardsBefore = context.graph.parentsOf(itemId);
    const cardsAfter = placesAfter(cardsBefore, command.ops, itemId);
    const current = itemAfter.get(itemId) ?? before;
    let next: ItemRecord | null = null;
    if (cardsBefore.length > 0 && cardsAfter.length === 0) {
      const last = cardsBefore.find((place) => place.ref !== true) ?? cardsBefore[0]!;
      next = { ...current, trashed: context.now(), trashedFrom: { board: last.from, x: last.x, y: last.y, w: last.w, h: last.h, view: last.view } };
    } else if (cardsAfter.length > 0 && (current.trashed !== undefined || current.trashedFrom !== undefined)) {
      next = { ...current };
      delete next.trashed;
      delete next.trashedFrom;
    }
    if (next === null) continue;
    if (itemAfter.has(itemId)) changed.set(itemId, next);
    else extra.push(makeOp("items", itemId, before, next));
  }
  if (extra.length === 0 && changed.size === 0) return command;
  // An item that the command writes already: its last write gets the fields.
  const lastWrite = new Map<Id, number>();
  command.ops.forEach((op, index) => op.table === "items" && lastWrite.set(op.id, index));
  const ops = command.ops.map((op, index) => (op.table === "items" && changed.has(op.id) && lastWrite.get(op.id) === index ? { ...op, after: changed.get(op.id)! } : op));
  return { ...command, ops: [...ops, ...extra] };
}

/** The cards of an item after the ops: the cards before, less the removed ones, plus the new ones. */
function placesAfter(before: readonly PlaceLink[], ops: readonly Op[], itemId: Id): PlaceLink[] {
  const cards = new Map(before.map((place) => [place.id, place]));
  for (const op of ops) {
    if (op.table !== "links") continue;
    const old = op.before as PlaceLink | null;
    const next = op.after as PlaceLink | null;
    if (old?.kind === "place" && old.to === itemId) cards.delete(op.id);
    if (next?.kind === "place" && next.to === itemId) cards.set(op.id, next);
  }
  return [...cards.values()];
}

/** True if the item is inside an item after the ops (an inside link to it stays or is added). */
function insideAfter(context: ActionContext, ops: readonly Op[], itemId: Id): boolean {
  let inside = context.graph.insideHomeOf(itemId)?.id ?? null;
  for (const op of ops) {
    if (op.table !== "links") continue;
    const old = op.before as { kind?: string; to?: Id } | null;
    const next = op.after as { kind?: string; to?: Id } | null;
    if (old?.kind === "inside" && old.to === itemId && inside === op.id) inside = null;
    if (next?.kind === "inside" && next.to === itemId) inside = op.id;
  }
  return inside !== null;
}

/** An attached object (a reply, a comment on a card) is never on a board itself. It is not in the trash. */
function isAttached(store: Store, item: ItemRecord): boolean {
  return item.on !== undefined && store.has("items", item.on);
}

/** The items in the trash: the most recent first, then the older ones (no time) by their last change. */
export function trashEntries(context: { store: Store; graph: GraphIndex }, rootId: Id): TrashEntry[] {
  const entries = context.graph.unplacedItems(rootId).flatMap((itemId) => {
    const item = context.store.get("items", itemId);
    return item === undefined ? [] : [{ item, entry: { itemId, trashed: item.trashed ?? null, from: item.trashedFrom ?? null } }];
  });
  const key = ({ item }: { item: ItemRecord }) => item.trashed ?? "";
  const changed = ({ item }: { item: ItemRecord }) => item.modified ?? item.created;
  return entries
    .sort((a, b) => (key(a) !== key(b) ? (key(a) < key(b) ? 1 : -1) : changed(a) < changed(b) ? 1 : changed(a) > changed(b) ? -1 : 0))
    .map(({ entry }) => entry);
}

/**
 * Puts an item of the trash back on a board: on its last board at its last place, if that board is on a board itself
 * (or is the root). Else on `fallback` (the current board) at `at`.
 */
export function restoreFromTrash(context: ActionContext, rootId: Id, itemId: Id, fallback: { boardId: Id; x: number; y: number }): { command: Command; boardId: Id } {
  const item = context.store.get("items", itemId);
  if (item === undefined) throw new Error(`Item "${itemId}" is gone.`);
  const from = item.trashedFrom;
  const boardShows = (boardId: Id) => boardId !== itemId && context.store.has("items", boardId) && (boardId === rootId || context.graph.parentsOf(boardId).length > 0);
  const place =
    from !== undefined && boardShows(from.board)
      ? { boardId: from.board, x: from.x, y: from.y, w: from.w, h: from.h, view: from.view }
      : { boardId: fallback.boardId, x: fallback.x, y: fallback.y, w: from?.w ?? 200, h: from?.h ?? 160, view: from?.view ?? "note" };
  const { command } = placeRecord(context, { ...place, recordId: itemId });
  return { command: { ...command, label: "Restore" }, boardId: place.boardId };
}

/**
 * Deletes an item of the trash for good: its record, its text, its links to other items, and the cards on its own
 * board (the items on it that are on no other board then go to the trash). Text links to it in other texts stay
 * (they show the item as gone). The user must confirm before this action.
 */
export function deleteForever(context: ActionContext, itemId: Id): Command {
  const graph = context.graph;
  const linkIds = new Set<Id>();
  for (const link of graph.childrenOf(itemId)) linkIds.add(link.id);
  for (const link of graph.relationsFrom(itemId)) linkIds.add(link.id);
  for (const link of graph.relationsTo(itemId)) linkIds.add(link.id);
  // The small items inside it go with it (with their replies), and their cards (old entries) and links.
  const gone = new Set<Id>();
  for (const entry of insideEntries(context.store, graph, itemId)) {
    if (entry.link !== null) linkIds.add(entry.link.id);
    for (const id of threadOf(context, entry.item.id)) {
      if (id === itemId) continue;
      gone.add(id);
      for (const link of graph.parentsOf(id)) linkIds.add(link.id);
      for (const link of graph.relationsFrom(id)) linkIds.add(link.id);
      for (const link of graph.relationsTo(id)) linkIds.add(link.id);
    }
  }
  const ops: Op[] = [...linkIds].map((linkId) => makeOp("links", linkId, context.store.get("links", linkId)!, null));
  for (const id of gone) ops.push(...deleteItem(context, id).ops);
  ops.push(...deleteItem(context, itemId).ops);
  return { label: "Delete forever", ops };
}
