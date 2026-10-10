import { describe, expect, it } from "vitest";
import { createItemOnBoard, createRelation, deleteItem, setResolved } from "../src/core/actions";
import { buildBoardModel, PARALLEL_GAP, previewOf } from "../src/ui/board/boardModel";
import { DATA_INTEGRITY, IDEAS, loadTestContext, RELATION, ROOT, STAR_STAMP, TOOL_RESEARCH } from "./helpers";

describe("board model", () => {
  it("shows the placements of the root board", () => {
    const context = loadTestContext();
    const model = buildBoardModel(context.store, context.graph, ROOT);
    const placed = model.nodes.filter((node) => node.kind !== "stub");
    expect(placed.map((node) => node.recordId).sort()).toEqual([DATA_INTEGRITY, TOOL_RESEARCH, IDEAS, STAR_STAMP].sort());
    expect(placed.find((node) => node.recordId === STAR_STAMP)?.kind).toBe("stamp");
    expect(placed.find((node) => node.recordId === IDEAS)?.childCount).toBe(1);
  });

  it("draws a relation between placed items, and no line for inline references in text", () => {
    const context = loadTestContext();
    const model = buildBoardModel(context.store, context.graph, ROOT);
    expect(model.edges.find((edge) => edge.id === RELATION)).toMatchObject({ kind: "relation", label: "depends on" });
    expect(model.edges.map((edge) => edge.kind)).toEqual(["relation"]);
    const pairs = model.edges.map((edge) => `${edge.source}>${edge.target}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(model.nodes.some((node) => node.kind === "stub")).toBe(false);
  });

  it("shows a stub when the other end is not on the board", () => {
    const context = loadTestContext();
    context.history.run(createRelation(context, { from: DATA_INTEGRITY, to: TOOL_RESEARCH }).command);
    const model = buildBoardModel(context.store, context.graph, IDEAS);
    const stub = model.nodes.find((node) => node.kind === "stub");
    expect(stub).toMatchObject({ recordId: TOOL_RESEARCH, title: "Tool research" });
    expect(model.edges.find((edge) => edge.target === stub!.id)).toBeDefined();
  });

  it("shows a deleted item as a ghost that keeps its links", () => {
    const context = loadTestContext();
    context.history.run(deleteItem(context, DATA_INTEGRITY));
    const model = buildBoardModel(context.store, context.graph, ROOT);
    const ghost = model.nodes.find((node) => node.recordId === DATA_INTEGRITY)!;
    expect(ghost.kind).toBe("ghost");
    expect(model.edges.find((edge) => edge.id === RELATION)?.target).toBe(ghost.id);
  });

  it("makes a short plain preview", () => {
    expect(previewOf("# Title\nSee [x](item:aaaaaaaaaaaa) and ![cat](assets/c.png)")).toBe("Title\nSee x and [cat]");
  });
});

describe("board model: links to the board itself", () => {
  it("shows no stub for a link from the board item to a child", () => {
    const context = loadTestContext();
    // Ideas -> Data integrity. Data integrity is on the Ideas board.
    const model = buildBoardModel(context.store, context.graph, IDEAS);
    expect(model.nodes.filter((node) => node.kind === "stub")).toEqual([]);
    expect(model.edges.find((edge) => edge.id === RELATION)).toBeUndefined();
  });
});

describe("board model: overlapping lines", () => {
  it("draws no reference line on a pair with a relation in the other direction, and spreads parallel relations", () => {
    const context = loadTestContext();
    // Ideas refers to Tool research in its text. Two relations go the other way: Tool research -> Ideas.
    context.history.run(createRelation(context, { from: TOOL_RESEARCH, to: IDEAS }).command);
    context.history.run(createRelation(context, { from: TOOL_RESEARCH, to: IDEAS, label: "label" }).command);
    const model = buildBoardModel(context.store, context.graph, ROOT);
    const between = model.edges.filter((edge) => [edge.source, edge.target].sort().join() === ["p1a1a1a1a1a1", "p2b2b2b2b2b2"].sort().join());
    expect(between.map((edge) => edge.kind)).toEqual(["relation", "relation"]);
    expect(between.map((edge) => edge.offset).sort()).toEqual([-PARALLEL_GAP / 2, PARALLEL_GAP / 2]);
  });
});

describe("board model: outline", () => {
  it("shows an outline frame, aligned rows, plain lines between rows, and an arrow to a child row", async () => {
    const { createOutline, indentRow } = await import("../src/core/outline");
    const context = loadTestContext();
    const { command, outlineId } = createOutline(context, ROOT, ["p1a1a1a1a1a1", "p2b2b2b2b2b2", "p4d4d4d4d4d4"]);
    context.history.run(command);
    context.history.run(indentRow(context, "p4d4d4d4d4d4"));
    const model = buildBoardModel(context.store, context.graph, ROOT);
    const frame = model.nodes.find((node) => node.kind === "outline")!;
    expect(frame.outlineId).toBe(outlineId);
    expect(model.nodes.indexOf(frame)).toBe(0);
    const rows = model.nodes.filter((node) => node.frameId === frame.id);
    expect(rows.map((node) => node.x)).toEqual([0, 0, 32]);
    const outlineEdges = model.edges.filter((edge) => edge.kind !== "relation").map((edge) => [edge.kind, edge.source, edge.target, edge.end]);
    // Ideas -> Data integrity has a relation already: no outline line on that pair.
    expect(outlineEdges).toEqual([["sequence", "p1a1a1a1a1a1", "p2b2b2b2b2b2", "none"]]);
  });
});

describe("a page holds its small items", () => {
  it("shows the comments and notes of a page in the page only; the page card counts open comments", () => {
    const context = loadTestContext();
    const comment = createItemOnBoard(context, { boardId: ROOT, view: "comment", x: 300, y: 0, on: TOOL_RESEARCH, author: "Me" });
    const note = createItemOnBoard(context, { boardId: ROOT, view: "note", x: 300, y: 200, on: TOOL_RESEARCH });
    context.history.run(comment.command);
    context.history.run(note.command);
    const model = buildBoardModel(context.store, context.graph, ROOT);
    const ids = model.nodes.map((node) => node.id);
    expect(ids).not.toContain(comment.placeId);
    expect(ids).not.toContain(note.placeId);
    expect(model.edges.some((edge) => edge.source === comment.placeId || edge.target === comment.placeId)).toBe(false);
    expect(model.nodes.find((node) => node.recordId === TOOL_RESEARCH)!.openComments).toBe(1);
    // The records and their placements stay in the data.
    expect(context.store.get("links", comment.placeId)).toBeDefined();
    context.history.run(setResolved(context, comment.itemId, true));
    expect(buildBoardModel(context.store, context.graph, ROOT).nodes.find((node) => node.recordId === TOOL_RESEARCH)!.openComments).toBe(0);
  });
});
