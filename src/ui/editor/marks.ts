// Highlights in the editor (marks of an item, see src/ui/windows/marks.tsx). They are decorations only:
// the text does not change. Edits move them (CodeMirror maps their positions); the item marks file then saves the new ranges.

import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { NoteColor } from "../web/savedPages";

export type MarkRange = { id: string; from: number; to: number; color: NoteColor };

/** Replaces all highlights (from the marks file). */
export const setMarkRanges = StateEffect.define<MarkRange[]>();

type MarkState = { ranges: MarkRange[]; deco: DecorationSet };

function decorate(ranges: readonly MarkRange[]): DecorationSet {
  const sorted = [...ranges].filter((range) => range.to > range.from).sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(sorted.map((range) => Decoration.mark({ class: `cm-mark cm-mark-${range.color}` }).range(range.from, range.to)));
}

export const markField = StateField.define<MarkState>({
  create: () => ({ ranges: [], deco: Decoration.none }),
  update(value, transaction) {
    let ranges = value.ranges;
    if (transaction.docChanged && ranges.length > 0) {
      ranges = ranges
        .map((range) => ({ ...range, from: transaction.changes.mapPos(range.from, 1), to: transaction.changes.mapPos(range.to, -1) }))
        .filter((range) => range.to > range.from);
    }
    for (const effect of transaction.effects) if (effect.is(setMarkRanges)) ranges = effect.value;
    return ranges === value.ranges ? value : { ranges, deco: decorate(ranges) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.deco),
});

/** The highlight at a text position, or undefined. */
export function markAt(ranges: readonly MarkRange[], position: number): MarkRange | undefined {
  return ranges.find((range) => position >= range.from && position <= range.to);
}

export const markTheme = EditorView.theme({
  ".cm-scroller": { position: "relative" },
  ".cm-mark": { borderRadius: "2px" },
  ".cm-mark-yellow": { backgroundColor: "rgba(255, 214, 10, 0.38)" },
  ".cm-mark-green": { backgroundColor: "rgba(52, 199, 89, 0.33)" },
  ".cm-mark-pink": { backgroundColor: "rgba(255, 55, 95, 0.3)" },
  ".cm-mark-blue": { backgroundColor: "rgba(10, 132, 255, 0.3)" },
});
