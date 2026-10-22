// The tour of the 3D view (SPEC 7.3): a cruising camera that gives a broad view of all the contents of a board.
// - It starts and ends at a wide, high view of the whole board (the camera pans slowly across it).
// - It visits the major stars (boards with the most cards, groups, the most linked items) in nearest-neighbor order.
//   At each one it circles half a round: that shows most of what is around it.
// - Between stars it flies a "throw": a high arc that bends to one side, as a thrown ball.
// - One closed Catmull-Rom curve. A point at a part of its length (getPointAt) is by arc length: the camera moves at
//   one fixed speed, which a hand drag cannot do.
// Pure: the path comes from the galaxy model only. The view moves the camera on it (GalaxyView.tsx).

import { CatmullRomCurve3, Vector3 } from "three";
import type { GalaxyModel, GalaxyPoint } from "./galaxyModel";

/** How many stars a tour visits at most. */
const MAX_STOPS = 7;
/** A part of a round at each star: half a round is enough to see most items around it. */
const TURNS = 0.45;

export type TourStop = { point: GalaxyPoint; center: Vector3; radius: number; u0: number; u1: number };
export type Tour = {
  curve: CatmullRomCurve3;
  length: number;
  stops: TourStop[];
  /** The whole board: its middle, its size, and the place of the wide view. */
  center: Vector3;
  boardRadius: number;
  overview: Vector3;
};

const toVector = (point: GalaxyPoint) => new Vector3(...point.position);

/** The size of the area around a star: its farthest card (its cluster, or the cards of its group). */
function reachOf(model: GalaxyModel, star: GalaxyPoint): number {
  const center = toVector(star);
  let reach = 0;
  for (const line of model.lines) {
    if (line.kind !== "cluster" || line.fromKey !== star.key) continue;
    reach = Math.max(reach, center.distanceTo(new Vector3(...line.to)));
  }
  return reach;
}

/** How much a star is worth a visit: its cards, and the links that touch it. */
function weightOf(model: GalaxyModel, star: GalaxyPoint): number {
  const links = model.lines.filter((line) => line.kind === "relation" && (line.fromKey === star.key || line.toKey === star.key)).length;
  return star.childCount * 2 + links + (star.kind === "group" ? 3 : 0);
}

export function buildTour(model: GalaxyModel): Tour | null {
  const top = model.points.filter((point) => point.depth === 1);
  if (top.length === 0) return null;
  const center = top.reduce((sum, point) => sum.add(toVector(point)), new Vector3()).divideScalar(top.length);
  const boardRadius = Math.max(2, ...top.map((point) => toVector(point).distanceTo(center))) + 2;
  const overview = center.clone().add(new Vector3(0, boardRadius * 0.9, boardRadius * 1.7));

  // The major stars: the most cards and links. With none of those, the cards that are farthest apart still give a tour.
  const ranked = [...top].sort((a, b) => weightOf(model, b) - weightOf(model, a));
  const chosen = ranked.filter((point) => weightOf(model, point) > 0).slice(0, MAX_STOPS);
  if (chosen.length === 0) chosen.push(...ranked.slice(0, Math.min(MAX_STOPS, 3)));
  const order: GalaxyPoint[] = [];
  let from = overview.clone();
  const left = [...chosen];
  while (left.length > 0) {
    left.sort((a, b) => toVector(a).distanceTo(from) - toVector(b).distanceTo(from));
    const next = left.shift()!;
    order.push(next);
    from = toVector(next);
  }

  const points: Vector3[] = [overview.clone().add(new Vector3(-boardRadius * 0.25, 0, 0)), overview.clone().add(new Vector3(boardRadius * 0.25, 0, 0))];
  const ranges: { point: GalaxyPoint; center: Vector3; radius: number; first: number; last: number }[] = [];
  order.forEach((star, index) => {
    const position = toVector(star);
    const radius = Math.max(1.6, reachOf(model, star) * 1.6 + 0.8);
    const previous = points[points.length - 1]!;
    // Enter the loop on the side that faces where the camera comes from. The loop is tilted a little.
    const enter = previous.clone().sub(position).setY(0);
    const startAngle = enter.lengthSq() === 0 ? 0 : Math.atan2(enter.z, enter.x);
    const tilt = index % 2 === 0 ? 0.25 : -0.2;
    const steps = 4;
    const first = points.length;
    for (let step = 0; step <= steps; step += 1) {
      const angle = startAngle + (step / steps) * TURNS * Math.PI * 2;
      points.push(position.clone().add(new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * tilt + radius * 0.25, Math.sin(angle) * radius)));
    }
    ranges.push({ point: star, center: position, radius, first, last: points.length - 1 });
    // A throw to the next star: a high arc that bends to one side. After the last star: back up to the whole board.
    const next = index + 1 < order.length ? toVector(order[index + 1]!) : overview;
    const exit = points[points.length - 1]!;
    const span = exit.distanceTo(next);
    const side = new Vector3().subVectors(next, exit).cross(new Vector3(0, 1, 0));
    if (side.lengthSq() > 0) side.normalize();
    const middle = exit.clone().lerp(next, 0.5).add(side.multiplyScalar(span * 0.22 * (index % 2 === 0 ? 1 : -1)));
    middle.y += span * 0.32 + radius * 0.5;
    points.push(middle);
  });

  const curve = new CatmullRomCurve3(points, true, "centripetal", 0.5);
  // Enough samples for the arc length (the default 200 is too few for a long path): equal parts are equal distances.
  const divisions = points.length * 40;
  curve.arcLengthDivisions = divisions;
  const length = curve.getLength();
  const lengths = curve.getLengths(divisions);
  const at = (index: number) => lengths[index * 40]! / length;
  const stops = ranges.map((range) => ({ point: range.point, center: range.center, radius: range.radius, u0: at(range.first), u1: at(range.last) }));
  return { curve, length, stops, center, boardRadius, overview };
}

/** Where the camera looks at a place `u` of the tour: ahead on the path, at a star while it circles it, at the middle of the board near the wide view. */
export function tourTarget(tour: Tour, u: number, position: Vector3): Vector3 {
  const ahead = tour.curve.getPointAt((u + Math.min(0.02, (tour.boardRadius * 0.4) / tour.length)) % 1);
  const target = ahead.clone();
  let weight = 0;
  let star: Vector3 | null = null;
  for (const stop of tour.stops) {
    const near = 1 - Math.min(1, Math.max(0, (position.distanceTo(stop.center) - stop.radius * 1.15) / (stop.radius * 1.4)));
    if (near > weight) {
      weight = near;
      star = stop.center;
    }
  }
  const smooth = (value: number) => value * value * (3 - 2 * value);
  if (star !== null) target.lerp(star, smooth(weight));
  const wide = 1 - Math.min(1, Math.max(0, (position.distanceTo(tour.overview) - tour.boardRadius * 0.3) / (tour.boardRadius * 0.5)));
  return target.lerp(tour.center, smooth(wide));
}

/** The stop that the camera circles at `u`, or null between stops. */
export function stopAt(tour: Tour, u: number): TourStop | null {
  return tour.stops.find((stop) => u >= stop.u0 && u <= stop.u1) ?? null;
}
