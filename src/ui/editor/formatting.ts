// Text formatting keys of the editor: ⌘B (Ctrl+B) bold, ⌘I italic, ⌘U underline. See docs/SPEC.md section 7.5.
// - The text stays Markdown: **bold**, *italic*, and <u>underline</u> (Markdown has no underline; the HTML tag is
//   the usual form, as in Obsidian and GitHub).
// - With selected text: the marks go around it, or (if it has them already) they go away. With no selection: the
//   marks go in, and the cursor goes between them.

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** Puts marks around each selection, or takes them away. Always true (the key is used). */
export function toggleMarks(view: EditorView, open: string, close: string = open): boolean {
  const { state } = view;
  const change = state.changeByRange((range) => {
    const before = state.sliceDoc(Math.max(0, range.from - open.length), range.from);
    const after = state.sliceDoc(range.to, range.to + close.length);
    const inside = state.sliceDoc(range.from, range.to);
    // The marks are just outside the selection: take them away.
    if (before === open && after === close) {
      return {
        changes: [
          { from: range.from - open.length, to: range.from, insert: "" },
          { from: range.to, to: range.to + close.length, insert: "" },
        ],
        range: EditorSelection.range(range.from - open.length, range.to - open.length),
      };
    }
    // The selection holds the marks: take them away.
    if (inside.length >= open.length + close.length && inside.startsWith(open) && inside.endsWith(close)) {
      const text = inside.slice(open.length, inside.length - close.length);
      return { changes: { from: range.from, to: range.to, insert: text }, range: EditorSelection.range(range.from, range.from + text.length) };
    }
    return {
      changes: [
        { from: range.from, insert: open },
        { from: range.to, insert: close },
      ],
      range: EditorSelection.range(range.from + open.length, range.to + open.length),
    };
  });
  view.dispatch(state.update(change, { scrollIntoView: true, userEvent: "input.format" }));
  return true;
}

/** The keys: bold, italic, underline. */
export const formattingKeys = [
  { key: "Mod-b", run: (view: EditorView) => toggleMarks(view, "**"), preventDefault: true },
  { key: "Mod-i", run: (view: EditorView) => toggleMarks(view, "*"), preventDefault: true },
  { key: "Mod-u", run: (view: EditorView) => toggleMarks(view, "<u>", "</u>"), preventDefault: true },
];
