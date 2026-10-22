import { describe, expect, it } from "vitest";
import { itemsOfKind } from "../src/core/byKind";
import { createItemOnBoard } from "../src/core/actions";
import { createInside } from "../src/core/inside";
import { readSettings } from "../src/io/settings";
import { loadTestContext, ROOT } from "./helpers";

describe("items by type", () => {
  it("lists the cards of a kind and the small items in pages, each item one time", () => {
    const context = loadTestContext();
    const before = itemsOfKind(context.store, context.graph, "quote").length;
    const page = createItemOnBoard(context, { boardId: ROOT, view: "page", x: 0, y: 0, name: "Host" });
    context.history.run(page.command);
    const card = createItemOnBoard(context, { boardId: ROOT, view: "quote", x: 300, y: 0, body: "On the board" });
    context.history.run(card.command);
    const inside = createInside(context, { homeId: page.itemId, view: "quote", at: null, body: "In the page" });
    context.history.run(inside.command);
    const quotes = itemsOfKind(context.store, context.graph, "quote");
    expect(quotes.length).toBe(before + 2);
    expect(quotes.find((entry) => entry.item.id === card.itemId)).toMatchObject({ boardId: ROOT, cardId: card.itemId });
    // A small item goes to its page.
    expect(quotes.find((entry) => entry.item.id === inside.itemId)).toMatchObject({ boardId: ROOT, cardId: page.itemId });
    expect(itemsOfKind(context.store, context.graph, "flashcard").some((entry) => entry.item.id === card.itemId)).toBe(false);
  });

  it("keeps the chosen type in the settings (default: action items)", () => {
    expect(readSettings(undefined).listKind).toBe("todo");
    expect(readSettings(JSON.stringify({ listKind: "media" })).listKind).toBe("media");
    expect(readSettings(JSON.stringify({ listKind: "nothing" })).listKind).toBe("todo");
  });
});
