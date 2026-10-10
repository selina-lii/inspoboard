// Stroke helpers for the lasso and scribble tools. Pure functions.

export type Point = { x: number; y: number };

export type StampShape = { x: number; y: number; w: number; h: number; path: string };

/** Stamp coordinates have this precision in board units. */
export const STAMP_PRECISION = 0.1;
/** Points nearer than this to the line through their neighbors are dropped. */
const SIMPLIFY_TOLERANCE = 0.25;

/**
 * Converts a stroke in board coordinates to a stamp: a bounding box and an SVG path
 * relative to the box. Minimum smoothing: one light pass (1-2-1 average) on inner points,
 * then removal of points that are almost on a straight line. The first and last points
 * stay exactly where the user drew them.
 */
export function strokeToStamp(points: readonly Point[]): StampShape | null {
  if (points.length < 2) return null;
  const kept = simplify(smoothOnce(points), SIMPLIFY_TOLERANCE);
  const minX = round(Math.min(...kept.map((point) => point.x)));
  const minY = round(Math.min(...kept.map((point) => point.y)));
  const relative: Point[] = [];
  for (const point of kept) {
    const next = { x: round(point.x - minX), y: round(point.y - minY) };
    const last = relative.at(-1);
    if (last === undefined || last.x !== next.x || last.y !== next.y) relative.push(next);
  }
  if (relative.length < 2) return null;
  const w = Math.max(STAMP_PRECISION, ...relative.map((point) => point.x));
  const h = Math.max(STAMP_PRECISION, ...relative.map((point) => point.y));
  const path = relative.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join("");
  return { x: minX, y: minY, w: round(w), h: round(h), path };
}

/** One pass of a 1-2-1 average on the inner points. The end points do not move. */
export function smoothOnce(points: readonly Point[]): Point[] {
  if (points.length < 3) return [...points];
  const result: Point[] = [points[0]!];
  for (let index = 1; index < points.length - 1; index += 1) {
    const before = points[index - 1]!;
    const point = points[index]!;
    const after = points[index + 1]!;
    result.push({ x: (before.x + 2 * point.x + after.x) / 4, y: (before.y + 2 * point.y + after.y) / 4 });
  }
  result.push(points.at(-1)!);
  return result;
}

/** Ramer–Douglas–Peucker simplification. Removes points closer than `tolerance` to the line. */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let farthest = -1;
    let farthestDistance = tolerance;
    for (let index = first + 1; index < last; index += 1) {
      const distance = distanceToSegment(points[index]!, points[first]!, points[last]!);
      if (distance > farthestDistance) {
        farthest = index;
        farthestDistance = distance;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = true;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

/** True if the eraser path comes within `radius` of the stroke. Crossing segments count as a hit. */
export function strokeHit(stroke: readonly Point[], eraser: readonly Point[], radius: number): boolean {
  const strokeSegments = segmentsOf(stroke);
  const eraserSegments = segmentsOf(eraser);
  return strokeSegments.some(([a, b]) => eraserSegments.some(([c, d]) => segmentDistance(a, b, c, d) <= radius));
}

/** The segments of a polyline. A single point is a segment of zero length. */
function segmentsOf(points: readonly Point[]): [Point, Point][] {
  if (points.length === 1) return [[points[0]!, points[0]!]];
  const segments: [Point, Point][] = [];
  for (let index = 1; index < points.length; index += 1) segments.push([points[index - 1]!, points[index]!]);
  return segments;
}

/** Shortest distance between two segments. Zero if they cross. */
function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(distanceToSegment(a, c, d), distanceToSegment(b, c, d), distanceToSegment(c, a, b), distanceToSegment(d, a, b));
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const side = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = side(c, d, a);
  const d2 = side(c, d, b);
  const d3 = side(a, b, c);
  const d4 = side(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Ray casting test. True if the point is inside the polygon. */
export function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index]!;
    const b = polygon[previous]!;
    const crosses = a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Rounds to the stamp precision. The result has at most one decimal. */
function round(value: number): number {
  return Number((Math.round(value / STAMP_PRECISION) * STAMP_PRECISION).toFixed(1));
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}
