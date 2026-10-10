// Every point of a scribble must stay at its board position through join, split, and erase.

import { describe, expect, it } from "vitest";
import { createStampOnBoard, joinStamps, splitStamp, strokeOnBoard, strokesOfPlacement } from "../src/core/actions";
import { strokeToStamp } from "../src/ui/tools/stroke";
import type { PathPoint } from "../src/core/stamps";
import { IDEAS, loadTestContext, type TestContext } from "./helpers";

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
