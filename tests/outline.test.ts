import { describe, expect, it } from "vitest";
import { removeFromBoard } from "../src/core/actions";
import { linearize } from "../src/core/linearize";
import {
  boardOrder,
  createOutline,
  indentRow,
  moveOutline,
  moveRow,
  moveRowTo,
  moveRowToEnd,
  neighbors,
  outdentRow,
  OUTLINE_GAP,
  OUTLINE_INDENT,
  outlineLayout,
  outlineRows,
  parentPairs,
  removeFromOutline,
  sequencePairs,
  setOutlineDirection,
  setOutlineList,
  setOutlineWidth,
} from "../src/core/outline";
import { createOutlineWithPage } from "../src/core/actions";
import { DATA_INTEGRITY, IDEAS, loadTestContext, ROOT, TOOL_RESEARCH } from "./helpers";

// Root board: Tool research (0,0), Ideas (320,0), a star scribble, Data integrity (320,240).
const TOOL_PLACE = "p1a1a1a1a1a1";
const IDEAS_PLACE = "p2b2b2b2b2b2";
const STAR_PLACE = "p5e5e5e5e5e5";
const INTEGRITY_ON_ROOT = "p4d4d4d4d4d4";
const heightOf = (place: { h: number }) => place.h;

function withOutline() {
  const context = loadTestContext();
  const { command, outlineId } = createOutline(context, ROOT, [IDEAS_PLACE, INTEGRITY_ON_ROOT, TOOL_PLACE, STAR_PLACE]);
  context.history.run(command);
  return { context, outlineId: outlineId! };
}

describe("outline", () => {
  it("makes an outline from cards in reading order, without scribbles", () => {
    const { context, outlineId } = withOutline();
    const rows = outlineRows(context.store, context.graph, outlineId);
    expect(rows.map((row) => row.recordId)).toEqual([TOOL_RESEARCH, IDEAS, DATA_INTEGRITY]);
    expect(context.store.get("outlines", outlineId)).toMatchObject({ board: ROOT, x: 0, y: 0 });
    expect(context.store.get("links", STAR_PLACE)).not.toHaveProperty("outline");
  });

  it("lays rows out aligned, with equal space; a tall card pushes the rows below it", () => {
    const { context, outlineId } = withOutline();
    const outline = context.store.get("outlines", outlineId)!;
    const rows = outlineRows(context.store, context.graph, outlineId);
    const short = outlineLayout(outline, rows, context.store, () => 40);
    expect([...short.values()]).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 40 + OUTLINE_GAP },
      { x: 0, y: 80 + 2 * OUTLINE_GAP },
    ]);
    const tallFirst = outlineLayout(outline, rows, context.store, (place) => (place.id === TOOL_PLACE ? 300 : 40));
    expect(tallFirst.get(IDEAS_PLACE)).toEqual({ x: 0, y: 300 + OUTLINE_GAP });
  });

  it("changes the outline width: rows end at the new right edge, child rows less their indent; undo restores", () => {
    const { context, outlineId } = withOutline();
    context.history.run(indentRow(context, IDEAS_PLACE));
    const widths = () => [TOOL_PLACE, IDEAS_PLACE, INTEGRITY_ON_ROOT].map((id) => (context.store.get("links", id) as { w: number }).w);
    const before = widths();
    context.history.run(setOutlineWidth(context, outlineId, 300, 500));
    expect(widths()).toEqual([500, 500 - OUTLINE_INDENT, 500]);
    context.history.undo();
    expect(widths()).toEqual(before);
  });

  it("moves, indents, and outdents rows; lines and numbers follow", () => {
    const { context, outlineId } = withOutline();
    context.history.run(setOutlineList(context, outlineId, "numbers"));
    context.history.run(indentRow(context, IDEAS_PLACE));
    let rows = outlineRows(context.store, context.graph, outlineId);
    expect(rows.map((row) => [row.placeId, row.depth, row.marker])).toEqual([
      [TOOL_PLACE, 0, "1"],
      [IDEAS_PLACE, 1, "1.1"],
      [INTEGRITY_ON_ROOT, 0, "2"],
    ]);
    expect(sequencePairs(rows)).toEqual([[TOOL_PLACE, INTEGRITY_ON_ROOT]]);
    expect(parentPairs(rows)).toEqual([[TOOL_PLACE, IDEAS_PLACE]]);
    const outline = context.store.get("outlines", outlineId)!;
    expect(outlineLayout(outline, rows, context.store, heightOf).get(IDEAS_PLACE)?.x).toBe(OUTLINE_INDENT);

    context.history.run(outdentRow(context, IDEAS_PLACE));
    context.history.run(moveRow(context, IDEAS_PLACE, 1));
    rows = outlineRows(context.store, context.graph, outlineId);
    expect(rows.map((row) => row.placeId)).toEqual([TOOL_PLACE, INTEGRITY_ON_ROOT, IDEAS_PLACE]);
    expect(moveRow(context, IDEAS_PLACE, 1).ops).toEqual([]);
  });

  it("takes rows out where they show; an empty outline goes away; undo brings it back", () => {
    const { context, outlineId } = withOutline();
    context.history.run(indentRow(context, IDEAS_PLACE));
    context.history.run(moveOutline(context, outlineId, 100, 50));
    context.history.run(removeFromOutline(context, [TOOL_PLACE], heightOf));
    expect(context.store.get("links", TOOL_PLACE)).toMatchObject({ x: 100, y: 50 });
    expect(context.store.get("links", TOOL_PLACE)).not.toHaveProperty("outline");
    // The child of the removed row moves up.
    expect(outlineRows(context.store, context.graph, outlineId).map((row) => [row.placeId, row.depth])).toEqual([
      [IDEAS_PLACE, 0],
      [INTEGRITY_ON_ROOT, 0],
    ]);
    context.history.run(removeFromOutline(context, [IDEAS_PLACE, INTEGRITY_ON_ROOT], heightOf));
    expect(context.store.has("outlines", outlineId)).toBe(false);
    context.history.undo();
    expect(context.store.has("outlines", outlineId)).toBe(true);
  });

  it("deletes the outline when its last cards leave the board", () => {
    const { context, outlineId } = withOutline();
    context.history.run(removeFromBoard(context, [TOOL_PLACE, IDEAS_PLACE, INTEGRITY_ON_ROOT]));
    expect(context.store.has("outlines", outlineId)).toBe(false);
  });

  it("adds cards to the outline of a selected card", () => {
    const context = loadTestContext();
    const first = createOutline(context, ROOT, [TOOL_PLACE]);
    context.history.run(first.command);
    const second = createOutline(context, ROOT, [TOOL_PLACE, IDEAS_PLACE]);
    expect(second.outlineId).toBe(first.outlineId);
    context.history.run(second.command);
    expect(outlineRows(context.store, context.graph, first.outlineId!).map((row) => row.placeId)).toEqual([TOOL_PLACE, IDEAS_PLACE]);
  });

  it("orders the board with the outline as one block, and exports numbered headings", () => {
    const { context, outlineId } = withOutline();
    context.history.run(setOutlineList(context, outlineId, "numbers"));
    expect(boardOrder(context.store, context.graph, ROOT).map(({ place }) => place.id)).toEqual([TOOL_PLACE, IDEAS_PLACE, INTEGRITY_ON_ROOT, STAR_PLACE]);
    expect(neighbors(context.store, context.graph, ROOT, IDEAS)).toEqual({ previous: TOOL_RESEARCH, next: DATA_INTEGRITY });
    const text = linearize(context.store, context.graph, ROOT);
    expect(text).toContain("## 1 Tool research");
    expect(text).toContain("## 2 Ideas");
  });

  it("moves rows to the front, the back, and before or after a row; never into their own child rows", () => {
    const { context, outlineId } = withOutline();
    const order = () => outlineRows(context.store, context.graph, outlineId).map((row) => row.placeId);
    context.history.run(moveRowToEnd(context, INTEGRITY_ON_ROOT, "front"));
    expect(order()).toEqual([INTEGRITY_ON_ROOT, TOOL_PLACE, IDEAS_PLACE]);
    context.history.run(moveRowToEnd(context, INTEGRITY_ON_ROOT, "back"));
    expect(order()).toEqual([TOOL_PLACE, IDEAS_PLACE, INTEGRITY_ON_ROOT]);
    context.history.run(indentRow(context, IDEAS_PLACE));
    context.history.run(moveRowTo(context, INTEGRITY_ON_ROOT, IDEAS_PLACE, "before"));
    const rows = outlineRows(context.store, context.graph, outlineId);
    expect(rows.map((row) => [row.placeId, row.depth])).toEqual([
      [TOOL_PLACE, 0],
      [INTEGRITY_ON_ROOT, 1],
      [IDEAS_PLACE, 1],
    ]);
    expect(moveRowTo(context, TOOL_PLACE, IDEAS_PLACE, "after").ops).toEqual([]);
  });

  it("lays a horizontal outline out in columns; child rows go down under their top row", () => {
    const { context, outlineId } = withOutline();
    context.history.run(indentRow(context, IDEAS_PLACE));
    context.history.run(setOutlineDirection(context, outlineId, "horizontal"));
    const outline = context.store.get("outlines", outlineId)!;
    const positions = outlineLayout(outline, outlineRows(context.store, context.graph, outlineId), context.store, () => 40);
    const tool = positions.get(TOOL_PLACE)!;
    const ideas = positions.get(IDEAS_PLACE)!;
    const integrity = positions.get(INTEGRITY_ON_ROOT)!;
    expect(ideas.y).toBe(tool.y + 40 + OUTLINE_GAP);
    expect(integrity.y).toBe(tool.y);
    expect(integrity.x).toBeGreaterThan(ideas.x);
  });

  it("makes a new outline with one new page", () => {
    const context = loadTestContext();
    const { command, outlineId, placeId } = createOutlineWithPage(context, ROOT, 500, 500);
    context.history.run(command);
    expect(outlineRows(context.store, context.graph, outlineId).map((row) => row.placeId)).toEqual([placeId]);
  });
});
