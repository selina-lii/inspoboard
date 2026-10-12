import { describe, expect, it } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { toggleMarks } from "../src/ui/editor/formatting";

/** A tiny stand-in for an editor view: toggleMarks reads `state` and calls `dispatch`. */
function run(doc: string, from: number, to: number, open: string, close?: string) {
  const view = { state: EditorState.create({ doc, selection: EditorSelection.single(from, to) }) } as { state: EditorState; dispatch(tr: unknown): void };
  view.dispatch = (tr) => void (view.state = (tr as { state: EditorState }).state);
  toggleMarks(view as never, open, close);
  const range = view.state.selection.main;
  return { text: view.state.doc.toString(), from: range.from, to: range.to };
}

describe("formatting keys", () => {
  it("puts marks around the selection, and takes them away again", () => {
    expect(run("a word here", 2, 6, "**")).toEqual({ text: "a **word** here", from: 4, to: 8 });
    expect(run("a **word** here", 4, 8, "**")).toEqual({ text: "a word here", from: 2, to: 6 });
    expect(run("a **word** here", 2, 10, "**")).toEqual({ text: "a word here", from: 2, to: 6 });
    expect(run("x", 0, 1, "<u>", "</u>")).toEqual({ text: "<u>x</u>", from: 3, to: 4 });
  });
  it("with no selection: the marks go in, the cursor between them", () => {
    expect(run("ab", 1, 1, "*")).toEqual({ text: "a**b", from: 2, to: 2 });
  });
});
