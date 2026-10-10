import { describe, expect, it } from "vitest";
import { createItemOnBoard } from "../src/core/actions";
import { findDuplicates, firstSentence } from "../src/core/duplicates";
import { loadTestContext, ROOT } from "./helpers";

describe("duplicate check", () => {
  it("takes the first sentence without Markdown marks; short ones do not count", () => {
    expect(firstSentence("# The quick brown fox jumps over the dog. More text.")).toBe("The quick brown fox jumps over the dog.");
    expect(firstSentence("\n\n- A list item that is long enough to count here\nnext")).toBe("A list item that is long enough to count here");
    expect(firstSentence("Hi there.")).toBeNull();
    expect(firstSentence("这是一个足够长的中文句子。后面")).toBe("这是一个足够长的中文句子。");
  });

  it("finds other items with the same first sentence", () => {
    const context = loadTestContext();
    const text = "Interviews show that users want offline notes. Second sentence.";
    const first = createItemOnBoard(context, { boardId: ROOT, view: "page", x: 0, y: 0, body: `Intro line that is long enough.\n${text}` });
    const second = createItemOnBoard(context, { boardId: ROOT, view: "page", x: 0, y: 0, body: text });
    context.history.run(first.command);
    context.history.run(second.command);
    expect(findDuplicates(context.store, second.itemId, text)).toEqual([first.itemId]);
    expect(findDuplicates(context.store, second.itemId, "Short.")).toEqual([]);
  });
});

describe("replace item texts", () => {
  it("changes names and texts in one command; code names stay; undo restores", async () => {
    const { replaceItemTexts } = await import("../src/core/actions");
    const context = loadTestContext();
    const page = createItemOnBoard(context, { boardId: ROOT, view: "page", x: 0, y: 0, name: "简体", body: "汉字" });
    const coded = createItemOnBoard(context, { boardId: ROOT, view: "page", x: 0, y: 0, body: "头发" });
    context.history.run(page.command);
    context.history.run(coded.command);
    const codeName = context.store.get("items", coded.itemId)!.name;
    const command = replaceItemTexts(context, [{ id: page.itemId, name: "簡體", body: "漢字" }, { id: coded.itemId, name: "x", body: "頭髮" }], "Convert");
    context.history.run(command);
    expect(context.store.get("items", page.itemId)!.name).toBe("簡體");
    expect(context.store.get("texts", page.itemId)!.body).toBe("漢字");
    expect(context.store.get("items", coded.itemId)!.name).toBe(codeName);
    expect(context.store.get("texts", coded.itemId)!.body).toBe("頭髮");
    context.history.undo();
    expect(context.store.get("texts", page.itemId)!.body).toBe("汉字");
    expect(context.store.get("items", page.itemId)!.name).toBe("简体");
  });
});
