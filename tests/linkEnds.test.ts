import { describe, expect, it } from "vitest";
import { linkEnds, passageRange } from "../src/core/linkEnds";
import { decodeVault, encodeVault } from "../src/core/format";
import { DATA_INTEGRITY, IDEAS, loadTestContext, ROOT, TOOL_RESEARCH } from "./helpers";

describe("link ends (link bench)", () => {
  it("links two items, one undo removes it", () => {
    const context = loadTestContext();
    const { command, linkId } = linkEnds(context, { itemId: TOOL_RESEARCH }, { itemId: IDEAS });
    context.history.run(command);
    expect(context.store.get("links", linkId)).toMatchObject({ kind: "link", from: TOOL_RESEARCH, to: IDEAS });
    context.history.undo();
    expect(context.store.has("links", linkId)).toBe(false);
  });

  it("puts a text link around a source passage and keeps the target passage", () => {
    const context = loadTestContext();
    const body = context.store.get("texts", DATA_INTEGRITY)!.body;
    const word = body.split(/\s+/).find((candidate) => /^[A-Za-z]{5,}$/.test(candidate) && body.indexOf(candidate) === body.lastIndexOf(candidate))!;
    const from = body.indexOf(word);
    const { command, linkId } = linkEnds(context, { itemId: DATA_INTEGRITY, quote: word, range: { from, to: from + word.length } }, { itemId: IDEAS, quote: "a passage" });
    context.history.run(command);
    expect(context.store.get("texts", DATA_INTEGRITY)!.body).toContain(`[${word}](link:${linkId})`);
    const link = context.store.get("links", linkId);
    expect(link?.kind === "link" && link.quote).toBe("a passage");
    expect(link?.kind === "link" && link.fromQuote).toBeUndefined();
    context.history.undo();
    expect(context.store.get("texts", DATA_INTEGRITY)!.body).toBe(body);
  });

  it("keeps a passage that the text cannot hold in fromQuote (web page, PDF, or a changed text)", () => {
    const context = loadTestContext();
    const before = context.store.get("texts", DATA_INTEGRITY)!.body;
    const { command, linkId } = linkEnds(context, { itemId: DATA_INTEGRITY, quote: "A sentence of a saved web page." }, { itemId: IDEAS });
    context.history.run(command);
    expect(context.store.get("texts", DATA_INTEGRITY)!.body).toBe(before);
    const link = context.store.get("links", linkId);
    expect(link?.kind === "link" && link.fromQuote).toBe("A sentence of a saved web page.");
    // The new field saves and reads back as a valid record.
    const reloaded = decodeVault(encodeVault(context.store, { format: 1, root: ROOT }));
    expect(reloaded.problems.filter((problem) => problem.severity === "error")).toEqual([]);
    expect(reloaded.store.get("links", linkId)).toEqual(link);
  });

  it("finds a passage again when the text moved, only if it is there one time", () => {
    expect(passageRange("one two three", { itemId: "x", quote: "two", range: { from: 0, to: 3 } })).toEqual({ from: 4, to: 7 });
    expect(passageRange("two and two", { itemId: "x", quote: "two", range: { from: 1, to: 4 } })).toBeNull();
    expect(passageRange("two and two", { itemId: "x", quote: "two", range: { from: 8, to: 11 } })).toEqual({ from: 8, to: 11 });
  });
});
