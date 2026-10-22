import { describe, expect, it } from "vitest";
import { placeRecord, setPlacement3d } from "../src/core/actions";
import { buildGalaxyModel, CLUSTER_SCALE, worldToPlacement } from "../src/ui/galaxy/galaxyModel";
import { createInside } from "../src/core/inside";
import { DATA_INTEGRITY, IDEAS, loadTestContext, RELATION, ROOT, TOOL_RESEARCH } from "./helpers";

describe("galaxy model", () => {
  it("shows children at depth 1 and grandchildren as clusters at depth 2", () => {
    const context = loadTestContext();
    const model = buildGalaxyModel(context.store, context.graph, ROOT);
    expect(model.points.filter((point) => point.depth === 1)).toHaveLength(4);
    const nested = model.points.filter((point) => point.depth === 2);
    expect(nested.map((point) => point.recordId)).toEqual([DATA_INTEGRITY]);
    expect(model.lines.find((line) => line.key === RELATION)).toBeDefined();
  });

  it("uses the saved p3 and converts a dragged cluster point back to local space", () => {
    const context = loadTestContext();
    context.history.run(setPlacement3d(context, new Map([["p2b2b2b2b2b2", [1, 2, 3]]])));
    const model = buildGalaxyModel(context.store, context.graph, ROOT);
    const ideas = model.points.find((point) => point.recordId === IDEAS && point.depth === 1)!;
    expect(ideas.position).toEqual([1, 2, 3]);
    const nested = model.points.find((point) => point.depth === 2)!;
    const world: [number, number, number] = [1 + 2 * CLUSTER_SCALE, 2, 3];
    expect(worldToPlacement(nested, world)).toEqual([2, 0, 0]);
  });

  it("spreads cards with no p3 in depth, the same way each time", () => {
    const context = loadTestContext();
    const first = buildGalaxyModel(context.store, context.graph, ROOT).points.filter((point) => point.depth === 1);
    const again = buildGalaxyModel(context.store, context.graph, ROOT).points.filter((point) => point.depth === 1);
    expect(new Set(first.map((point) => point.position[2])).size).toBeGreaterThan(1);
    expect(again.map((point) => point.position)).toEqual(first.map((point) => point.position));
  });

  it("puts the small items inside a page on a sphere around it (not a ring), and explode turns it", () => {
    const context = loadTestContext();
    for (const body of ["a", "b", "c", "d"]) context.history.run(createInside(context, { homeId: TOOL_RESEARCH, view: "note", at: null, body }).command);
    const satellites = (seed: number) => buildGalaxyModel(context.store, context.graph, ROOT, seed).points.filter((point) => point.key.startsWith("inside:"));
    const first = satellites(0);
    expect(first).toHaveLength(4);
    expect(new Set(first.map((point) => point.position[1].toFixed(3))).size).toBe(4);
    expect(new Set(first.map((point) => point.position[2].toFixed(3))).size).toBeGreaterThan(1);
    expect(satellites(1).map((point) => point.position)).not.toEqual(first.map((point) => point.position));
  });

  it("stops at depth 2 in a cycle", () => {
    const context = loadTestContext();
    context.history.run(placeRecord(context, { boardId: IDEAS, recordId: ROOT, view: "note", x: 0, y: 0, w: 1, h: 1 }).command);
    const model = buildGalaxyModel(context.store, context.graph, ROOT);
    expect(model.points.some((point) => point.recordId === ROOT)).toBe(false);
    expect(model.points.every((point) => point.depth <= 2)).toBe(true);
  });
});

describe("galaxy model: notes and links", () => {
  it("shows a scribble in a note as its satellite, and draws no line for text references", async () => {
    const { createItemOnBoard, createStampOnBoard } = await import("../src/core/actions");
    const context = loadTestContext();
    const note = createItemOnBoard(context, { boardId: ROOT, view: "note", x: 900, y: 0 });
    context.history.run(note.command);
    context.history.run(createStampOnBoard(context, { boardId: note.itemId, x: 5, y: 5, w: 10, h: 10, path: "M0 0 L10 10" }).command);
    const model = buildGalaxyModel(context.store, context.graph, ROOT);
    const notePoint = model.points.find((point) => point.recordId === note.itemId)!;
    expect(notePoint.label).toBe("");
    const satellite = model.points.find((point) => point.parentPosition === notePoint.position)!;
    expect(satellite).toMatchObject({ kind: "stamp", satellite: true, depth: 2 });
    expect(model.lines.every((line) => line.kind === "relation" || line.kind === "cluster")).toBe(true);
    expect(model.lines.find((line) => line.kind === "relation")).toMatchObject({ end: "arrow", start: "none" });
  });
});
