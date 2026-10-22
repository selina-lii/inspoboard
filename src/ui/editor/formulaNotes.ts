// Formula notes in a page (SPEC 7.10): the words of each formula at the left of its line. View only (a widget, not
// text). The React side gives the notes (setFormulaNotes): the words come from a "math-text" plugin.

import { StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

export type EditorFormulaNote = { from: number; words: string; tex: string };

export const setFormulaNotes = StateEffect.define<EditorFormulaNote[]>();

class NoteWidget extends WidgetType {
  constructor(
    private readonly words: string,
    private readonly tex: string,
  ) {
    super();
  }
  override eq(other: NoteWidget): boolean {
    return other.words === this.words && other.tex === this.tex;
  }
  toDOM(): HTMLElement {
    // A box of no width at the start of the line; the note hangs to its left (in the margin of the page).
    const anchor = document.createElement("span");
    anchor.className = "cm-formula-anchor";
    const note = document.createElement("span");
    note.className = "cm-formula-note";
    note.textContent = this.words;
    note.setAttribute("data-tip", this.tex);
    note.dir = "ltr";
    anchor.append(note);
    return anchor;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

export const formulaNotesField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setFormulaNotes)) continue;
      const doc = transaction.state.doc;
      // One note for each line (the notes of a line join): notes of one line would cover each other.
      const byLine = new Map<number, EditorFormulaNote[]>();
      for (const note of effect.value) {
        if (note.from > doc.length || note.words === "") continue;
        const line = doc.lineAt(note.from).from;
        byLine.set(line, [...(byLine.get(line) ?? []), note]);
      }
      const ranges: Range<Decoration>[] = [...byLine.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([line, notes]) => Decoration.widget({ widget: new NoteWidget(notes.map((note) => note.words).join(" · "), notes.map((note) => note.tex).join("\n")), side: -1 }).range(line));
      value = Decoration.set(ranges);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
