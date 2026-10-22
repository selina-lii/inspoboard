import { describe, expect, it } from "vitest";
import { copyCards, pasteCards } from "../src/core/clipboard";
import { createItemOnBoard, createReply } from "../src/core/actions";
import { createInside } from "../src/core/inside";
import { DATA_INTEGRITY, IDEAS, loadTestContext, ROOT, TOOL_RESEARCH } from "./helpers";

describe("copy and paste of cards", () => {
  it("copies small items and pages, not boards or scribbles", () => {
    const context = loadTestContext();
    // p1: a page, p4: a note, p2: a board (it has a card on it), p5: a scribble.
    const cards = copyCards(context, ["p1a1a1a1a1a1", "p4d4d4d4d4d4", "p2b2b2b2b2b2", "p5e5e5e5e5e5"]);
    expect(cards.map((card) => card.item.id)).toEqual([TOOL_RESEARCH, DATA_INTEGRITY]);
  });

  it("pastes new items with the same name, text, and card, in one undo", () => {
    const context = loadTestContext();
    const cards = copyCards(context, ["p1a1a1a1a1a1", "p4d4d4d4d4d4"]);
    const { command, placeIds } = pasteCards(context, cards, IDEAS, { x: 1000, y: 500 });
    context.history.run(command);
    const places = placeIds.map((id) => context.store.get("links", id)!);
    const [page, note] = places.map((place) => (place.kind === "place" ? place : null));
    expect(page).toMatchObject({ from: IDEAS, view: "page", x: 1000, y: 500, w: 240, h: 320 });
    // The cards keep their places to each other.
    expect(note).toMatchObject({ view: "note", x: 1320, y: 740 });
    expect(page!.to).not.toBe(TOOL_RESEARCH);
    expect(context.store.get("items", page!.to)!.name).toBe(context.store.get("items", TOOL_RESEARCH)!.name);
    expect(context.store.get("texts", note!.to)!.body).toBe(context.store.get("texts", DATA_INTEGRITY)!.body);
    // A later change of the copy does not change the original.
    expect(context.store.get("texts", note!.to)).not.toBe(context.store.get("texts", DATA_INTEGRITY));
    context.history.undo();
    expect(placeIds.every((id) => !context.store.has("links", id))).toBe(true);
    expect(context.store.has("items", page!.to)).toBe(false);
  });

  it("makes a text link to a relation link plain text, keeps item links, and drops attachment fields", () => {
    const context = loadTestContext();
    const created = createItemOnBoard(context, { boardId: ROOT, view: "comment", x: 0, y: 0, body: "See [this](link:l5t8r2k9m3q6) and [that](item:k3f9a2m7q1xz).", on: TOOL_RESEARCH, quote: "x", author: "Bo" });
    context.history.run(created.command);
    const cards = copyCards(context, [created.placeId]);
    const { command, placeIds } = pasteCards(context, cards, ROOT, { x: 0, y: 0 });
    context.history.run(command);
    const place = context.store.get("links", placeIds[0]!)!;
    const copyId = place.kind === "place" ? place.to : "";
    expect(context.store.get("texts", copyId)!.body).toBe("See this and [that](item:k3f9a2m7q1xz).");
    const item = context.store.get("items", copyId)!;
    expect(item.author).toBe("Bo");
    expect(item.on).toBeUndefined();
    expect(item.quote).toBeUndefined();
  });

  it("copies a page with the small items inside it and their replies", () => {
    const context = loadTestContext();
    const comment = createInside(context, { homeId: TOOL_RESEARCH, view: "comment", at: null, body: "Why?", author: "Bo", quote: "x" });
    context.history.run(comment.command);
    const reply = createReply(context, comment.itemId, "Al", "Because.");
    context.history.run(reply.command);
    const { command, placeIds } = pasteCards(context, copyCards(context, ["p1a1a1a1a1a1"]), IDEAS, { x: 0, y: 0 });
    context.history.run(command);
    const place = context.store.get("links", placeIds[0]!)!;
    const pageId = place.kind === "place" ? place.to : "";
    const inside = context.graph.insideOf(pageId);
    expect(inside).toHaveLength(1);
    expect(inside[0]).toMatchObject({ view: "comment", quote: "x" });
    expect(inside[0]!.to).not.toBe(comment.itemId);
    expect(context.store.get("texts", inside[0]!.to)!.body).toBe("Why?");
    const replies = context.graph.attachedTo(inside[0]!.to);
    expect(replies.map((item) => context.store.get("texts", item.id)!.body)).toEqual(["Because."]);
    // The original keeps its own items.
    expect(context.graph.insideOf(TOOL_RESEARCH).map((link) => link.to)).toEqual([comment.itemId]);
  });
});
