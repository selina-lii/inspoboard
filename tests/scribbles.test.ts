import { describe, expect, it } from "vitest";
import { insidePolygon, lassoSelect } from "../src/ui/windows/marks";

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
