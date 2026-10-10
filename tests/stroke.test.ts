import { describe, expect, it } from "vitest";
import { pointInPolygon, simplify, smoothOnce, strokeToStamp } from "../src/ui/tools/stroke";
import { schemaErrors } from "../src/core/validate";

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
