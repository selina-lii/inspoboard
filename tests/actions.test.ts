import { describe, expect, it } from "vitest";
import {
  collapseAll,
  createItemOnBoard,
  createRelation,
  createStampOnBoard,
  deleteGhost,
  deleteItem,
  moveIntoBoard,
  reduceBoard,
  removeFromBoard,
  renameItem,
  setCardState,
  setPageAt,
  setItemDate,
  setPlacementExpanded,
  updateRelation,
  writeText,
} from "../src/core/actions";
import { referenceProblems, schemaErrors } from "../src/core/validate";
import { decodeVault, encodeVault } from "../src/core/format";
import type { PlaceLink } from "../src/core/types";
import { DATA_INTEGRITY, IDEAS, loadTestContext, RELATION, ROOT, TOOL_RESEARCH } from "./helpers";

describe("actions", () => {
  it("removes an item from one board and keeps it on the other board", () => {
    const context = loadTestContext();
    context.history.run(removeFromBoard(context, ["p4d4d4d4d4d4"]));
    expect(context.store.has("items", DATA_INTEGRITY)).toBe(true);
    expect(context.graph.parentsOf(DATA_INTEGRITY).map((place) => place.from)).toEqual([IDEAS]);
  });

  it("lists an item on no board as unplaced", () => {
    const context = loadTestContext();
    context.history.run(removeFromBoard(context, ["p1a1a1a1a1a1"]));
    expect(context.graph.unplacedItems(ROOT)).toEqual([TOOL_RESEARCH]);
  });

  it("makes a ghost bridge when it deletes an item, and undo restores the item", () => {
    const context = loadTestContext();
    const body = context.store.get("texts", DATA_INTEGRITY)!.body;
    context.history.run(deleteItem(context, DATA_INTEGRITY));
    expect(context.graph.isGhost(DATA_INTEGRITY)).toBe(true);
    expect(context.graph.relationsTo(DATA_INTEGRITY).map((link) => link.from)).toEqual([IDEAS]);
    expect(context.graph.parentsOf(DATA_INTEGRITY)).toHaveLength(2);
    expect(context.graph.refsTo(DATA_INTEGRITY).map((ref) => ref.from)).toEqual([IDEAS]);
    expect(referenceProblems(context.store, context.graph, ROOT)).toContainEqual(
      expect.objectContaining({ code: "ghost", recordId: DATA_INTEGRITY }),
    );
    context.history.undo();
    expect(context.store.get("texts", DATA_INTEGRITY)?.body).toBe(body);
    expect(context.graph.isGhost(DATA_INTEGRITY)).toBe(false);
  });

  it("deletes all links of a ghost in one command", () => {
    const context = loadTestContext();
    context.history.run(deleteItem(context, DATA_INTEGRITY));
    context.history.run(deleteGhost(context, DATA_INTEGRITY));
    expect(context.graph.parentsOf(DATA_INTEGRITY)).toHaveLength(0);
    expect(context.graph.relationsTo(DATA_INTEGRITY)).toHaveLength(0);
    context.history.undo();
    expect(context.graph.parentsOf(DATA_INTEGRITY)).toHaveLength(2);
  });

  it("refuses to delete a live record as a ghost", () => {
    const context = loadTestContext();
    expect(() => deleteGhost(context, IDEAS)).toThrow();
  });

  it("reroutes a link and removes an empty label", () => {
    const context = loadTestContext();
    const command = updateRelation(context, RELATION, { to: TOOL_RESEARCH, label: "" });
    expect(command.label).toBe("Reroute link");
    context.history.run(command);
    const link = context.store.get("links", RELATION)!;
    expect(link).toMatchObject({ to: TOOL_RESEARCH, group: "design" });
    expect("label" in link).toBe(false);
  });

  it("creates a link between items at different depths", () => {
    const context = loadTestContext();
    const { command, linkId } = createRelation(context, { from: DATA_INTEGRITY, to: ROOT, label: "part of" });
    context.history.run(command);
    expect(context.graph.relationsFrom(DATA_INTEGRITY).map((link) => link.id)).toContain(linkId);
  });

  it("creates a stamp with default alt text", () => {
    const context = loadTestContext();
    const { command, stampId } = createStampOnBoard(context, { boardId: IDEAS, x: 0, y: 0, w: 10, h: 10, path: "M0 0L10 10" });
    context.history.run(command);
    expect(context.store.get("stamps", stampId)?.alt).toBe("scribble");
  });
});

describe("expanded cards", () => {
  it("expands and collapses a card, and the field is absent when collapsed", () => {
    const context = loadTestContext();
    context.history.run(setPlacementExpanded(context, "p2b2b2b2b2b2", true));
    expect(context.store.get("links", "p2b2b2b2b2b2")).toMatchObject({ expanded: true });
    context.history.run(setPlacementExpanded(context, "p2b2b2b2b2b2", false));
    expect("expanded" in context.store.get("links", "p2b2b2b2b2b2")!).toBe(false);
  });
});

describe("timestamps", () => {
  it("sets modified on rename and on a text change, and keeps created", () => {
    const context = loadTestContext();
    context.history.run(renameItem(context, IDEAS, "New name"));
    expect(context.store.get("items", IDEAS)).toMatchObject({ created: "2026-10-07T00:00:00.000Z", modified: "2026-10-07T12:00:00.000Z" });
    writeText(context.store, IDEAS, "changed", "2026-10-08T09:00:00.000Z");
    expect(context.store.get("items", IDEAS)?.modified).toBe("2026-10-08T09:00:00.000Z");
  });

  it("sets and removes the manual date", () => {
    const context = loadTestContext();
    context.history.run(setItemDate(context, IDEAS, " 1998-05 "));
    expect(context.store.get("items", IDEAS)?.date).toBe("1998-05");
    context.history.run(setItemDate(context, IDEAS, ""));
    expect("date" in context.store.get("items", IDEAS)!).toBe(false);
  });
});

describe("link caps and collapse all", () => {
  it("saves only caps that are not the default", () => {
    const context = loadTestContext();
    context.history.run(updateRelation(context, RELATION, { start: "diamond", end: "none" }));
    expect(context.store.get("links", RELATION)).toMatchObject({ start: "diamond", end: "none" });
    context.history.run(updateRelation(context, RELATION, { start: "none", end: "arrow" }));
    const link = context.store.get("links", RELATION)!;
    expect("start" in link || "end" in link).toBe(false);
  });

  it("sets and removes the line color and the dashes of a link", () => {
    const context = loadTestContext();
    context.history.run(updateRelation(context, RELATION, { color: "#ff453a", dashed: true }));
    const link = context.store.get("links", RELATION)!;
    expect(link).toMatchObject({ color: "#ff453a", dashed: true });
    expect(schemaErrors("links", link)).toEqual([]);
    expect(schemaErrors("links", { ...link, color: "red" })).not.toEqual([]);
    context.history.run(updateRelation(context, RELATION, { color: null, dashed: false }));
    const plain = context.store.get("links", RELATION)!;
    expect("color" in plain || "dashed" in plain).toBe(false);
  });

  it("collapses all expanded cards on a board in one command", () => {
    const context = loadTestContext();
    context.history.run(setPlacementExpanded(context, "p1a1a1a1a1a1", true));
    context.history.run(setPlacementExpanded(context, "p2b2b2b2b2b2", true));
    const command = collapseAll(context, ROOT);
    expect(command.ops).toHaveLength(2);
    context.history.run(command);
    expect("expanded" in context.store.get("links", "p1a1a1a1a1a1")!).toBe(false);
    context.history.undo();
    expect(context.store.get("links", "p2b2b2b2b2b2")).toMatchObject({ expanded: true });
  });
});

describe("card state", () => {
  it("cycles a reduced item through note, page, and board", () => {
    const context = loadTestContext();
    // Tool research has no children. Its card on the root is a page.
    context.history.run(setCardState(context, "p1a1a1a1a1a1", "note"));
    expect(context.store.get("links", "p1a1a1a1a1a1")).toMatchObject({ view: "note" });
    context.history.run(setCardState(context, "p1a1a1a1a1a1", "board"));
    expect(context.store.get("items", TOOL_RESEARCH)?.board).toBe(true);
    expect(context.graph.isBoardItem(TOOL_RESEARCH)).toBe(true);
    context.history.run(setCardState(context, "p1a1a1a1a1a1", "page"));
    expect("board" in context.store.get("items", TOOL_RESEARCH)!).toBe(false);
    expect(context.store.get("links", "p1a1a1a1a1a1")).toMatchObject({ view: "page" });
  });

  it("does not change an item with children", () => {
    const context = loadTestContext();
    expect(setCardState(context, "p2b2b2b2b2b2", "note").ops).toEqual([]);
  });

  it("reduces a board with one child: the child moves next to the card", () => {
    const context = loadTestContext();
    // Ideas holds only Data integrity.
    context.history.run(reduceBoard(context, "p2b2b2b2b2b2"));
    expect(context.graph.childrenOf(IDEAS)).toHaveLength(0);
    const onRoot = context.graph.childrenOf(ROOT).filter((place) => place.to === DATA_INTEGRITY);
    expect(onRoot).toHaveLength(2);
    expect(onRoot.some((place) => place.x === 320 + 200 + 40 && place.y === 0)).toBe(true);
    context.history.undo();
    expect(context.graph.childrenOf(IDEAS)).toHaveLength(1);
  });
});

describe("names", () => {
  it("gives a code to a new page without a name and to an item renamed to nothing; a note stays without a name", () => {
    const context = loadTestContext();
    const { command, itemId } = createItemOnBoard(context, { boardId: ROOT, view: "page", x: 0, y: 0 });
    context.history.run(command);
    const pattern = /^(\d{3}|\d{4}|[A-Z]{2}\d{2}|[A-Z]{3})$/;
    expect(context.store.get("items", itemId)).toMatchObject({ name: expect.stringMatching(pattern), codeName: true });
    const note = createItemOnBoard(context, { boardId: ROOT, view: "note", x: 0, y: 0 });
    context.history.run(note.command);
    expect(context.store.get("items", note.itemId)).toMatchObject({ name: "" });
    expect("codeName" in context.store.get("items", note.itemId)!).toBe(false);
    context.history.run(renameItem(context, note.itemId, "Shopping"));
    context.history.run(renameItem(context, note.itemId, " ", { allowEmpty: true }));
    expect(context.store.get("items", note.itemId)?.name).toBe("");
    context.history.run(renameItem(context, IDEAS, "   "));
    expect(context.store.get("items", IDEAS)).toMatchObject({ name: expect.stringMatching(pattern), codeName: true });
    // A typed name removes the code mark, also if it looks like a code.
    context.history.run(renameItem(context, IDEAS, "ABC"));
    expect(context.store.get("items", IDEAS)?.name).toBe("ABC");
    expect("codeName" in context.store.get("items", IDEAS)!).toBe(false);
  });
});

describe("create board", () => {
  it("creates an empty board that opens as a board", () => {
    const context = loadTestContext();
    const { command, itemId } = createItemOnBoard(context, { boardId: ROOT, view: "note", x: 0, y: 0, board: true });
    context.history.run(command);
    expect(context.graph.childrenOf(itemId)).toHaveLength(0);
    expect(context.graph.isBoardItem(itemId)).toBe(true);
  });
});

describe("move into board", () => {
  it("moves cards into a board, keeps their layout and links, and undo moves them back", () => {
    const context = loadTestContext();
    // Move Tool research (0, 0) and the star (600, 40) from the root into Ideas.
    const command = moveIntoBoard(context, ["p1a1a1a1a1a1", "p5e5e5e5e5e5"], IDEAS);
    context.history.run(command);
    const moved = context.graph.childrenOf(IDEAS).filter((place) => place.id !== "p3c3c3c3c3c3");
    expect(moved.map((place) => place.to).sort()).toEqual([TOOL_RESEARCH, "s4h7d2j8f6g3"].sort());
    const tool = context.store.get("links", "p1a1a1a1a1a1")!;
    const star = context.store.get("links", "p5e5e5e5e5e5")!;
    expect(tool.kind === "place" && star.kind === "place" && [star.x - tool.x, star.y - tool.y]).toEqual([600, 40]);
    // Ideas held Data integrity at (0, 0), 200 wide: the group starts at 240.
    expect(tool).toMatchObject({ from: IDEAS, x: 240, y: 0 });
    context.history.undo();
    expect(context.store.get("links", "p1a1a1a1a1a1")).toMatchObject({ from: ROOT, x: 0, y: 0 });
  });

  it("moves an outline row with its child rows as a new outline, and a whole outline as it is", async () => {
    const { createOutline } = await import("../src/core/outline");
    const { makeOp } = await import("../src/core/commands");
    const context = loadTestContext();
    // Root outline: Tool research (p1) with child Data integrity (p4), and the Ideas board (p2) as a top row.
    const made = createOutline(context, ROOT, ["p1a1a1a1a1a1", "p2b2b2b2b2b2", "p4d4d4d4d4d4"]);
    context.history.run(made.command);
    const child = context.store.get("links", "p4d4d4d4d4d4") as PlaceLink;
    context.history.run({ label: "Indent", ops: [makeOp("links", child.id, child, { ...child, parent: "p1a1a1a1a1a1", rank: 0 })] });
    context.history.run(moveIntoBoard(context, ["p1a1a1a1a1a1"], IDEAS));
    const row = context.store.get("links", "p1a1a1a1a1a1") as PlaceLink;
    const moved = context.store.get("links", "p4d4d4d4d4d4") as PlaceLink;
    expect(row).toMatchObject({ from: IDEAS, rank: 0 });
    expect(row.parent).toBeUndefined();
    expect(row.outline).not.toBe(made.outlineId);
    expect(moved).toMatchObject({ from: IDEAS, outline: row.outline, parent: "p1a1a1a1a1a1" });
    expect(context.store.get("outlines", row.outline!)).toMatchObject({ board: IDEAS });
    expect(context.store.get("links", "p2b2b2b2b2b2")).toMatchObject({ from: ROOT, outline: made.outlineId });
    // Undo, then move the whole outline (its frame) into a new board: the outline record moves.
    context.history.undo();
    const target = context.store.get("links", "p2b2b2b2b2b2") as PlaceLink;
    context.history.run({ label: "Out", ops: [makeOp("links", target.id, target, { ...target, outline: undefined, parent: undefined, rank: undefined })] });
    context.history.run(moveIntoBoard(context, [], IDEAS, [made.outlineId!]));
    expect(context.store.get("outlines", made.outlineId!)).toMatchObject({ board: IDEAS });
    expect(context.store.get("links", "p4d4d4d4d4d4")).toMatchObject({ from: IDEAS, outline: made.outlineId, parent: "p1a1a1a1a1a1" });
    expect(context.graph.membersOf(made.outlineId!).map((place) => place.id).sort()).toEqual(["p1a1a1a1a1a1", "p4d4d4d4d4d4"]);
  });

  it("does not move a board into itself", () => {
    const context = loadTestContext();
    expect(moveIntoBoard(context, ["p2b2b2b2b2b2"], IDEAS).ops).toEqual([]);
  });
});

describe("backgrounds and card colors", () => {
  it("sets and removes a board background and card colors, with checks on the values", async () => {
    const { setBoardBackground, setCardColor } = await import("../src/core/actions");
    const { schemaErrors } = await import("../src/core/validate");
    const { readSettings } = await import("../src/io/settings");
    const context = loadTestContext();
    context.history.run(setBoardBackground(context, ROOT, "images/sky-01.png"));
    expect(context.store.get("items", ROOT)?.background).toBe("images/sky-01.png");
    context.history.run(setBoardBackground(context, ROOT, null));
    expect("background" in context.store.get("items", ROOT)!).toBe(false);
    context.history.run(setCardColor(context, ["p1a1a1a1a1a1"], "#ff453a"));
    expect(context.store.get("links", "p1a1a1a1a1a1")).toMatchObject({ color: "#ff453a" });
    context.history.undo();
    expect("color" in context.store.get("links", "p1a1a1a1a1a1")!).toBe(false);

    const item = { id: "a1b2c3d4e5f6", name: "x", created: "2024-01-01" };
    expect(schemaErrors("items", { ...item, background: "#1c1c1e" })).toEqual([]);
    expect(schemaErrors("items", { ...item, background: "images/../vault.json" })).not.toEqual([]);
    expect(schemaErrors("items", { ...item, background: "/etc/passwd.png" })).not.toEqual([]);
    expect(readSettings('{"defaultBackground":"images/a.webp"}').defaultBackground).toBe("images/a.webp");
    expect(readSettings('{"defaultBackground":"javascript:x"}').defaultBackground).toBeNull();
  });

  it("a background on the board: the field turns on and off (one undo step); its box holds all the cards", async () => {
    const { setBoardBackground, setBackgroundOnBoard, backgroundBox, cardsArea } = await import("../src/core/actions");
    const { schemaErrors } = await import("../src/core/validate");
    const context = loadTestContext();
    context.history.run(setBoardBackground(context, ROOT, "images/cork.jpg"));
    context.history.run(setBackgroundOnBoard(context, ROOT, true));
    expect(context.store.get("items", ROOT)?.backgroundOnBoard).toBe(true);
    expect(schemaErrors("items", context.store.get("items", ROOT)!)).toEqual([]);
    expect(setBackgroundOnBoard(context, ROOT, true).ops).toEqual([]);
    const area = cardsArea(context, ROOT);
    const box = backgroundBox(context, ROOT, 0.7);
    expect(box.x).toBeLessThanOrEqual(area.x);
    expect(box.y).toBeLessThanOrEqual(area.y);
    expect(box.x + box.w).toBeGreaterThanOrEqual(area.x + area.w);
    expect(box.y + box.h).toBeGreaterThanOrEqual(area.y + area.h);
    expect(box.h / box.w).toBeCloseTo(0.7);
    context.history.undo();
    expect("backgroundOnBoard" in context.store.get("items", ROOT)!).toBe(false);
    expect(schemaErrors("items", { id: "a1b2c3d4e5f6", name: "x", created: "2024-01-01", backgroundOnBoard: false })).not.toEqual([]);
  });
});

describe("small items in a page", () => {
  it("saves the place of a comment in its page as an optional pageAt; null puts it back; old comments stay as they are", () => {
    const context = loadTestContext();
    const { command, itemId } = createItemOnBoard(context, { boardId: ROOT, view: "comment", x: 0, y: 0, on: TOOL_RESEARCH, author: "Me" });
    context.history.run(command);
    const before = context.store.get("items", itemId)!;
    expect(before).not.toHaveProperty("pageAt");
    context.history.run(setPageAt(context, itemId, [12.4, -30.6]));
    expect(context.store.get("items", itemId)!.pageAt).toEqual([12, -31]);
    expect(schemaErrors("items", context.store.get("items", itemId))).toEqual([]);
    expect(schemaErrors("items", { ...before, pageAt: [1] })).toHaveLength(1);
    const reloaded = decodeVault(encodeVault(context.store, { format: 2, root: ROOT }));
    expect(reloaded.problems.filter((problem) => problem.severity === "error")).toEqual([]);
    expect(reloaded.store.get("items", itemId)!.pageAt).toEqual([12, -31]);
    context.history.run(setPageAt(context, itemId, null));
    expect(context.store.get("items", itemId)).toEqual(before);
    context.history.undo();
    expect(context.store.get("items", itemId)!.pageAt).toEqual([12, -31]);
  });
});

describe("page subtitle", () => {
  it("sets and removes a subtitle; it is saved, found, exported, and makes a folded card taller", async () => {
    const { setItemSubtitle } = await import("../src/core/actions");
    const { searchBoard } = await import("../src/core/search");
    const { linearize } = await import("../src/core/linearize");
    const { cardHeight, COLLAPSED_HEIGHT, SUBTITLE_HEIGHT } = await import("../src/ui/board/boardModel");
    const context = loadTestContext();
    context.history.run(setItemSubtitle(context, TOOL_RESEARCH, "  notes   from *2024* "));
    expect(context.store.get("items", TOOL_RESEARCH)?.subtitle).toBe("notes from *2024*");
    expect(setItemSubtitle(context, TOOL_RESEARCH, "notes from *2024*").ops).toEqual([]);
    const { store, problems } = decodeVault(encodeVault(context.store, { format: 2, root: ROOT }));
    expect(problems.filter((problem) => problem.severity === "error")).toEqual([]);
    expect(store.get("items", TOOL_RESEARCH)?.subtitle).toBe("notes from *2024*");
    expect(searchBoard(context.store, context.graph, ROOT, "notes from")).toContainEqual(expect.objectContaining({ recordId: TOOL_RESEARCH, field: "subtitle" }));
    expect(linearize(context.store, context.graph, ROOT)).toContain("*notes from \\*2024\\**");
    const place = context.store.get("links", "p1a1a1a1a1a1") as PlaceLink;
    expect(cardHeight(context.store, context.graph, place)).toBe(COLLAPSED_HEIGHT + SUBTITLE_HEIGHT);
    context.history.run(setItemSubtitle(context, TOOL_RESEARCH, " "));
    expect(context.store.get("items", TOOL_RESEARCH)?.subtitle).toBeUndefined();
    expect(cardHeight(context.store, context.graph, place)).toBe(COLLAPSED_HEIGHT);
  });
});
