// Command builders for scribbles (stamps, SPEC 2.4): make, join strokes, erase strokes, split, and read the strokes of
// a scribble on a board or in a note.

import { emptyCommand, makeOp, type Command, type Op } from "./commands";
import { joinStrokes, parsePath, splitStrokes, stampOnBoard, type PathPoint } from "./stamps";
import type { Id, PlaceLink, StampRecord } from "./types";
import type { ActionContext } from "./actions";
import { requirePlace, requireRecord } from "./records";

/** Creates a stamp and places it on a board. */
export function createStampOnBoard(
  context: ActionContext,
  input: { boardId: Id; x: number; y: number; w: number; h: number; path: string; alt?: string; color?: string | null },
): { command: Command; stampId: Id; placeId: Id } {
  const stampId = context.newId();
  const placeId = context.newId();
  const stamp: StampRecord = { id: stampId, alt: input.alt ?? "scribble", w: input.w, h: input.h, path: input.path };
  const place: PlaceLink = {
    id: placeId,
    kind: "place",
    from: input.boardId,
    to: stampId,
    x: input.x,
    y: input.y,
    w: input.w,
    h: input.h,
    view: "text",
  };
  // The ink color of the scribble (none: the theme ink).
  if (input.color != null) place.color = input.color;
  const command: Command = {
    label: "Create scribble",
    ops: [makeOp("stamps", stampId, null, stamp), makeOp("links", placeId, null, place)],
  };
  return { command, stampId, placeId };
}

/**
 * Joins scribbles on one board into the first one. One command.
 * - The first stamp gets all strokes. Its placements on this board and other boards get the new box.
 * - The other placements on this board are removed. A joined stamp with no other placement is deleted.
 * `extra` is a new stroke in board coordinates (the scribble tool adds strokes this way).
 */
export function joinStamps(
  context: ActionContext,
  placeIds: readonly Id[],
  extra: readonly PathPoint[] | null = null,
): Command {
  const places = placeIds.map((placeId) => requirePlace(context, placeId));
  const first = places[0];
  if (first === undefined) return emptyCommand("Join scribbles");
  const strokes: PathPoint[][] = places.map((place) => strokesOfPlacement(context, place).flat());
  if (extra !== null) strokes.push([...extra]);
  const ops = reshapeStampOps(context, first, strokes);
  // The first stamp stays. Mark it as handled so that no op deletes it.
  const handled = new Set<Id>([first.to]);
  for (const place of places.slice(1)) ops.push(...removeStampPlacementOps(context, place, placeIds, handled));
  return { label: extra !== null ? "Add stroke" : "Join scribbles", ops };
}

/**
 * Erases whole strokes from scribbles. One command for all strokes.
 * A scribble with no strokes left is removed from the board. Its stamp is deleted if no other board shows it.
 */
export function eraseStrokes(context: ActionContext, hits: ReadonlyMap<Id, ReadonlySet<number>>): Command {
  const ops: Op[] = [];
  const handled = new Set<Id>();
  const leaving = [...hits.keys()];
  for (const [placeId, strokeIndexes] of hits) {
    const place = requirePlace(context, placeId);
    const remaining = strokesOfPlacement(context, place).filter((_, index) => !strokeIndexes.has(index));
    if (remaining.length === 0) ops.push(...removeStampPlacementOps(context, place, leaving, handled));
    else ops.push(...reshapeStampOps(context, place, remaining));
  }
  return { label: "Erase", ops };
}

/**
 * Splits a scribble into one scribble for each stroke. One command.
 * The first stroke stays in the original stamp. Each other stroke becomes a new stamp with the same alt text,
 * at the same position on the board.
 */
export function splitStamp(context: ActionContext, placeId: Id): { command: Command; placeIds: Id[] } {
  const place = requirePlace(context, placeId);
  const stamp = requireRecord(context.store.get("stamps", place.to), "stamps", place.to);
  const strokes = strokesOfPlacement(context, place);
  if (strokes.length < 2) return { command: emptyCommand("Split scribble"), placeIds: [placeId] };
  const ops = reshapeStampOps(context, place, [strokes[0]!]);
  const placeIds = [placeId];
  for (const stroke of strokes.slice(1)) {
    const shape = joinStrokes([stroke]);
    if (shape === null) continue;
    const stampId = context.newId();
    const newPlaceId = context.newId();
    ops.push(makeOp("stamps", stampId, null, { id: stampId, alt: stamp.alt, w: shape.w, h: shape.h, path: shape.path }));
    ops.push(
      makeOp("links", newPlaceId, null, {
        id: newPlaceId,
        kind: "place",
        from: place.from,
        to: stampId,
        x: shape.x,
        y: shape.y,
        w: shape.w,
        h: shape.h,
        view: place.view,
      }),
    );
    placeIds.push(newPlaceId);
  }
  return { command: { label: "Split scribble", ops }, placeIds };
}

/** The strokes of a placed stamp, or null if the app cannot read its path. Views use this one. */
export function readStrokesOfPlacement(context: ActionContext, place: PlaceLink): PathPoint[][] | null {
  const stamp = context.store.get("stamps", place.to);
  if (stamp === undefined) return null;
  const points = stampOnBoard(stamp, place);
  return points === null ? null : splitStrokes(points);
}

/** The strokes of a placed stamp, in board coordinates. */
export function strokesOfPlacement(context: ActionContext, place: PlaceLink): PathPoint[][] {
  const stamp = requireRecord(context.store.get("stamps", place.to), "stamps", place.to);
  const points = stampOnBoard(stamp, place);
  if (points === null) throw new Error(`Stamp "${stamp.id}" has a path that the app cannot read.`);
  return splitStrokes(points);
}

/** Ops that give the stamp of `place` new strokes (board coordinates). All its placements follow. */
function reshapeStampOps(context: ActionContext, place: PlaceLink, strokes: PathPoint[][]): Op[] {
  const target = requireRecord(context.store.get("stamps", place.to), "stamps", place.to);
  const shape = joinStrokes(strokes);
  if (shape === null) return [];
  const ops: Op[] = [makeOp("stamps", target.id, target, { ...target, w: shape.w, h: shape.h, path: shape.path })];
  for (const other of context.graph.parentsOf(target.id)) {
    // Other placements keep their position and scale. Their box changes with the strokes.
    const scaleX = target.w === 0 ? 1 : other.w / target.w;
    const scaleY = target.h === 0 ? 1 : other.h / target.h;
    const after: PlaceLink =
      other.id === place.id
        ? { ...other, x: shape.x, y: shape.y, w: shape.w, h: shape.h }
        : {
            ...other,
            x: other.x + (shape.x - place.x) * scaleX,
            y: other.y + (shape.y - place.y) * scaleY,
            w: shape.w * scaleX,
            h: shape.h * scaleY,
          };
    ops.push(makeOp("links", other.id, other, after));
  }
  return ops;
}

/**
 * Ops that remove a stamp placement. The stamp is deleted if no placement outside `leaving` shows it.
 * `handled` holds stamps that the command keeps or deletes already. A stamp is deleted one time only.
 */
function removeStampPlacementOps(context: ActionContext, place: PlaceLink, leaving: readonly Id[], handled: Set<Id>): Op[] {
  const ops: Op[] = [makeOp("links", place.id, place, null)];
  const stillPlaced = context.graph.parentsOf(place.to).some((other) => !leaving.includes(other.id));
  if (!stillPlaced && !handled.has(place.to)) {
    handled.add(place.to);
    ops.push(makeOp("stamps", place.to, requireRecord(context.store.get("stamps", place.to), "stamps", place.to), null));
  }
  return ops;
}

/** Reads a stroke path in board coordinates for joinStamps(). */
export function strokeOnBoard(shape: { x: number; y: number; path: string }): PathPoint[] | null {
  const points = parsePath(shape.path);
  return points === null ? null : points.map((point) => ({ ...point, x: shape.x + point.x, y: shape.y + point.y }));
}
