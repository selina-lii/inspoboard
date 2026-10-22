// Formula notes (SPEC 7.10): the words of each formula, in the left margin of a saved web page or a PDF, level with
// the formula. View only: they are not saved. The button (Σ) shows or hides them (setting formulaNotes).
// - Web pages: the formulas of the page (MathML, or its LaTeX). PDFs: the formulas that a "math-image" plugin finds.
// - The words come from a "math-text" plugin. A note is level with its formula (it does not move to make room);
//   notes can overlap: a press on one brings it to the front.

import type { Box } from "./readerShared";
import { PlacedBox, useFront } from "./placedBox";

export type FormulaNote = { key: string; box: Box; words: string; tex: string };

/** The space between a note and the page, the widest note, the lowest note, and the text size (page units). */
const GAP = 16;
const MAX_WIDTH = 300;
const MIN_HEIGHT = 34;
const FONT_SIZE = 12;

/**
 * The notes, in the scaled canvas layer (page units, x from the left of the canvas). `margin`: the left margin.
 * Each note is at the height of its formula, as high as the formula (at least two short lines), as the translation
 * boxes (placedBox.tsx): it never moves to make room, it fits its words, and a press brings it to the front.
 */
export function FormulaNotes({ notes, margin }: { notes: readonly FormulaNote[]; margin: number }) {
  const { front, bringToFront } = useFront();
  const width = Math.max(80, Math.min(MAX_WIDTH, margin - 2 * GAP));
  if (margin < 60) return null;
  return (
    <>
      {notes.map((note) => (
        <PlacedBox
          key={note.key}
          className={`formula-note${note.words === "" ? " waiting" : ""}`}
          top={note.box.top}
          left={margin - GAP - width}
          width={width}
          height={Math.max(MIN_HEIGHT, note.box.height)}
          fontSize={FONT_SIZE}
          fitKey={note.words}
          inFront={front === note.key}
          onFront={() => bringToFront(note.key)}
          tip={note.tex}
          dir="ltr"
        >
          {note.words === "" ? "…" : note.words}
        </PlacedBox>
      ))}
    </>
  );
}
