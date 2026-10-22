import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { isPassageLink, linkedPassageRange, linkedPassagesOf, linkEnds, movePassageEnds, passageRange, unlinkPassage } from "../src/core/linkEnds";
import { linkedPassagesField, setLinkedPassages } from "../src/ui/editor/linkedPassages";
import { buildBoardModel } from "../src/ui/board/boardModel";
import { decodeVault, encodeVault } from "../src/core/format";
import { updateRelation } from "../src/core/actions";
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
    const reloaded = decodeVault(encodeVault(context.store, { format: 2, root: ROOT }));
    expect(reloaded.problems.filter((problem) => problem.severity === "error")).toEqual([]);
    expect(reloaded.store.get("links", linkId)).toEqual(link);
  });

  it("finds a passage again when the text moved, only if it is there one time", () => {
    expect(passageRange("one two three", { itemId: "x", quote: "two", range: { from: 0, to: 3 } })).toEqual({ from: 4, to: 7 });
    expect(passageRange("two and two", { itemId: "x", quote: "two", range: { from: 1, to: 4 } })).toBeNull();
    expect(passageRange("two and two", { itemId: "x", quote: "two", range: { from: 8, to: 11 } })).toEqual({ from: 8, to: 11 });
  });

  it("a link from text: a gray passage and a shadow at both ends, not on the board; unlink gives the words back", () => {
    const context = loadTestContext();
    const body = context.store.get("texts", DATA_INTEGRITY)!.body;
    const word = body.split(/\s+/).find((candidate) => /^[A-Za-z]{5,}$/.test(candidate) && body.indexOf(candidate) === body.lastIndexOf(candidate))!;
    const from = body.indexOf(word);
    const { command, linkId } = linkEnds(context, { itemId: DATA_INTEGRITY, quote: word, range: { from, to: from + word.length } }, { itemId: IDEAS, quote: "a target passage" });
    context.history.run(command);
    const link = context.store.get("links", linkId)!;
    expect(link.kind === "link" && isPassageLink(context.store, link)).toBe(true);
    // At the source: its words in the text, and the other item with its passage.
    const [here] = linkedPassagesOf(context.store, context.graph, DATA_INTEGRITY);
    expect(here).toMatchObject({ linkId, quote: word, otherId: IDEAS, otherQuote: "a target passage", outgoing: true });
    expect(linkedPassageRange(context.store.get("texts", DATA_INTEGRITY)!.body, here!)).toEqual({ from: from + 1, to: from + 1 + word.length });
    // At the target: its passage, and the source with the words.
    expect(linkedPassagesOf(context.store, context.graph, IDEAS)).toEqual([{ linkId, quote: "a target passage", otherId: DATA_INTEGRITY, otherQuote: word, outgoing: false }]);
    // Not a line on a board.
    for (const board of [ROOT, IDEAS]) expect(buildBoardModel(context.store, context.graph, board).edges.some((edge) => edge.linkId === linkId)).toBe(false);
    // Put on boards (by the user): a dashed line between the two cards. It is saved. Off again: not on the board.
    context.history.run(updateRelation(context, linkId, { onBoard: true }));
    expect(buildBoardModel(context.store, context.graph, ROOT).edges.find((edge) => edge.linkId === linkId)).toMatchObject({ kind: "relation", passage: true });
    expect(decodeVault(encodeVault(context.store, { format: 2, root: ROOT })).store.get("links", linkId)).toMatchObject({ onBoard: true });
    context.history.run(updateRelation(context, linkId, { onBoard: false }));
    expect(context.store.get("links", linkId)).not.toHaveProperty("onBoard");
    expect(buildBoardModel(context.store, context.graph, ROOT).edges.some((edge) => edge.linkId === linkId)).toBe(false);
    context.history.run(unlinkPassage(context, linkId));
    expect(context.store.has("links", linkId)).toBe(false);
    expect(context.store.get("texts", DATA_INTEGRITY)!.body).toBe(body);
  });

  it("a link between whole items is not a passage link (it shows on the board)", () => {
    const context = loadTestContext();
    const { command, linkId } = linkEnds(context, { itemId: TOOL_RESEARCH }, { itemId: IDEAS });
    context.history.run(command);
    const link = context.store.get("links", linkId)!;
    expect(link.kind === "link" && isPassageLink(context.store, link)).toBe(false);
    expect(linkedPassagesOf(context.store, context.graph, TOOL_RESEARCH)).toEqual([]);
  });

  it("moves a link end with its passage when the text changes", () => {
    const context = loadTestContext();
    const body = "Intro. The linked words here. End.";
    context.store.write([{ table: "texts", id: IDEAS, after: { id: IDEAS, body } }]);
    const { command, linkId } = linkEnds(context, { itemId: TOOL_RESEARCH }, { itemId: IDEAS, quote: "linked words" });
    context.history.run(command);
    const from = body.indexOf("linked words");
    let state = EditorState.create({ doc: body, extensions: [linkedPassagesField] });
    state = state.update({ effects: setLinkedPassages.of([{ id: `to:${linkId}`, from, to: from + 12 }]) }).state;
    // Text before the passage, text at its edges (stays out), and a change inside it.
    state = state.update({ changes: [{ from: 0, insert: "New start. " }, { from: from + 12, insert: "!" }] }).state;
    state = state.update({ changes: { from: state.doc.toString().indexOf("words"), to: state.doc.toString().indexOf("words") + 5, insert: "lines" } }).state;
    const anchors = state.field(linkedPassagesField).anchors;
    expect(state.doc.sliceString(anchors[0]!.from, anchors[0]!.to)).toBe("linked lines");
    expect(movePassageEnds(context.store, state.doc.toString(), anchors)).toBe(true);
    const link = context.store.get("links", linkId);
    expect(link?.kind === "link" && link.quote).toBe("linked lines");
    // A deleted passage keeps its link.
    state = state.update({ changes: { from: anchors[0]!.from, to: anchors[0]!.to } }).state;
    expect(movePassageEnds(context.store, state.doc.toString(), state.field(linkedPassagesField).anchors)).toBe(false);
  });
});
