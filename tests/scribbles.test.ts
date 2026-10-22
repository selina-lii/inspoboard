// Every point of a scribble must stay at its board position through join, split, and erase.
import { describe, expect, it } from "vitest";
import { insidePolygon, lassoSelect } from "../src/ui/windows/marks";
import { createStampOnBoard, joinStamps, splitStamp, strokeOnBoard, strokesOfPlacement } from "../src/core/actions";
import { pointInPolygon, simplify, smoothOnce, strokeToStamp } from "../src/ui/tools/stroke";
import type { PathPoint } from "../src/core/stamps";
import { IDEAS, loadTestContext, type TestContext } from "./helpers";
import { schemaErrors } from "../src/core/validate";

describe("lasso on scribbles", () => {
  const square: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];
  it("finds points inside a drawn shape, also in a margin (negative x)", () => {
    expect(insidePolygon([50, 50], square)).toBe(true);
    expect(insidePolygon([150, 50], square)).toBe(false);
    expect(insidePolygon([-20, 10], [[-50, 0], [-10, 0], [-10, 40], [-50, 40]])).toBe(true);
  });
  it("selects the scribbles with at least half of their points inside", () => {
    const scribbles = [
      { id: "in", points: [[10, 10], [20, 20], [30, 30]] as [number, number][] },
      { id: "half", points: [[90, 50], [150, 50]] as [number, number][] },
      { id: "out", points: [[200, 200], [210, 210]] as [number, number][] },
    ];
    expect([...lassoSelect(scribbles, square)].sort()).toEqual(["half", "in"]);
    expect(lassoSelect(scribbles, [[0, 0], [1, 1]]).size).toBe(0);
  });
});

function boardPoints(context: TestContext, placeIds: string[]): string[] {
  const points: PathPoint[] = [];
  for (const placeId of placeIds) {
    const place = context.store.get("links", placeId);
    if (place?.kind !== "place") continue;
    for (const stroke of strokesOfPlacement(context, place)) points.push(...stroke);
  }
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).sort();
}

describe("scribble positions", () => {
  it("keep every point in place through a session and a split", () => {
    const context = loadTestContext();
    const first = strokeToStamp([{ x: 103.37, y: 207.91 }, { x: 140.12, y: 230.55 }, { x: 180.8, y: 211.02 }])!;
    const second = strokeToStamp([{ x: 90.04, y: 300.6 }, { x: 95.5, y: 260.33 }])!;
    const { command, placeId } = createStampOnBoard(context, { boardId: IDEAS, ...first });
    context.history.run(command);
    const before = boardPoints(context, [placeId]);
    context.history.run(joinStamps(context, [placeId], strokeOnBoard(second)));
    const joined = boardPoints(context, [placeId]);
    expect(joined).toEqual(expect.arrayContaining(before));

    const split = splitStamp(context, placeId);
    context.history.run(split.command);
    expect(boardPoints(context, split.placeIds)).toEqual(joined);
  });
});

describe("group drag", () => {
  it("moves every piece by the same rounded amount, so distances never change", async () => {
    const { cleanNumber, roundBoard } = await import("../src/core/stamps");
    const saved = [{ x: 100.3, y: 20.7 }, { x: 140.6, y: 55.1 }, { x: -7.2, y: 0.05 }];
    for (const delta of [0.37, 12.55, -3.04, 101.96, 0.05, 0.15]) {
      // The grabbed node is the first one. React Flow reports its new position with float noise.
      const move = { x: roundBoard(saved[0]!.x + delta - saved[0]!.x), y: roundBoard(saved[0]!.y + delta - saved[0]!.y) };
      const moved = saved.map((point) => ({ x: cleanNumber(point.x + move.x), y: cleanNumber(point.y + move.y) }));
      for (let index = 1; index < saved.length; index += 1) {
        expect((moved[index]!.x - moved[0]!.x).toFixed(6)).toBe((saved[index]!.x - saved[0]!.x).toFixed(6));
        expect((moved[index]!.y - moved[0]!.y).toFixed(6)).toBe((saved[index]!.y - saved[0]!.y).toFixed(6));
      }
    }
  });
});

describe("stroke", () => {
  it("removes points on a straight line", () => {
    const line = Array.from({ length: 50 }, (_, index) => ({ x: index, y: index * 2 }));
    expect(simplify(line, 0.5)).toHaveLength(2);
  });

  it("keeps the end points exactly and smooths inner points only a little", () => {
    const stroke = [{ x: 0, y: 0 }, { x: 10, y: 4 }, { x: 20, y: 0 }];
    const smooth = smoothOnce(stroke);
    expect(smooth[0]).toEqual({ x: 0, y: 0 });
    expect(smooth[2]).toEqual({ x: 20, y: 0 });
    expect(smooth[1]).toEqual({ x: 10, y: 2 });
  });

  it("puts the stamp at the drawn position with 0.1 precision", () => {
    const stroke = [{ x: 10.43, y: 20.61 }, { x: 30.2, y: 20.61 }, { x: 30.2, y: 50.94 }];
    const shape = strokeToStamp(stroke)!;
    expect(shape).toMatchObject({ x: 10.4, y: 20.6 });
    expect(shape.path.startsWith("M0 0")).toBe(true);
    expect(schemaErrors("stamps", { id: "aaaaaaaaaaaa", alt: "scribble", ...shape })).toEqual([]);
  });

  it("tests points against a polygon", () => {
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
  });
});

describe("eraser hit test", () => {
  it("hits a stroke that the eraser crosses and misses a far stroke", async () => {
    const { strokeHit } = await import("../src/ui/tools/stroke");
    const stroke = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(strokeHit(stroke, [{ x: 50, y: -20 }, { x: 50, y: 20 }], 3)).toBe(true);
    expect(strokeHit(stroke, [{ x: 50, y: 30 }, { x: 60, y: 30 }], 3)).toBe(false);
  });
});
