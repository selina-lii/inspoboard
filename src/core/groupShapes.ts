// Group cards: loose areas of a board, as shapes (rounded rectangle, ellipse, free shape). See docs/SPEC.md section 7.12.
// - A card is in a group while its center is in the shape. Nothing else is saved: a move of the card in or out of the
//   shape changes the group. Shapes can overlap: a card can be in more than one group.
// - A group that lies fully in a different group (its box in the box, its center in the shape) is in it too.
// - A free shape is a closed path in a 100 × 100 box (`shapePath`). It stretches to the card size.

import { createItemOnBoard } from "./actions";
import type { ActionContext } from "./actions";
import type { Command } from "./commands";
import { makeOp } from "./commands";
import type { GroupShape, Id, PlaceLink } from "./types";

export type Box = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };

/** The size of the box of a free shape path. */
export const SHAPE_BOX = 100;
/** A drawn shape smaller than this (board units) gets the default size. */
const MIN_DRAWN = 24;

/** The points of a free shape path, in its 100 × 100 box. */
export function pathPoints(path: string): Point[] {
  const numbers = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const points: Point[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) points.push({ x: numbers[index]!, y: numbers[index + 1]! });
  return points;
}

/** The outline of a group card in board units: a polygon (also for a rectangle and an ellipse). */
export function shapeOutline(box: Box, shape: GroupShape | undefined, path: string | undefined): Point[] {
  if (shape === "blob" && path !== undefined) {
    return pathPoints(path).map((point) => ({ x: box.x + (point.x / SHAPE_BOX) * box.w, y: box.y + (point.y / SHAPE_BOX) * box.h }));
  }
  if (shape === "ellipse") {
    const steps = 48;
    return Array.from({ length: steps }, (_unused, index) => {
      const angle = (index / steps) * Math.PI * 2;
      return { x: box.x + box.w / 2 + (Math.cos(angle) * box.w) / 2, y: box.y + box.h / 2 + (Math.sin(angle) * box.h) / 2 };
    });
  }
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h },
  ];
}

/** True if the point is in the shape of the group card. */
export function inShape(box: Box, shape: GroupShape | undefined, path: string | undefined, point: Point): boolean {
  if (point.x < box.x || point.y < box.y || point.x > box.x + box.w || point.y > box.y + box.h) return false;
  if (shape === "ellipse") {
    const dx = (point.x - (box.x + box.w / 2)) / (box.w / 2);
    const dy = (point.y - (box.y + box.h / 2)) / (box.h / 2);
    return dx * dx + dy * dy <= 1;
  }
  if (shape === "blob" && path !== undefined) return inPolygon(point, shapeOutline(box, shape, path));
  return true;
}

/**
 * The members of a group: the given boxes (`key`, box, and `group` true for a group card) that are in its shape.
 * The group itself is not a member.
 */
export function membersOf<T extends { key: string; box: Box; group: boolean }>(group: { key: string; box: Box; shape?: GroupShape; shapePath?: string }, others: readonly T[]): T[] {
  return others.filter((other) => {
    if (other.key === group.key) return false;
    const center = { x: other.box.x + other.box.w / 2, y: other.box.y + other.box.h / 2 };
    if (!inShape(group.box, group.shape, group.shapePath, center)) return false;
    if (!other.group) return true;
    const outer = group.box;
    const inner = other.box;
    return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
  });
}

/**
 * A free shape from drawn board points: its box, and its path in the 100 × 100 box. Close points are dropped and
 * the outline is smoothed (two light 1-2-1 averages), so that the shape is soft. Null for too few points.
 */
export function blobFromPoints(points: readonly Point[]): { box: Box; path: string } | null {
  const kept: Point[] = [];
  for (const point of points) {
    const last = kept.at(-1);
    if (last === undefined || Math.hypot(point.x - last.x, point.y - last.y) >= 6) kept.push(point);
  }
  if (kept.length < 4) return null;
  let smooth = kept;
  for (let pass = 0; pass < 2; pass += 1) {
    smooth = smooth.map((point, index) => {
      const before = smooth[(index - 1 + smooth.length) % smooth.length]!;
      const after = smooth[(index + 1) % smooth.length]!;
      return { x: (before.x + 2 * point.x + after.x) / 4, y: (before.y + 2 * point.y + after.y) / 4 };
    });
  }
  const box = boxOf(smooth);
  if (box.w < MIN_DRAWN || box.h < MIN_DRAWN) return null;
  // At most 120 points: a long outline keeps every n-th point.
  const step = Math.max(1, Math.ceil(smooth.length / 120));
  const scaled = smooth.filter((_point, index) => index % step === 0).map((point) => ({ x: round1(((point.x - box.x) / box.w) * SHAPE_BOX), y: round1(((point.y - box.y) / box.h) * SHAPE_BOX) }));
  const path = `${scaled.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ")} Z`;
  return { box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) }, path };
}

/** The box from the first to the last drawn point (a drag from one corner to the other), or null if it is too small. */
export function boxFromDrag(points: readonly Point[]): Box | null {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return null;
  const box = { x: Math.min(first.x, last.x), y: Math.min(first.y, last.y), w: Math.abs(last.x - first.x), h: Math.abs(last.y - first.y) };
  if (box.w < MIN_DRAWN || box.h < MIN_DRAWN) return null;
  return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) };
}

/** Creates a group card on a board. One command. */
export function createGroupShape(context: ActionContext, input: { boardId: Id; box: Box; shape: GroupShape; shapePath?: string }): { command: Command; itemId: Id; placeId: Id } {
  const made = createItemOnBoard(context, { boardId: input.boardId, view: "group", x: input.box.x, y: input.box.y });
  const ops = made.command.ops.map((op) => {
    if (op.table !== "links" || op.after === null) return op;
    const place = { ...(op.after as PlaceLink), w: input.box.w, h: input.box.h };
    if (input.shape !== "rect") place.shape = input.shape;
    if (input.shape === "blob" && input.shapePath !== undefined) place.shapePath = input.shapePath;
    return makeOp("links", place.id, null, place);
  });
  return { command: { label: "Create group", ops }, itemId: made.itemId, placeId: made.placeId };
}

function boxOf(points: readonly Point[]): Box {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function inPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let index = 0, before = polygon.length - 1; index < polygon.length; before = index, index += 1) {
    const a = polygon[index]!;
    const b = polygon[before]!;
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
