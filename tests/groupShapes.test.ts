import { describe, expect, it } from "vitest";
import { blobFromPoints, boxFromDrag, createGroupShape, inShape, membersOf } from "../src/core/groupShapes";
import { setGroupFilled } from "../src/core/actions";
import { schemaErrors } from "../src/core/validate";
import { buildGalaxyModel } from "../src/ui/galaxy/galaxyModel";
import { readSettings } from "../src/io/settings";
import { loadTestContext, ROOT } from "./helpers";

const box = { x: 0, y: 0, w: 200, h: 100 };

describe("group cards (loose areas)", () => {
  it("finds the cards whose center is in the shape", () => {
    const group = { key: "g", box, shape: "ellipse" as const };
    const cards = [
      { key: "in", box: { x: 90, y: 40, w: 20, h: 20 }, group: false },
      // In the box, but outside the ellipse (corner).
      { key: "corner", box: { x: 0, y: 0, w: 10, h: 10 }, group: false },
      { key: "out", box: { x: 300, y: 40, w: 20, h: 20 }, group: false },
      // A group is in a group only if it lies fully in it.
      { key: "inner", box: { x: 60, y: 30, w: 80, h: 40 }, group: true },
      { key: "wide", box: { x: 60, y: 30, w: 400, h: 40 }, group: true },
    ];
    expect(membersOf(group, cards).map((card) => card.key)).toEqual(["in", "inner"]);
    expect(membersOf({ ...group, shape: "rect" }, cards).map((card) => card.key)).toEqual(["in", "corner", "inner"]);
  });

  it("makes a soft free shape in a 100 × 100 box, and tests points in it", () => {
    const circle = Array.from({ length: 80 }, (_unused, index) => ({ x: 300 + Math.cos((index / 80) * Math.PI * 2) * 100, y: 300 + Math.sin((index / 80) * Math.PI * 2) * 100 }));
    const blob = blobFromPoints(circle)!;
    expect(blob.path).toMatch(/^M[\d. ]+( L[\d. ]+)+ Z$/);
    expect(blob.box.w).toBeGreaterThan(150);
    expect(inShape(blob.box, "blob", blob.path, { x: 300, y: 300 })).toBe(true);
    expect(inShape(blob.box, "blob", blob.path, { x: blob.box.x + 2, y: blob.box.y + 2 })).toBe(false);
    expect(blobFromPoints([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
    expect(boxFromDrag([{ x: 50, y: 80 }, { x: 10, y: 10 }])).toEqual({ x: 10, y: 10, w: 40, h: 70 });
    expect(boxFromDrag([{ x: 0, y: 0 }, { x: 5, y: 5 }])).toBeNull();
  });

  it("creates a group item with a valid place link, in one undo", () => {
    const context = loadTestContext();
    const blob = blobFromPoints(Array.from({ length: 40 }, (_unused, index) => ({ x: Math.cos(index / 6.4) * 90, y: Math.sin(index / 6.4) * 60 })))!;
    const { command, placeId, itemId } = createGroupShape(context, { boardId: ROOT, box: blob.box, shape: "blob", shapePath: blob.path });
    context.history.run(command);
    const place = context.store.get("links", placeId)!;
    expect(place).toMatchObject({ view: "group", shape: "blob", shapePath: blob.path, w: blob.box.w, h: blob.box.h });
    expect(schemaErrors("links", place)).toEqual([]);
    expect(context.store.get("items", itemId)!.name).toBe("");
    // A rectangle is the default shape: no `shape` field.
    const rect = createGroupShape(context, { boardId: ROOT, box, shape: "rect" });
    context.history.run(rect.command);
    expect(context.store.get("links", rect.placeId)).not.toHaveProperty("shape");
    context.history.undo();
    context.history.undo();
    expect(context.store.has("items", itemId)).toBe(false);
  });
});

describe("galaxy explode", () => {
  it("spreads only the cards with no saved 3D place, and only for a new seed", () => {
    const context = loadTestContext();
    const first = buildGalaxyModel(context.store, context.graph, ROOT).points.filter((point) => point.depth === 1 && point.kind !== "group");
    const again = buildGalaxyModel(context.store, context.graph, ROOT, 0).points.filter((point) => point.depth === 1 && point.kind !== "group");
    const exploded = buildGalaxyModel(context.store, context.graph, ROOT, 12345).points.filter((point) => point.depth === 1 && point.kind !== "group");
    expect(again.map((point) => point.position)).toEqual(first.map((point) => point.position));
    expect(exploded.map((point) => point.position)).not.toEqual(first.map((point) => point.position));
    for (const point of exploded) {
      const place = context.store.get("links", point.placeId);
      if (place?.kind === "place" && place.p3 !== undefined) expect(point.position).toEqual(first.find((other) => other.key === point.key)!.position);
    }
  });
});

describe("group look and 3D volume", () => {
  it("saves Filled as an optional field, and the 3D area holds the depth of its cards", () => {
    const context = loadTestContext();
    const places = context.graph.childrenOf(ROOT);
    const left = Math.min(...places.map((place) => place.x)) - 10;
    const top = Math.min(...places.map((place) => place.y)) - 10;
    const around = { x: left, y: top, w: Math.max(...places.map((place) => place.x + place.w)) + 10 - left, h: Math.max(...places.map((place) => place.y + place.h)) + 10 - top };
    const { command, placeId } = createGroupShape(context, { boardId: ROOT, box: around, shape: "rect" });
    context.history.run(command);
    expect(context.store.get("links", placeId)).not.toHaveProperty("filled");
    context.history.run(setGroupFilled(context, placeId, true));
    const place = context.store.get("links", placeId)!;
    expect(place).toMatchObject({ filled: true });
    expect(schemaErrors("links", place)).toEqual([]);
    expect(schemaErrors("links", { ...place, filled: false })).not.toEqual([]);

    const points = buildGalaxyModel(context.store, context.graph, ROOT).points;
    const group = points.find((point) => point.placeId === placeId)!;
    expect(group.area).toMatchObject({ filled: true });
    const cards = points.filter((point) => point.depth === 1 && point.area === null && point.kind !== "group");
    const depths = cards.map((point) => point.position[2] - group.position[2]);
    expect(group.area!.depth[0]).toBeLessThanOrEqual(Math.min(...depths));
    expect(group.area!.depth[1]).toBeGreaterThanOrEqual(Math.max(...depths));

    context.history.undo();
    expect(context.store.get("links", placeId)).not.toHaveProperty("filled");
  });
});

describe("new settings", () => {
  it("reads old settings files with the defaults, and keeps valid values", () => {
    expect(readSettings("{}")).toMatchObject({ topBarButtons: [], scribbleColor: null });
    expect(readSettings(JSON.stringify({ topBarButtons: ["trash", 3, "trash"], scribbleColor: "#ff375f" }))).toMatchObject({ topBarButtons: ["trash"], scribbleColor: "#ff375f" });
    expect(readSettings(JSON.stringify({ scribbleColor: "red" })).scribbleColor).toBeNull();
    expect(readSettings("{}").readerInvert).toBe(false);
    expect(readSettings(JSON.stringify({ readerInvert: true })).readerInvert).toBe(true);
    expect(readSettings(JSON.stringify({ readerInvert: "yes" })).readerInvert).toBe(false);
    expect(readSettings("{}").speechLock).toBe(false);
    expect(readSettings(JSON.stringify({ speechLock: true })).speechLock).toBe(true);
  });
});
