// Stamp geometry: read, move, scale, and join stamp paths. Pure functions.
// A stamp path has "M" and "L" commands with absolute coordinates (see docs/SPEC.md section 2.4).
// "Z" (close the stroke) is read as a line back to the start of the stroke. The shape stays the same.

import type { PlaceLink, StampRecord } from "./types";

export type PathPoint = { command: "M" | "L"; x: number; y: number };

/** A stamp shape in board coordinates. */
export type BoardShape = { x: number; y: number; w: number; h: number; path: string };

/** Board positions have this precision (0.1 units). Stamps and placements use the same grid. */
export const BOARD_PRECISION = 0.1;
const PRECISION = BOARD_PRECISION;

/**
 * Removes floating point noise (for example 100.39999999999999 -> 100.4). It does not move a value
 * to the board grid. Use it for a sum of a saved position and a rounded move.
 */
export function cleanNumber(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * Rounds a board coordinate to the board precision. Positions on the grid move by the same
 * amount in a group drag, so the distance between them never changes.
 */
export function roundBoard(value: number): number {
  return Number((Math.round(value / BOARD_PRECISION) * BOARD_PRECISION).toFixed(1));
}

/** Reads a stamp path. Returns null if the path has a command that is not M, L, or Z. */
export function parsePath(path: string): PathPoint[] | null {
  const tokens = path.match(/[A-Za-z]|-?\d*\.?\d+/g) ?? [];
  const points: PathPoint[] = [];
  let strokeStart: PathPoint | null = null;
  let index = 0;
  while (index < tokens.length) {
    const command = tokens[index]!;
    if (command === "Z" || command === "z") {
      if (strokeStart !== null) points.push({ command: "L", x: strokeStart.x, y: strokeStart.y });
      index += 1;
      continue;
    }
    if (command !== "M" && command !== "L") return null;
    const x = Number(tokens[index + 1]);
    const y = Number(tokens[index + 2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    points.push({ command, x, y });
    if (command === "M") strokeStart = { command, x, y };
    index += 3;
  }
  return points;
}

export function writePath(points: readonly PathPoint[]): string {
  return points.map((point) => `${point.command}${round(point.x)} ${round(point.y)}`).join("");
}

/** The stamp of a placement, in board coordinates. A resized placement scales the path. */
export function stampOnBoard(stamp: StampRecord, place: PlaceLink): PathPoint[] | null {
  const points = parsePath(stamp.path);
  if (points === null) return null;
  const scaleX = stamp.w === 0 ? 1 : place.w / stamp.w;
  const scaleY = stamp.h === 0 ? 1 : place.h / stamp.h;
  return points.map((point) => ({ command: point.command, x: place.x + point.x * scaleX, y: place.y + point.y * scaleY }));
}

/** Joins strokes in board coordinates into one shape. Each stroke keeps its own "M" start. */
export function joinStrokes(strokes: readonly (readonly PathPoint[])[]): BoardShape | null {
  const all = strokes.flat();
  if (all.length === 0) return null;
  const minX = round(Math.min(...all.map((point) => point.x)));
  const minY = round(Math.min(...all.map((point) => point.y)));
  const relative = all.map((point) => ({ command: point.command, x: point.x - minX, y: point.y - minY }));
  const w = Math.max(PRECISION, round(Math.max(...relative.map((point) => point.x))));
  const h = Math.max(PRECISION, round(Math.max(...relative.map((point) => point.y))));
  return { x: minX, y: minY, w, h, path: writePath(relative) };
}

/** Splits a path into strokes. Each stroke starts with an "M" command. */
export function splitStrokes(points: readonly PathPoint[]): PathPoint[][] {
  const strokes: PathPoint[][] = [];
  for (const point of points) {
    if (point.command === "M" || strokes.length === 0) strokes.push([]);
    strokes.at(-1)!.push(point);
  }
  return strokes;
}

const round = roundBoard;
