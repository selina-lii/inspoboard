// Radial graphs (SPEC 7.17): a core (a short text) with cards around it, spread as a ball.
// - A radial is a group (an outline record with type "radial"). Its name is the text of the core. Its x, y is the
//   center of the core. `radius` (optional): the size of the ball. `seed` (optional): the spread ("Spread again").
// - Its cards are the place links with `outline` = the radial (as the rows of an outline).
// - The place of each card comes from the spread (not saved). Directions go evenly over a sphere (Fibonacci
//   points), each moved a little at random; the distance to the core is 55 % to 100 % of the radius, so the cards
//   interleave. The board shows the ball from the front (x, y); the 3D view uses z too. On the board, a card is never
//   over the core (its title): a card near the front or the back of the ball goes out to a clear distance.
// - A card that the user puts in place by hand (a drop in the ball) keeps that place: `offset` on its place link.
// - The cards move with the core: a move of the core is a move of the radial only.

import { makeOp, type Command, type Op } from "./commands";
import type { ActionContext } from "./actions";
import { withoutOutline } from "./outline";
import type { GraphIndex } from "./graph";
import type { Store } from "./store";
import type { Id, OutlineRecord, PlaceLink } from "./types";

export const RADIAL = {
  /** The ball radius when the record has none (board units). */
  radius: 260,
  radiusRange: { min: 120, max: 900 },
  /** The smallest distance of a card to the core, as a part of the radius. */
  inner: 0.55,
  /** The space between the core and the nearest edge of a card, on the board (board units). */
  clearance: 16,
  /** The size of the core circle: at least this, and it grows with its text up to `coreMax`. */
  coreMin: 56,
  coreMax: 180,
};

export function isRadial(group: OutlineRecord | undefined): boolean {
  return group?.type === "radial";
}

/** The diameter of the core circle for its text (board units). A short text: a small circle. */
export function coreSize(name: string): number {
  // Wide characters (CJK) take about two narrow ones.
  const width = [...name].reduce((sum, character) => sum + (/[⺀-￿]/.test(character) ? 13 : 7), 0);
  return Math.round(Math.min(RADIAL.coreMax, Math.max(RADIAL.coreMin, width + 22)));
}

/** A small seeded random (the same seed gives the same spread). */
function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** The cards of a radial in a fixed order (by place ID), so a spread does not change while nothing changes. */
export function radialMembers(store: Store, graph: GraphIndex, radialId: Id): PlaceLink[] {
  return graph
    .membersOf(radialId)
    .filter((place) => !store.has("stamps", place.to))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The offset of each card (place link ID) from the center of the core: [x, y, z] in board units. */
export function radialOffsets(store: Store, graph: GraphIndex, radial: OutlineRecord): Map<Id, [number, number, number]> {
  const members = radialMembers(store, graph, radial.id);
  const radius = radial.radius ?? RADIAL.radius;
  const random = seeded(radial.seed ?? 1);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const count = members.length;
  const core = coreSize(radial.name ?? "");
  const offsets = new Map<Id, [number, number, number]>();
  members.forEach((place, index) => {
    const level = 1 - (2 * (index + 0.5)) / count;
    const ring = Math.sqrt(Math.max(0, 1 - level * level));
    const angle = index * golden + (random() - 0.5) * 0.9;
    let direction = [Math.cos(angle) * ring, level + (random() - 0.5) * 0.25, Math.sin(angle) * ring];
    const length = Math.hypot(direction[0]!, direction[1]!, direction[2]!) || 1;
    direction = direction.map((value) => value / length);
    const distance = radius * (RADIAL.inner + random() * (1 - RADIAL.inner));
    if (place.offset !== undefined) {
      offsets.set(place.id, place.offset);
      return;
    }
    let [x, y, z] = [direction[0]! * distance, direction[1]! * distance, direction[2]! * distance];
    // On the board (x, y), the card must not cover the core: at least half the core, half the card, and a margin.
    const clear = core / 2 + Math.hypot(place.w, place.h) / 2 + RADIAL.clearance;
    const flat = Math.hypot(x, y);
    if (flat < clear) {
      const angle = flat < 1 ? index * golden : Math.atan2(y, x);
      x = Math.cos(angle) * clear;
      y = Math.sin(angle) * clear;
    }
    offsets.set(place.id, [Math.round(x), Math.round(y), Math.round(z)]);
  });
  return offsets;
}

/**
 * Cards of a radial put in place by hand: `centers` are the new centers of the cards (board units). Each keeps that
 * place (its `offset` from the core); its depth (z) stays as it was.
 */
export function placeInRadial(context: ActionContext, radialId: Id, centers: ReadonlyMap<Id, { x: number; y: number }>): Command {
  const radial = context.store.get("outlines", radialId);
  if (radial === undefined) return { label: "Move in radial", ops: [] };
  const current = radialOffsets(context.store, context.graph, radial);
  const ops: Op[] = [];
  for (const [placeId, center] of centers) {
    const place = context.store.get("links", placeId);
    if (place?.kind !== "place" || place.outline !== radialId) continue;
    const z = current.get(placeId)?.[2] ?? 0;
    ops.push(makeOp("links", placeId, place, { ...place, offset: [Math.round(center.x - radial.x), Math.round(center.y - radial.y), z] }));
  }
  return { label: "Move in radial", ops };
}

/** A new radial on a board: its core at x, y (the center). */
export function createRadial(context: ActionContext, boardId: Id, x: number, y: number, name = ""): { command: Command; radialId: Id } {
  const radialId = context.newId();
  const radial: OutlineRecord = { id: radialId, type: "radial", board: boardId, x: Math.round(x), y: Math.round(y) };
  if (name.trim() !== "") radial.name = name.trim();
  return { command: { label: "New radial", ops: [makeOp("outlines", radialId, null, radial)] }, radialId };
}

/** Cards join a radial (from the same board). Cards of an outline or a calendar leave it first. */
export function joinRadial(context: ActionContext, radialId: Id, placeIds: readonly Id[]): Command {
  const radial = context.store.get("outlines", radialId);
  const ops: Op[] = [];
  if (radial === undefined) return { label: "Add to radial", ops };
  for (const placeId of placeIds) {
    const place = context.store.get("links", placeId);
    if (place?.kind !== "place" || place.from !== radial.board || place.outline === radialId || place.to === radial.board) continue;
    ops.push(makeOp("links", placeId, place, { ...withoutOutline(place), outline: radialId }));
  }
  return { label: "Add to radial", ops };
}

/** A new spread: the cards go to new random places (the same ball). */
export function spreadAgain(context: ActionContext, radialId: Id): Command {
  const before = context.store.get("outlines", radialId);
  if (before === undefined) return { label: "Spread again", ops: [] };
  return { label: "Spread again", ops: [makeOp("outlines", radialId, before, { ...before, seed: ((before.seed ?? 1) % 1_000_000) + 1 })] };
}

/** Sets the radius of the ball (board units, in the allowed range). */
export function setRadialRadius(context: ActionContext, radialId: Id, radius: number): Command {
  const before = context.store.get("outlines", radialId);
  const value = Math.round(Math.min(RADIAL.radiusRange.max, Math.max(RADIAL.radiusRange.min, radius)));
  if (before === undefined || (before.radius ?? RADIAL.radius) === value) return { label: "Change the size of the radial", ops: [] };
  const after: OutlineRecord = { ...before, radius: value };
  if (value === RADIAL.radius) delete after.radius;
  return { label: "Change the size of the radial", ops: [makeOp("outlines", radialId, before, after)] };
}

/** Deletes a radial. Its cards stay on the board, at `positions` (where they show), or at their own place. */
export function deleteRadial(context: ActionContext, radialId: Id, positions: ReadonlyMap<Id, { x: number; y: number }> = new Map()): Command {
  const radial = context.store.get("outlines", radialId);
  if (radial === undefined) return { label: "Delete radial", ops: [] };
  const ops: Op[] = context.graph.membersOf(radialId).map((place) => makeOp("links", place.id, place, { ...withoutOutline(place), ...(positions.get(place.id) ?? {}) }));
  ops.push(makeOp("outlines", radialId, radial, null));
  return { label: "Delete radial", ops };
}
