import { describe, expect, it } from "vitest";
import { createItemOnBoard, defaultQuoteMarks, renameItem, setQuoteMarks, writeText } from "../src/core/actions";
import { linearize } from "../src/core/linearize";
import { schemaErrors } from "../src/core/validate";
import { quoteStart } from "../src/ui/board/objectCards";
import { loadTestContext, ROOT } from "./helpers";

describe("quote cards", () => {
  it("are slim, open, and without a name; their marks change and undo", () => {
    const context = loadTestContext();
    const { command, itemId, placeId } = createItemOnBoard(context, { boardId: ROOT, view: "quote", x: 0, y: 0 });
    context.history.run(command);
    expect(context.store.get("items", itemId)?.name).toBe("");
    expect(context.store.get("links", placeId)).toMatchObject({ view: "quote", w: 320, h: 72, expanded: true });
    expect("marks" in context.store.get("links", placeId)!).toBe(false);
    context.history.run(setQuoteMarks(context, placeId, "cjk"));
    expect(context.store.get("links", placeId)).toMatchObject({ marks: "cjk" });
    context.history.undo();
    expect("marks" in context.store.get("links", placeId)!).toBe(false);
  });

  it("get marks from their text when they have none", () => {
    expect(defaultQuoteMarks("學而時習之")).toBe("cjk");
    expect(defaultQuoteMarks("A room of one's own")).toBe("en");
    expect(defaultQuoteMarks("")).toBe("en");
  });

  it("accept only known marks in the data", () => {
    const place = { id: "aaaaaaaaaaaa", kind: "place", from: "bbbbbbbbbbbb", to: "cccccccccccc", view: "quote", x: 0, y: 0, w: 320, h: 72 };
    expect(schemaErrors("links", { ...place, marks: "es" })).toEqual([]);
    expect(schemaErrors("links", { ...place, marks: "fr" })).not.toEqual([]);
  });

  it("export as Markdown quotes, with the source if there is one", () => {
    const context = loadTestContext();
    const { command, itemId } = createItemOnBoard(context, { boardId: ROOT, view: "quote", x: 0, y: 0 });
    context.history.run(command);
    writeText(context.store, itemId, "Caminante, no hay camino,\nse hace camino al andar.");
    expect(linearize(context.store, context.graph, ROOT)).toContain("> Caminante, no hay camino,\n> se hace camino al andar.");
    context.history.run(renameItem(context, itemId, "Antonio Machado", { allowEmpty: true }));
    expect(linearize(context.store, context.graph, ROOT)).toContain("> se hace camino al andar.\n> — Antonio Machado");
  });

  it("fold to the first two words, or two CJK characters", () => {
    expect(quoteStart("Simplicity is prerequisite for reliability.")).toBe("Simplicity is…");
    expect(quoteStart("路漫漫其修远兮")).toBe("路漫…");
    expect(quoteStart("Hello")).toBe("Hello");
  });
});
