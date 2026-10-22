import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { buildGalaxyModel } from "../src/ui/galaxy/galaxyModel";
import { buildTour, stopAt, tourTarget } from "../src/ui/galaxy/tour";
import { loadTestContext, ROOT } from "./helpers";

describe("3D tour", () => {
  it("starts and ends at the whole board, visits the major stars, and moves at one speed", () => {
    const context = loadTestContext();
    const model = buildGalaxyModel(context.store, context.graph, ROOT);
    const tour = buildTour(model)!;
    expect(tour).not.toBeNull();
    // Start and end: the wide view above the board (a closed path through it).
    expect(tour.curve.getPointAt(0).distanceTo(tour.overview)).toBeLessThan(tour.boardRadius * 0.5);
    expect(tour.curve.getPointAt(0.999).distanceTo(tour.overview)).toBeLessThan(tour.boardRadius * 0.6);
    expect(tour.stops.length).toBeGreaterThan(0);
    // Stops are in order along the path, and each one is a part of the path near its star.
    for (const [index, stop] of tour.stops.entries()) {
      expect(stop.u1).toBeGreaterThan(stop.u0);
      if (index > 0) expect(stop.u0).toBeGreaterThan(tour.stops[index - 1]!.u1);
      const middle = tour.curve.getPointAt((stop.u0 + stop.u1) / 2);
      expect(middle.distanceTo(stop.center)).toBeLessThan(stop.radius * 1.6);
      expect(stopAt(tour, (stop.u0 + stop.u1) / 2)).toBe(stop);
    }
    // One speed: equal steps of the part `u` are equal distances (arc length).
    const step = 0.01;
    // The distance along the path (many short pieces), not the straight line: the path curves at the stops.
    const along = (u: number) => {
      let sum = 0;
      for (let k = 0; k < 50; k += 1) sum += tour.curve.getPointAt(u + (k * step) / 50).distanceTo(tour.curve.getPointAt(u + ((k + 1) * step) / 50));
      return sum;
    };
    const distances = [0.1, 0.4, 0.7].map(along);
    for (const distance of distances) expect(Math.abs(distance - distances[0]!) / distances[0]!).toBeLessThan(0.05);
    // At the wide view the camera looks at the middle of the board.
    expect(tourTarget(tour, 0, tour.overview.clone()).distanceTo(tour.center)).toBeLessThan(0.5);
  });

  it("has no tour for an empty board", () => {
    const context = loadTestContext();
    const empty = buildGalaxyModel(context.store, context.graph, "zzzzzzzzzzzz");
    expect(buildTour(empty)).toBeNull();
    expect(new Vector3().length()).toBe(0);
  });
});
