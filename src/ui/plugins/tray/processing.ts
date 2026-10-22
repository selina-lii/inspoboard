// Processing maps (SPEC 7.16, "Processing maps and lineage"): a detached sorting map. Its cards become copies of the
// originals (core/lineage.ts: `madeFrom`), so the user changes the copies and the originals stay as they are.
// - Copies (setting `detachCopies`): at the first change ("edit"), all at detach ("all"), or new pulls only ("new").
// - Copy on write: a change made on a board of the map (the map, or a board in it) to the item of a reference card
//   changes a copy of it (copyOnWrite). So the originals never change from the map, in each mode.
// - A collection (an item with its own board) stays a reference until it changes or opens: then its copy gets
//   reference cards of the same items (and copies of its groups and scribbles), not copies of them.
// - The files of a copied item (saved web page or PDF, notes, marks) are copied after the command (copyFilesOf).
// - Updates: the items on the map whose sources changed. "Same meaning" accepts a change (acceptChanges).

import { makeOp, type Command, type Op } from "../../../core/commands";
import type { ActionContext } from "../../../core/actions";
import { canCopy, copyOps, isOutdated } from "../../../core/lineage";
import type { GraphIndex } from "../../../core/graph";
import type { Store } from "../../../core/store";
import type { Id, ItemRecord, OutlineRecord, PlaceLink, TableName, TableRecords } from "../../../core/types";
import type { DetachCopies } from "../../../io/settings";
import { isSortingMap, sortedPlaces, trayItems } from "./tray";

export function isProcessingMap(context: Pick<ActionContext, "store">, mapId: Id): boolean {
  return context.store.get("items", mapId)?.detached === true;
}

/** The processing map that a card is on (directly, or in a board on the map), or null. */
export function processingMapOf(context: Pick<ActionContext, "store" | "graph">, place: PlaceLink): Id | null {
  return processingMapAbove(context, place.from);
}

/** The processing map that a board is (or is in, along home cards), or null. */
export function processingMapAbove(context: Pick<ActionContext, "store" | "graph">, boardId: Id): Id | null {
  const seen = new Set<Id>();
  let board: Id | undefined = boardId;
  while (board !== undefined && !seen.has(board)) {
    seen.add(board);
    if (isProcessingMap(context, board)) return board;
    board = context.graph.homeOf(board)?.from;
  }
  return null;
}

/** True if an item has a card on a processing map (directly, or in a board on it). */
export function isOnProcessingMap(context: Pick<ActionContext, "store" | "graph">, itemId: Id): boolean {
  return context.graph.parentsOf(itemId).some((place) => processingMapOf(context, place) !== null);
}

/** True if a card is a reference on a processing map: it becomes a copy when it opens or changes (in each mode). */
export function copiesOnEdit(context: Pick<ActionContext, "store" | "graph">, place: PlaceLink): boolean {
  return place.ref === true && context.store.has("items", place.to) && processingMapOf(context, place) !== null;
}

/** The copied items of a command: [original, copy] for each, to copy their files after it runs. */
export type Copied = [Id, Id][];

/**
 * The card becomes a card of a copy: the same place, size, kind, and color; the copy is the card's item now (no
 * reference). The original does not change.
 */
export function copyCard(context: ActionContext, placeId: Id): { ops: Op[]; copied: Copied; copyId: Id | null; ids: Map<Id, Id> } {
  const place = context.store.get("links", placeId);
  if (place?.kind !== "place") return { ops: [], copied: [], copyId: null, ids: new Map() };
  const made = copyOps(context, place.to, true);
  if (made === null) return { ops: [], copied: [], copyId: null, ids: new Map() };
  const after: PlaceLink = { ...place, to: made.copyId };
  delete after.ref;
  const board = boardCopyOps(context, place.to, made.copyId);
  return { ops: [...made.ops, ...board.ops, makeOp("links", placeId, place, after)], copied: [[place.to, made.copyId]], copyId: made.copyId, ids: board.ids };
}

/**
 * The board of a copied collection: a reference card for each card of the original (the same items), and copies of
 * its groups and scribbles. Nothing for an item with no board. `ids`: original card or group → its copy.
 */
function boardCopyOps(context: ActionContext, boardId: Id, copyId: Id): { ops: Op[]; ids: Map<Id, Id> } {
  const ops: Op[] = [];
  const ids = new Map<Id, Id>();
  for (const outline of context.graph.outlinesOn(boardId)) {
    const id = context.newId();
    ids.set(outline.id, id);
    ops.push(makeOp("outlines", id, null, { ...outline, id, board: copyId } satisfies OutlineRecord));
  }
  const places = context.graph.childrenOf(boardId);
  for (const place of places) ids.set(place.id, context.newId());
  for (const place of places) {
    const card: PlaceLink = { ...place, id: ids.get(place.id)!, from: copyId };
    if (place.outline !== undefined) card.outline = ids.get(place.outline) ?? place.outline;
    if (place.parent !== undefined) card.parent = ids.get(place.parent) ?? place.parent;
    const stamp = context.store.get("stamps", place.to);
    if (stamp !== undefined) {
      // A scribble belongs to its board: it is copied.
      card.to = context.newId();
      ops.push(makeOp("stamps", card.to, null, { ...stamp, id: card.to }));
      delete card.ref;
    } else card.ref = true;
    ops.push(makeOp("links", card.id, null, card));
  }
  return { ops, ids };
}

/** What an unchanged copy has: its fields (not its ID and dates), its text, and the cards and groups of its board. */
export function copySignature(store: Store, graph: GraphIndex, itemId: Id): string {
  const { id: _id, created: _created, modified: _modified, ...fields } = store.get("items", itemId) ?? ({} as ItemRecord);
  const cards = graph.childrenOf(itemId).map(({ id: _place, from: _from, outline: _outline, parent: _parent, ...card }) => card);
  const groups = graph.outlinesOn(itemId).map(({ id: _group, board: _board, ...group }) => group);
  return JSON.stringify([fields, store.get("texts", itemId)?.body ?? null, cards, groups]);
}

/**
 * Copy on write (SPEC 7.16): a command run on a board of a processing map does not change the originals of its
 * reference cards. Each original that the command changes (its fields or text, the cards and groups of its board,
 * a new small item or link on it) is copied first (copyCard), and the command changes the copy. The delete of an
 * original is left out: on the map, only its card goes.
 */
export function copyOnWrite(context: ActionContext, boardId: Id, command: Command): { command: Command; copied: Copied } {
  if (processingMapAbove(context, boardId) === null) return { command, copied: [] };
  const references = new Map<Id, PlaceLink>();
  for (const place of context.graph.childrenOf(boardId)) if (place.ref === true && context.store.has("items", place.to)) references.set(place.to, place);
  const field = (record: unknown, name: string) => (record as Record<string, unknown> | null)?.[name] as Id | undefined;
  const touched = (op: Op): Id[] => {
    const record = op.after ?? op.before;
    const ids =
      op.table === "items" ? [op.before !== null ? op.id : field(record, "on")]
      : op.table === "texts" ? [op.id]
      : op.table === "outlines" ? [field(record, "board")]
      : op.table === "links" && field(record, "kind") === "place" ? [field(record, "from")]
      : op.table === "links" && op.before === null ? [field(record, "from"), field(record, "to")]
      : [];
    return ids.filter((id): id is Id => id !== undefined && references.has(id));
  };
  const originals = [...new Set(command.ops.flatMap(touched))];
  if (originals.length === 0) return { command, copied: [] };

  const ops: Op[] = [];
  const copied: Copied = [];
  const copyOf = new Map<Id, Id>();
  const cardOf = new Map<Id, Id>();
  const ids = new Map<Id, Id>();
  // Each record as the ops so far leave it: a change of an original is written as a change of its copy.
  const state = new Map<string, unknown>();
  const key = (table: TableName, id: Id) => `${table}:${id}`;
  for (const original of originals) {
    const made = copyCard(context, references.get(original)!.id);
    if (made.copyId === null) continue;
    ops.push(...made.ops);
    copied.push(...made.copied);
    copyOf.set(original, made.copyId);
    cardOf.set(references.get(original)!.id, made.copyId);
    for (const [from, to] of made.ids) ids.set(from, to);
    for (const op of made.ops) state.set(key(op.table, op.id), op.after);
  }
  const owner = (id: Id | undefined) => (id === undefined ? id : (copyOf.get(id) ?? id));
  // The fields of a record of the command that name an original (or its cards and groups) name the copy.
  const retarget = (op: Op, id: Id, record: TableRecords[TableName] | null) => {
    if (record === null) return null;
    const next = { ...record, id } as Record<string, unknown>;
    if (op.table === "items") next.on = owner(next.on as Id | undefined);
    if (op.table === "outlines") next.board = owner(next.board as Id);
    if (op.table === "links" && next.kind === "place") {
      next.from = owner(next.from as Id);
      if (next.outline !== undefined) next.outline = ids.get(next.outline as Id) ?? next.outline;
      if (next.parent !== undefined) next.parent = ids.get(next.parent as Id) ?? next.parent;
      if (cardOf.has(op.id)) {
        next.to = cardOf.get(op.id);
        delete next.ref;
      }
    } else if (op.table === "links" && op.before === null) {
      next.from = owner(next.from as Id);
      next.to = owner(next.to as Id);
    }
    if (next.on === undefined) delete next.on;
    return next as TableRecords[TableName];
  };
  for (const op of command.ops) {
    if ((op.table === "items" || op.table === "texts") && op.after === null && copyOf.has(op.id)) continue;
    const id = op.table === "items" || op.table === "texts" ? owner(op.id)! : (ids.get(op.id) ?? op.id);
    const known = state.has(key(op.table, id));
    let after = retarget(op, id, op.after);
    if (known && id !== op.id && op.before !== null && after !== null) {
      // A change of the original, written onto the copy: the copy keeps its own ID, dates, and lineage.
      const copy = { ...(state.get(key(op.table, id)) as Record<string, unknown>) };
      const before = op.before as Record<string, unknown>;
      const next = op.after as Record<string, unknown>;
      for (const name of new Set([...Object.keys(before), ...Object.keys(next)])) {
        if (name === "id" || JSON.stringify(before[name]) === JSON.stringify(next[name])) continue;
        if (next[name] === undefined) delete copy[name];
        else copy[name] = op.table === "links" || op.table === "outlines" ? (after as Record<string, unknown>)[name] : next[name];
      }
      after = copy as never;
    }
    const before = known ? (state.get(key(op.table, id)) as never) : retarget(op, id, op.before);
    ops.push({ table: op.table, id, before, after } as Op);
    state.set(key(op.table, id), after);
  }
  return { command: { ...command, ops }, copied };
}

/** "Make a copy": a copy of the card's item in a new card at the right of it. The card and its item do not change. */
export function copyBeside(context: ActionContext, placeId: Id): { command: Command; copied: Copied; copyId: Id | null } {
  const place = context.store.get("links", placeId);
  if (place?.kind !== "place") return { command: { label: "Make a copy", ops: [] }, copied: [], copyId: null };
  const made = copyOps(context, place.to);
  if (made === null) return { command: { label: "Make a copy", ops: [] }, copied: [], copyId: null };
  const cardId = context.newId();
  const card: PlaceLink = { ...place, id: cardId, to: made.copyId, x: place.x + place.w + 24 };
  delete card.ref;
  delete card.outline;
  delete card.parent;
  delete card.rank;
  return { command: { label: "Make a copy", ops: [...made.ops, makeOp("links", cardId, null, card)] }, copied: [[place.to, made.copyId]], copyId: made.copyId };
}

/** Detaches a sorting map: it becomes a processing map. "all": its reference cards become copies now. */
export function detachMap(context: ActionContext, mapId: Id, mode: DetachCopies): { command: Command; copied: Copied } {
  const map = context.store.get("items", mapId);
  if (map === undefined || map.detached === true || !isSortingMap(context, mapId)) return { command: { label: "Detach the map", ops: [] }, copied: [] };
  const ops: Op[] = [makeOp("items", mapId, map, { ...map, detached: true } satisfies ItemRecord)];
  const copied: Copied = [];
  if (mode === "all") {
    for (const place of referenceCards(context, mapId)) {
      const made = copyCard(context, place.id);
      ops.push(...made.ops);
      copied.push(...made.copied);
    }
  }
  return { command: { label: "Detach the map", ops }, copied };
}

/** True if a processing map can be a sorting map again: no copy is on it yet (at any depth). */
export function canAttach(context: Pick<ActionContext, "store" | "graph">, mapId: Id): boolean {
  return isProcessingMap(context, mapId) && !sortedPlaces(context, mapId).some((place) => (context.store.get("items", place.to)?.madeFrom?.length ?? 0) > 0);
}

/** "Attach again": a processing map with no copies becomes a sorting map again. */
export function attachMap(context: ActionContext, mapId: Id): Command {
  const map = context.store.get("items", mapId);
  if (map === undefined || !canAttach(context, mapId)) return { label: "Attach the map again", ops: [] };
  const after: ItemRecord = { ...map };
  delete after.detached;
  return { label: "Attach the map again", ops: [makeOp("items", mapId, map, after)] };
}

/** The reference cards on a map that can become copies (also in its boards). */
export function referenceCards(context: Pick<ActionContext, "store" | "graph">, mapId: Id): PlaceLink[] {
  return sortedPlaces(context, mapId).filter((place) => place.ref === true && canCopy(context.store, place.to));
}

/** The pull of a processing map that copies ("all", "new"): the new reference cards of the pull become copies. */
export function asCopies(context: ActionContext, command: Command): { command: Command; copied: Copied } {
  const ops: Op[] = [];
  const copied: Copied = [];
  for (const op of command.ops) {
    const place = op.after as PlaceLink | null;
    if (op.table !== "links" || op.before !== null || place?.kind !== "place" || place.ref !== true) {
      ops.push(op);
      continue;
    }
    const made = copyOps(context, place.to);
    if (made === null) {
      ops.push(op);
      continue;
    }
    const after: PlaceLink = { ...place, to: made.copyId };
    delete after.ref;
    ops.push(...made.ops, makeOp("links", place.id, null, after));
    copied.push([place.to, made.copyId]);
  }
  return { command: { ...command, ops }, copied };
}

/** The scope of a map before it is detached: the items that can be copied (in the tray and on the map). */
export function detachScope(context: Pick<ActionContext, "store" | "graph">, mapId: Id, rootId?: Id): Id[] {
  const onMap = referenceCards(context, mapId).map((place) => place.to);
  return [...new Set([...onMap, ...trayItems(context, mapId, rootId)])].filter((id) => canCopy(context.store, id));
}

/** The size in bytes of the texts of items (UTF-8). The UI adds the size of their files (backend). */
export function textBytes(context: Pick<ActionContext, "store">, itemIds: readonly Id[]): number {
  const encoder = new TextEncoder();
  return itemIds.reduce((sum, id) => sum + encoder.encode(context.store.get("items", id)?.name ?? "").length + encoder.encode(context.store.get("texts", id)?.body ?? "").length, 0);
}

/** "Updates": the items on a processing map whose sources changed. */
export function updatesOf(context: Pick<ActionContext, "store" | "graph">, mapId: Id): Id[] {
  if (!isProcessingMap(context, mapId)) return [];
  return [...new Set(sortedPlaces(context, mapId).map((place) => place.to))].filter((id) => isOutdated(context.store, id));
}
