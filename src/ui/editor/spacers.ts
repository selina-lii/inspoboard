// Empty space after lines of the editor, for side-by-side alignment (a paragraph and its translation start level).
// The space is a block widget: it is not text, and the editor does not save it.

import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

/** A space of `height` pixels after the line that ends at `pos`. */
export type Spacer = { pos: number; height: number };

class SpaceWidget extends WidgetType {
  constructor(readonly height: number) {
    super();
  }
  override eq(other: SpaceWidget): boolean {
    return other.height === this.height;
  }
  toDOM(): HTMLElement {
    const element = document.createElement("div");
    element.className = "cm-align-space";
    element.style.height = `${this.height}px`;
    return element;
  }
  override get estimatedHeight(): number {
    return this.height;
  }
}

export const setSpacers = StateEffect.define<Spacer[]>();

export const spacerField = StateField.define<{ list: Spacer[]; decorations: DecorationSet }>({
  create: () => ({ list: [], decorations: Decoration.none }),
  update(value, transaction) {
    let list = value.list;
    // Edits move the spaces with their lines. A new list from the aligner replaces them.
    if (transaction.docChanged) list = list.map((spacer) => ({ ...spacer, pos: transaction.changes.mapPos(spacer.pos, 1) }));
    for (const effect of transaction.effects) if (effect.is(setSpacers)) list = effect.value;
    if (list === value.list) return value;
    const builder = new RangeSetBuilder<Decoration>();
    const length = transaction.state.doc.length;
    for (const spacer of [...list].sort((a, b) => a.pos - b.pos)) {
      if (spacer.height < 0.5) continue;
      const pos = Math.min(length, spacer.pos);
      builder.add(pos, pos, Decoration.widget({ widget: new SpaceWidget(Math.round(spacer.height * 10) / 10), block: true, side: 1 }));
    }
    return { list, decorations: builder.finish() };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/**
 * The height of a range of lines without the spaces after them: from the top of `from` to the bottom of `to`.
 * Each line is found by its start. At the end of a line, the block could be its space (a block widget at the same
 * position): its height must never count, or each alignment gives a different space and the text jumps.
 */
export function linesHeight(view: EditorView, from: number, to: number): number {
  const { doc } = view.state;
  return view.lineBlockAt(doc.lineAt(to).from).bottom - view.lineBlockAt(doc.lineAt(from).from).top;
}
