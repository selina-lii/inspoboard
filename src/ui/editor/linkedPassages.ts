// Linked passages in a page text (SPEC 7.11): a faint gray mark on each passage that a link was made from or to, and
// on each text that a small item points to (SPEC 1.1). The page
// column shows a shadow of the other item with a curve to the passage. The React side gives the ranges.
// Each range has the id of its link end (see `PassageAnchor` in core/linkEnds.ts). Edits move the ranges, and the
// editor saves the new passages to their links, so a link end moves with its text.

import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { PassageAnchor } from "../../core/linkEnds";

export const setLinkedPassages = StateEffect.define<PassageAnchor[]>();

const mark = Decoration.mark({ class: "cm-linked-passage" });

type Passages = { anchors: PassageAnchor[]; decorations: DecorationSet };

function decorate(anchors: readonly PassageAnchor[]): DecorationSet {
  // Ranges that overlap become one mark: the gray stays the same faint gray.
  const merged: { from: number; to: number }[] = [];
  for (const range of anchors.filter((range) => range.from < range.to).sort((a, b) => a.from - b.from)) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ from: range.from, to: range.to });
  }
  return Decoration.set(merged.map((range) => mark.range(range.from, range.to)));
}

export const linkedPassagesField = StateField.define<Passages>({
  create: () => ({ anchors: [], decorations: Decoration.none }),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setLinkedPassages)) {
        const anchors = effect.value.filter((anchor) => anchor.to <= transaction.state.doc.length);
        return { anchors, decorations: decorate(anchors) };
      }
    }
    if (!transaction.docChanged || value.anchors.length === 0) return value;
    // Text typed at the edges of a passage stays out of it. A deleted passage becomes empty.
    const anchors = value.anchors.map((anchor) => {
      const from = transaction.changes.mapPos(anchor.from, 1);
      return { ...anchor, from, to: Math.max(from, transaction.changes.mapPos(anchor.to, -1)) };
    });
    return { anchors, decorations: value.decorations.map(transaction.changes) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});
