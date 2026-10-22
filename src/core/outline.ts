// Outlines: parts of a board that show their cards as an aligned list, like chapters. See docs/SPEC.md section 7.6.
//
// - An outline is a record (OutlineRecord) on a board. Its member cards stay individual items on that board.
// - A member has `outline`, `rank` (order among its siblings), and `parent` (the place link of its parent row).
// - The outline gives the position of each member: aligned at the left, one row under the other, with equal
//   space between them. A tall (open) card pushes the rows below it down. Thus member positions are derived.
// - Lines between rows are derived too: a plain line between rows that follow each other (same parent),
//   and an arrow from a parent row to each child row.

import { makeOp, type Command, type Op } from "./commands";
import type { ActionContext } from "./actions";
import type { GraphIndex } from "./graph";
import { radialMembers } from "./radial";
import type { Store } from "./store";
import type { Id, ListStyle, OutlineDirection, OutlineRecord, PlaceLink } from "./types";

/** Indent of one level, in board units. */
export const OUTLINE_INDENT = 32;
/** Space between two rows. */
export const OUTLINE_GAP = 14;

export type OutlineRow = {
  placeId: Id;
  recordId: Id;
  /** The place link of the parent row, or null for a top row. */
  parentPlaceId: Id | null;
  depth: number;
  /** Position among the rows with the same parent. */
  index: number;
  /** "•", "2", or "1.3" from the list style of the outline. Empty: no list style. */
  marker: string;
};

/** The rows of an outline in order: each row, then its child rows. */
export function outlineRows(store: Store, graph: GraphIndex, outlineId: Id): OutlineRow[] {
  const outline = store.get("outlines", outlineId);
  // A calendar has days, a radial has a ball (groups.ts, radial.ts): no rows.
  if (outline === undefined || outline.type !== undefined) return [];
  const members = graph.membersOf(outlineId).filter((place) => !store.has("stamps", place.to));
  const memberIds = new Set(members.map((place) => place.id));
  const byParent = new Map<Id | null, PlaceLink[]>();
  for (const place of members) {
    const parent = place.parent !== undefined && memberIds.has(place.parent) && place.parent !== place.id ? place.parent : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), place]);
  }
  const rows: OutlineRow[] = [];
  const reached = new Set<Id>();
  const walk = (parent: Id | null, depth: number, parentNumber: string): void => {
    sortSiblings(byParent.get(parent) ?? []).forEach((place, index) => {
      if (reached.has(place.id)) return;
      reached.add(place.id);
      const number = parentNumber === "" ? `${index + 1}` : `${parentNumber}.${index + 1}`;
      const marker = outline.list === "numbers" ? number : outline.list === "bullets" ? "•" : "";
      rows.push({ placeId: place.id, recordId: place.to, parentPlaceId: parent, depth, index, marker });
      walk(place.id, depth + 1, number);
    });
  };
  walk(null, 0, "");
  // Rows in a parent cycle are never reached from the top. Show them as top rows.
  const lost = sortSiblings(members.filter((place) => !reached.has(place.id)));
  for (const place of lost) {
    rows.push({ placeId: place.id, recordId: place.to, parentPlaceId: null, depth: 0, index: rows.length, marker: outline.list === "bullets" ? "•" : "" });
  }
  return rows;
}

/** Siblings in order: rank first, then reading order, then ID. */
function sortSiblings(places: readonly PlaceLink[]): PlaceLink[] {
  return [...places].sort(
    (a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1),
  );
}

/** Height of a card on the board. The view knows it (an open card is taller). */
export type HeightOf = (place: PlaceLink) => number;

/**
 * The position of each row.
 * - Vertical: aligned at the left (plus indent), with equal space between rows.
 * - Horizontal: top rows from left to right, with equal space between columns. Each column has its top row
 *   and, under it, the child rows (vertical, indented).
 */
export function outlineLayout(outline: OutlineRecord, rows: readonly OutlineRow[], store: Store, heightOf: HeightOf): Map<Id, { x: number; y: number }> {
  if (outline.direction === "horizontal") return horizontalLayout(outline, rows, store, heightOf);
  const positions = new Map<Id, { x: number; y: number }>();
  let y = outline.y;
  for (const row of rows) {
    const place = store.get("links", row.placeId);
    if (place?.kind !== "place") continue;
    positions.set(row.placeId, { x: outline.x + row.depth * OUTLINE_INDENT, y });
    y += heightOf(place) + OUTLINE_GAP;
  }
  return positions;
}

function horizontalLayout(outline: OutlineRecord, rows: readonly OutlineRow[], store: Store, heightOf: HeightOf): Map<Id, { x: number; y: number }> {
  const positions = new Map<Id, { x: number; y: number }>();
  let x = outline.x;
  let column: { x: number; y: number; width: number } | null = null;
  const finish = () => {
    if (column !== null) x = column.x + column.width + 2 * OUTLINE_GAP;
  };
  for (const row of rows) {
    const place = store.get("links", row.placeId);
    if (place?.kind !== "place") continue;
    if (row.depth === 0) {
      finish();
      column = { x, y: outline.y, width: 0 };
    }
    if (column === null) continue;
    const indent = row.depth === 0 ? 0 : (row.depth * OUTLINE_INDENT) / 2;
    positions.set(row.placeId, { x: column.x + indent, y: column.y });
    column.y += heightOf(place) + OUTLINE_GAP;
    column.width = Math.max(column.width, indent + place.w);
  }
  return positions;
}

/** Plain lines: rows that follow each other with the same parent. */
export function sequencePairs(rows: readonly OutlineRow[]): [Id, Id][] {
  const pairs: [Id, Id][] = [];
  const last = new Map<Id | null, Id>();
  for (const row of rows) {
    const previous = last.get(row.parentPlaceId);
    if (previous !== undefined) pairs.push([previous, row.placeId]);
    last.set(row.parentPlaceId, row.placeId);
  }
  return pairs;
}

/** Arrows: from a parent row to each of its child rows. */
export function parentPairs(rows: readonly OutlineRow[]): [Id, Id][] {
  return rows.flatMap((row): [Id, Id][] => (row.parentPlaceId === null ? [] : [[row.parentPlaceId, row.placeId]]));
}

/**
 * The cards of a board in reading order. An outline counts as one block at its position.
 * Its rows follow in outline order. Used for export and for "previous / next" pages.
 */
export function boardOrder(store: Store, graph: GraphIndex, boardId: Id): { place: PlaceLink; row: OutlineRow | null }[] {
  type Block = { x: number; y: number; h: number; entries: { place: PlaceLink; row: OutlineRow | null }[] };
  const blocks: Block[] = [];
  const inOutline = new Set<Id>();
  for (const outline of graph.outlinesOn(boardId)) {
    const rows = outlineRows(store, graph, outline.id);
    // A calendar: its cards by day. A radial: its cards (in their fixed order).
    const days =
      outline.type === "calendar"
        ? [...graph.membersOf(outline.id)].filter((place) => place.day !== undefined).sort((a, b) => ((a.day ?? "") < (b.day ?? "") ? -1 : (a.day ?? "") > (b.day ?? "") ? 1 : 0)).map((place) => ({ place, row: null }))
        : outline.type === "radial"
          ? radialMembers(store, graph, outline.id).map((place) => ({ place, row: null }))
          : [];
    const entries = [
      ...rows.flatMap((row) => {
        const place = store.get("links", row.placeId);
        return place?.kind === "place" ? [{ place, row }] : [];
      }),
      ...days,
    ];
    for (const entry of entries) inOutline.add(entry.place.id);
    if (entries.length > 0) blocks.push({ x: outline.x, y: outline.y, h: 1, entries });
  }
  for (const place of graph.childrenOf(boardId)) {
    if (!inOutline.has(place.id)) blocks.push({ x: place.x, y: place.y, h: place.h, entries: [{ place, row: null }] });
  }
  return readingOrder(blocks).flatMap((block) => block.entries);
}

/** The previous and next item of an item in its outline on a board. */
export function neighbors(store: Store, graph: GraphIndex, boardId: Id, itemId: Id): { previous: Id | null; next: Id | null } {
  for (const outline of graph.outlinesOn(boardId)) {
    const rows = outlineRows(store, graph, outline.id);
    const index = rows.findIndex((row) => row.recordId === itemId);
    if (index !== -1) return { previous: rows[index - 1]?.recordId ?? null, next: rows[index + 1]?.recordId ?? null };
  }
  return { previous: null, next: null };
}

/**
 * Makes an outline from cards on one board, in reading order. One command.
 * If a selected card is in an outline already, the other cards join that outline at its end.
 */
export function createOutline(context: ActionContext, boardId: Id, placeIds: readonly Id[]): { command: Command; outlineId: Id | null } {
  const places = placeIds
    .map((placeId) => context.store.get("links", placeId))
    .filter((place): place is PlaceLink => place?.kind === "place" && place.from === boardId && !context.store.has("stamps", place.to));
  if (places.length === 0) return { command: { label: "Make outline", ops: [] }, outlineId: null };
  const existing = places
    .map((place) => place.outline)
    .find((id) => id !== undefined && context.store.get("outlines", id)?.board === boardId && context.store.get("outlines", id)?.type !== "calendar");
  const ops: Op[] = [];
  let outlineId: Id;
  let rank = 0;
  if (existing !== undefined) {
    outlineId = existing;
    rank = outlineRows(context.store, context.graph, existing).filter((row) => row.parentPlaceId === null).length;
  } else {
    outlineId = context.newId();
    const outline: OutlineRecord = { id: outlineId, board: boardId, x: Math.min(...places.map((p) => p.x)), y: Math.min(...places.map((p) => p.y)) };
    ops.push(makeOp("outlines", outlineId, null, outline));
  }
  for (const place of readingOrder(places.filter((place) => place.outline !== outlineId))) {
    const after: PlaceLink = { ...place, outline: outlineId, rank };
    delete after.parent;
    rank += 1;
    ops.push(makeOp("links", place.id, place, after));
  }
  return { command: { label: existing !== undefined ? "Add to outline" : "Make outline", ops }, outlineId };
}

/**
 * Takes cards out of their outlines. One command. Each card stays where it shows now.
 * Child rows of a removed row move up to its parent. An outline with no cards left is deleted.
 */
export function removeFromOutline(
  context: ActionContext,
  placeIds: readonly Id[],
  heightOf: HeightOf,
  /** Positions for the cards that leave (for example, where the user dropped a card). Default: where they show. */
  positionsOf: ReadonlyMap<Id, { x: number; y: number }> = new Map(),
): Command {
  const ops: Op[] = [];
  const removing = new Set(placeIds);
  const outlineIds = new Set<Id>();
  for (const placeId of placeIds) {
    const place = context.store.get("links", placeId);
    if (place?.kind === "place" && place.outline !== undefined) outlineIds.add(place.outline);
  }
  for (const outlineId of outlineIds) {
    const outline = context.store.get("outlines", outlineId);
    if (outline === undefined) continue;
    // A calendar or a radial: the cards leave it. An empty one stays (a calendar of empty days, a core alone).
    if (outline.type !== undefined) {
      for (const placeId of placeIds) {
        const place = context.store.get("links", placeId);
        if (place?.kind !== "place" || place.outline !== outlineId) continue;
        const position = positionsOf.get(placeId) ?? { x: place.x, y: place.y };
        ops.push(makeOp("links", placeId, place, { ...withoutOutline(place), x: position.x, y: position.y }));
      }
      continue;
    }
    const rows = outlineRows(context.store, context.graph, outlineId);
    const positions = outlineLayout(outline, rows, context.store, heightOf);
    const parentOf = new Map(rows.map((row) => [row.placeId, row.parentPlaceId]));
    /** The nearest parent row that stays. */
    const keptParent = (placeId: Id | null): Id | null => {
      let current = placeId;
      while (current !== null && removing.has(current)) current = parentOf.get(current) ?? null;
      return current;
    };
    const kept = rows.filter((row) => !removing.has(row.placeId));
    // New order: the kept rows keep their order. Ranks are renumbered in each sibling group.
    const nextRank = new Map<Id | null, number>();
    for (const row of rows) {
      const place = context.store.get("links", row.placeId);
      if (place?.kind !== "place") continue;
      if (removing.has(row.placeId)) {
        const position = positionsOf.get(row.placeId) ?? positions.get(row.placeId) ?? { x: place.x, y: place.y };
        const after: PlaceLink = { ...place, x: position.x, y: position.y };
        delete after.outline;
        delete after.parent;
        delete after.rank;
        ops.push(makeOp("links", place.id, place, after));
        continue;
      }
      const parent = keptParent(row.parentPlaceId);
      const rank = nextRank.get(parent) ?? 0;
      nextRank.set(parent, rank + 1);
      const after: PlaceLink = { ...place, rank };
      if (parent === null) delete after.parent;
      else after.parent = parent;
      if (after.rank !== place.rank || after.parent !== place.parent) ops.push(makeOp("links", place.id, place, after));
    }
    if (kept.length === 0) ops.push(makeOp("outlines", outlineId, outline, null));
  }
  return { label: "Take out of outline", ops };
}

/** Moves an outline: all its cards move with it. */
export function moveOutline(context: ActionContext, outlineId: Id, x: number, y: number): Command {
  const before = context.store.get("outlines", outlineId);
  if (before === undefined || (before.x === x && before.y === y)) return { label: "Move outline", ops: [] };
  return { label: "Move outline", ops: [makeOp("outlines", outlineId, before, { ...before, x, y })] };
}

export function setOutlineDirection(context: ActionContext, outlineId: Id, direction: OutlineDirection): Command {
  const before = context.store.get("outlines", outlineId);
  if (before === undefined || (before.direction ?? "vertical") === direction) return { label: "Change outline direction", ops: [] };
  const after: OutlineRecord = { ...before };
  if (direction === "vertical") delete after.direction;
  else after.direction = direction;
  return { label: direction === "horizontal" ? "Make outline horizontal" : "Make outline vertical", ops: [makeOp("outlines", outlineId, before, after)] };
}

/** The smallest width of a row, in board units. */
const MIN_ROW_WIDTH = 40;

/**
 * Changes the width of an outline: the width of its rows.
 * - Vertical: each row ends at the new right edge (a child row is narrower by its indent).
 * - Horizontal: each row changes width in proportion, so the columns keep their look.
 * `before` and `after` are the widths of the row area (the frame without its padding).
 */
export function setOutlineWidth(context: ActionContext, outlineId: Id, before: number, after: number): Command {
  const label = "Change outline width";
  const outline = context.store.get("outlines", outlineId);
  if (outline === undefined || before <= 0 || after <= 0) return { label, ops: [] };
  const ops: Op[] = [];
  for (const row of outlineRows(context.store, context.graph, outlineId)) {
    const place = context.store.get("links", row.placeId);
    if (place?.kind !== "place") continue;
    const target = outline.direction === "horizontal" ? (place.w * after) / before : after - row.depth * OUTLINE_INDENT;
    const w = Math.max(MIN_ROW_WIDTH, Math.round(target));
    if (w !== place.w) ops.push(makeOp("links", place.id, place, { ...place, w }));
  }
  return { label, ops };
}

/** Moves a row to the first or last place among its siblings. */
export function moveRowToEnd(context: ActionContext, placeId: Id, end: "front" | "back"): Command {
  const found = rowOf(context, placeId);
  if (found === null) return { label: "Move row", ops: [] };
  const siblings = found.rows.filter((row) => row.parentPlaceId === found.row.parentPlaceId && row.placeId !== placeId).map((row) => row.placeId);
  const order = end === "front" ? [placeId, ...siblings] : [...siblings, placeId];
  return { label: end === "front" ? "Move to front" : "Move to back", ops: setRanks(context, order, found.row.parentPlaceId) };
}

/**
 * Moves a row before or after a different row of the same outline (a drag and drop).
 * The row gets the parent of the target row. A row cannot move into its own child rows.
 */
export function moveRowTo(context: ActionContext, placeId: Id, targetPlaceId: Id, side: "before" | "after"): Command {
  const found = rowOf(context, placeId);
  const target = found?.rows.find((row) => row.placeId === targetPlaceId);
  if (found === null || target === undefined || targetPlaceId === placeId) return { label: "Move row", ops: [] };
  // The target must not be inside the moved row.
  const parentOf = new Map(found.rows.map((row) => [row.placeId, row.parentPlaceId]));
  for (let current: Id | null = target.parentPlaceId; current !== null; current = parentOf.get(current) ?? null) {
    if (current === placeId) return { label: "Move row", ops: [] };
  }
  const siblings = found.rows.filter((row) => row.parentPlaceId === target.parentPlaceId && row.placeId !== placeId).map((row) => row.placeId);
  const at = siblings.indexOf(targetPlaceId) + (side === "after" ? 1 : 0);
  siblings.splice(at, 0, placeId);
  const ops = setRanks(context, siblings, target.parentPlaceId);
  // The old siblings close the gap.
  if (found.row.parentPlaceId !== target.parentPlaceId) {
    const old = found.rows.filter((row) => row.parentPlaceId === found.row.parentPlaceId && row.placeId !== placeId).map((row) => row.placeId);
    ops.push(...setRanks(context, old, found.row.parentPlaceId));
  }
  return { label: "Move row", ops };
}

export function setOutlineList(context: ActionContext, outlineId: Id, list: ListStyle | null): Command {
  const before = context.store.get("outlines", outlineId);
  if (before === undefined || (before.list ?? null) === list) return { label: "Change list style", ops: [] };
  const after: OutlineRecord = { ...before };
  if (list === null) delete after.list;
  else after.list = list;
  return { label: list === null ? "Remove list marks" : list === "numbers" ? "Number rows" : "Bullet rows", ops: [makeOp("outlines", outlineId, before, after)] };
}

/** Moves a row one place up or down among its siblings. */
export function moveRow(context: ActionContext, placeId: Id, step: -1 | 1): Command {
  const found = rowOf(context, placeId);
  if (found === null) return { label: "Move row", ops: [] };
  const siblings = found.rows.filter((row) => row.parentPlaceId === found.row.parentPlaceId).map((row) => row.placeId);
  const at = siblings.indexOf(placeId);
  const target = at + step;
  if (target < 0 || target >= siblings.length) return { label: "Move row", ops: [] };
  siblings.splice(at, 1);
  siblings.splice(target, 0, placeId);
  return { label: "Move row", ops: setRanks(context, siblings, found.row.parentPlaceId) };
}

/** Indent: the row becomes the last child of the row above it (its previous sibling). */
export function indentRow(context: ActionContext, placeId: Id): Command {
  const found = rowOf(context, placeId);
  if (found === null) return { label: "Indent", ops: [] };
  const siblings = found.rows.filter((row) => row.parentPlaceId === found.row.parentPlaceId);
  const previous = siblings[siblings.indexOf(found.row) - 1];
  if (previous === undefined) return { label: "Indent", ops: [] };
  const children = found.rows.filter((row) => row.parentPlaceId === previous.placeId).map((row) => row.placeId);
  return { label: "Indent", ops: setRanks(context, [...children, placeId], previous.placeId) };
}

/** Outdent: the row moves up one level, just after its old parent row. */
export function outdentRow(context: ActionContext, placeId: Id): Command {
  const found = rowOf(context, placeId);
  if (found === null || found.row.parentPlaceId === null) return { label: "Outdent", ops: [] };
  const parentRow = found.rows.find((row) => row.placeId === found.row.parentPlaceId);
  if (parentRow === undefined) return { label: "Outdent", ops: [] };
  const siblings = found.rows.filter((row) => row.parentPlaceId === parentRow.parentPlaceId).map((row) => row.placeId);
  siblings.splice(siblings.indexOf(parentRow.placeId) + 1, 0, placeId);
  const oldSiblings = found.rows.filter((row) => row.parentPlaceId === parentRow.placeId && row.placeId !== placeId).map((row) => row.placeId);
  return { label: "Outdent", ops: [...setRanks(context, siblings, parentRow.parentPlaceId), ...setRanks(context, oldSiblings, parentRow.placeId)] };
}

function rowOf(context: ActionContext, placeId: Id): { rows: OutlineRow[]; row: OutlineRow } | null {
  const place = context.store.get("links", placeId);
  if (place?.kind !== "place" || place.outline === undefined) return null;
  const rows = outlineRows(context.store, context.graph, place.outline);
  const row = rows.find((entry) => entry.placeId === placeId);
  return row === undefined ? null : { rows, row };
}

/** Ops that give the places ranks 0, 1, 2, ... and the parent. Only changed places get an op. */
function setRanks(context: ActionContext, placeIds: readonly Id[], parent: Id | null): Op[] {
  const ops: Op[] = [];
  placeIds.forEach((placeId, rank) => {
    const place = context.store.get("links", placeId);
    if (place?.kind !== "place") return;
    const after: PlaceLink = { ...place, rank };
    if (parent === null) delete after.parent;
    else after.parent = parent;
    if (after.rank !== place.rank || after.parent !== place.parent) ops.push(makeOp("links", placeId, place, after));
  });
  return ops;
}

/** Ops that delete the outlines that have no cards left when `leaving` leave the board (delete or move). */
export function outlineCleanupOps(context: ActionContext, leaving: readonly PlaceLink[]): Op[] {
  const ops: Op[] = [];
  const leavingIds = new Set(leaving.map((place) => place.id));
  const outlineIds = new Set(leaving.flatMap((place) => (place.outline === undefined ? [] : [place.outline])));
  for (const outlineId of outlineIds) {
    const outline = context.store.get("outlines", outlineId);
    if (outline === undefined || outline.type !== undefined) continue;
    if (context.graph.membersOf(outlineId).every((place) => leavingIds.has(place.id))) ops.push(makeOp("outlines", outlineId, outline, null));
  }
  return ops;
}

/** Removes the outline fields from a place link. */
export function withoutOutline(place: PlaceLink): PlaceLink {
  const after: PlaceLink = { ...place };
  delete after.outline;
  delete after.parent;
  delete after.rank;
  delete after.day;
  delete after.until;
  delete after.time;
  delete after.offset;
  return after;
}

/**
 * Sorts placements in reading order: top to bottom in bands, then left to right.
 * A placement joins the current band if its top is above the middle of the first placement in the band.
 */
export function readingOrder<T extends { x: number; y: number; h: number }>(places: readonly T[]): T[] {
  const byTop = [...places].sort((a, b) => a.y - b.y || a.x - b.x);
  const result: T[] = [];
  let band: T[] = [];
  let bandLimit = Number.NEGATIVE_INFINITY;
  for (const place of byTop) {
    if (band.length > 0 && place.y >= bandLimit) {
      result.push(...band.sort((a, b) => a.x - b.x));
      band = [];
    }
    if (band.length === 0) bandLimit = place.y + place.h / 2;
    band.push(place);
  }
  result.push(...band.sort((a, b) => a.x - b.x));
  return result;
}
