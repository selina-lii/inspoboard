// The ink colors of board scribbles: the theme ink (black or white) and the four pen colors of pages.
// While the scribble tool is on, the tool bar shows them. The choice is the vault setting "scribbleColor".
// The right-click menu of a scribble recolors it (the color of its place link).

import { INK } from "../web/readerBasics";
import { useSession, useSessionState } from "../app/sessionContext";

/** The ink colors, after the theme ink. */
export const SCRIBBLE_COLORS: readonly { color: string; label: string }[] = [
  { color: INK.yellow, label: "Yellow" },
  { color: INK.green, label: "Green" },
  { color: INK.pink, label: "Pink" },
  { color: INK.blue, label: "Blue" },
];

export function PenColors() {
  const session = useSession();
  const { settings } = useSessionState();
  const current = settings.scribbleColor;
  return (
    <span className="pen-colors" role="group" aria-label="Scribble color">
      <button className={`pen-color ink${current === null ? " active" : ""}`} data-tip="Ink (black or white, as the theme)" aria-label="Ink" onClick={() => void session.updateSettings({ scribbleColor: null })} />
      {SCRIBBLE_COLORS.map((entry) => (
        <button
          key={entry.color}
          className={`pen-color${current === entry.color ? " active" : ""}`}
          style={{ background: entry.color }}
          data-tip={entry.label}
          aria-label={entry.label}
          onClick={() => void session.updateSettings({ scribbleColor: entry.color })}
        />
      ))}
    </span>
  );
}
