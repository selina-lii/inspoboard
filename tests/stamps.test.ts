import { describe, expect, it } from "vitest";
import { createStampOnBoard, eraseStrokes, joinStamps, splitStamp, strokeOnBoard, strokesOfPlacement } from "../src/core/actions";
import { joinStrokes, parsePath } from "../src/core/stamps";
import { IDEAS, loadTestContext } from "./helpers";

describe("stamps", () => {
  it("reads only M and L paths", () => {
    expect(parsePath("M0 0L1.5 -2")).toEqual([
      { command: "M", x: 0, y: 0 },
      { command: "L", x: 1.5, y: -2 },
    ]);
    expect(parsePath("M0 0C1 1 2 2 3 3")).toBeNull();
  });

  it("joins strokes and keeps each stroke start", () => {
    const shape = joinStrokes([
      [{ command: "M", x: 10, y: 10 }, { command: "L", x: 20, y: 10 }],
      [{ command: "M", x: 15, y: 30 }, { command: "L", x: 15, y: 40 }],
    ])!;
    expect(shape).toEqual({ x: 10, y: 10, w: 10, h: 30, path: "M0 0L10 0M5 20L5 30" });
  });

  it("joins two scribbles into one in one command, and undo restores both", () => {
    const context = loadTestContext();
    const a = createStampOnBoard(context, { boardId: IDEAS, x: 100, y: 100, w: 10, h: 0.1, path: "M0 0L10 0" });
    const b = createStampOnBoard(context, { boardId: IDEAS, x: 100, y: 120, w: 0.1, h: 10, path: "M0 0L0 10" });
    context.history.run(a.command);
    context.history.run(b.command);
    context.history.run(joinStamps(context, [a.placeId, b.placeId]));

    expect(context.store.get("stamps", a.stampId)?.path).toBe("M0 0L10 0M0 20L0 30");
    expect(context.store.get("links", a.placeId)).toMatchObject({ x: 100, y: 100, w: 10, h: 30 });
    expect(context.store.has("stamps", b.stampId)).toBe(false);
    expect(context.store.has("links", b.placeId)).toBe(false);

    context.history.undo();
    expect(context.store.has("stamps", b.stampId)).toBe(true);
    expect(context.store.get("stamps", a.stampId)?.path).toBe("M0 0L10 0");
  });

  it("adds a new stroke to an existing scribble at its drawn position", () => {
    const context = loadTestContext();
    const a = createStampOnBoard(context, { boardId: IDEAS, x: 50, y: 50, w: 10, h: 10, path: "M0 0L10 10" });
    context.history.run(a.command);
    const stroke = strokeOnBoard({ x: 40, y: 70, path: "M0 0L5 0" })!;
    context.history.run(joinStamps(context, [a.placeId], stroke));
    expect(context.store.get("links", a.placeId)).toMatchObject({ x: 40, y: 50, w: 20, h: 20 });
    expect(context.store.get("stamps", a.stampId)?.path).toBe("M10 0L20 10M0 20L5 20");
  });
});

describe("erase strokes", () => {
  it("erases one stroke and keeps the other at its position", () => {
    const context = loadTestContext();
    const a = createStampOnBoard(context, { boardId: IDEAS, x: 100, y: 100, w: 10, h: 30, path: "M0 0L10 0M0 20L0 30" });
    context.history.run(a.command);
    context.history.run(eraseStrokes(context, new Map([[a.placeId, new Set([0])]])));
    expect(context.store.get("stamps", a.stampId)?.path).toBe("M0 0L0 10");
    expect(context.store.get("links", a.placeId)).toMatchObject({ x: 100, y: 120 });
  });

  it("removes the scribble when its last stroke is erased, and undo brings it back", () => {
    const context = loadTestContext();
    const a = createStampOnBoard(context, { boardId: IDEAS, x: 0, y: 0, w: 10, h: 10, path: "M0 0L10 10" });
    context.history.run(a.command);
    context.history.run(eraseStrokes(context, new Map([[a.placeId, new Set([0])]])));
    expect(context.store.has("links", a.placeId)).toBe(false);
    expect(context.store.has("stamps", a.stampId)).toBe(false);
    context.history.undo();
    expect(context.store.get("stamps", a.stampId)?.path).toBe("M0 0L10 10");
  });
});

describe("split", () => {
  it("splits each stroke into its own scribble at the same position, and undo joins them again", () => {
    const context = loadTestContext();
    const a = createStampOnBoard(context, { boardId: IDEAS, x: 100, y: 100, w: 10, h: 30, path: "M0 0L10 0M0 20L0 30", alt: "arrow" });
    context.history.run(a.command);
    const { command, placeIds } = splitStamp(context, a.placeId);
    context.history.run(command);
    expect(placeIds).toHaveLength(2);
    expect(context.store.get("stamps", a.stampId)?.path).toBe("M0 0L10 0");
    const second = context.store.get("links", placeIds[1]!)!;
    expect(second).toMatchObject({ x: 100, y: 120, from: IDEAS });
    expect(context.store.get("stamps", second.to)).toMatchObject({ alt: "arrow", path: "M0 0L0 10" });
    context.history.undo();
    expect(context.store.get("stamps", a.stampId)?.path).toBe("M0 0L10 0M0 20L0 30");
    expect(context.store.has("links", placeIds[1]!)).toBe(false);
  });

  it("does nothing for a scribble with one stroke", () => {
    const context = loadTestContext();
    const a = createStampOnBoard(context, { boardId: IDEAS, x: 0, y: 0, w: 10, h: 10, path: "M0 0L10 10" });
    context.history.run(a.command);
    expect(splitStamp(context, a.placeId).command.ops).toEqual([]);
  });
});

describe("closed paths", () => {
  it("reads Z as a line back to the stroke start, and the test star can be split and erased", () => {
    expect(parsePath("M0 0L10 0L10 10Z")).toEqual([
      { command: "M", x: 0, y: 0 },
      { command: "L", x: 10, y: 0 },
      { command: "L", x: 10, y: 10 },
      { command: "L", x: 0, y: 0 },
    ]);
    const context = loadTestContext();
    const star = context.store.get("links", "p5e5e5e5e5e5")!;
    expect(star.kind === "place" && strokesOfPlacement(context, star)).toHaveLength(1);
    context.history.run(eraseStrokes(context, new Map([["p5e5e5e5e5e5", new Set([0])]])));
    expect(context.store.has("links", "p5e5e5e5e5e5")).toBe(false);
  });
});
