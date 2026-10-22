// "Formulas → words" (SPEC 7.10): one button in the reader bar (and in a page). With a "math-text" plugin, the words
// of each formula show at the left of the text, and read aloud says them in place of the formula.
// - Off: no formula work at all (a PDF is not scanned).
// - On, in a PDF: formulas are found when they are needed (the sentences that read aloud says next, the pages in
//   view) and saved for this PDF. A spinner shows while this work runs.

import { LoaderCircle, Sigma } from "lucide-react";
import { useSession, useSessionState } from "../app/sessionContext";
import "./plugins.css";

export function FormulaButton({ busy = false, count = null }: { busy?: boolean; count?: number | null }) {
  const session = useSession();
  const { settings } = useSessionState();
  const on = settings.formulaNotes;
  const set = (value: boolean) => void session.updateSettings({ formulaNotes: value });
  return (
    <button
      className={`formula-button${on ? " active" : ""}`}
      data-tip={
        !on
          ? "Formulas → words: read aloud says each formula as words, and the words show at the left of the text"
          : busy
            ? "Reading formulas (for the next sentences and the pages in view). Click: off"
            : "Formulas are read as words, and their words show at the left (click: off)"
      }
      data-tip-end
      onClick={() => set(!on)}
    >
      {on && busy ? <LoaderCircle size={14} className="spin" /> : <Sigma size={14} />}
      <span>{!on ? "Formulas → words" : count === null ? "Formulas: words" : `✓ ${count} formulas`}</span>
    </button>
  );
}
