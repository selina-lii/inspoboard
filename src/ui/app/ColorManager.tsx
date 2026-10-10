// Color manager (tool bar): the background of the board (this board or all boards) and the color of selected cards.
// Board background images come from the canvas menu or the "Image…" button. They are copied into images/ of the vault.

import { ImagePlus, Palette, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { setBoardBackground, setCardColor } from "../../core/actions";
import type { Command } from "../../core/commands";
import type { Id } from "../../core/types";
import type { Session } from "../../io/session";
import { useRunCommand, useSession, useSessionState } from "./sessionContext";

/** Dark backgrounds that keep the board readable, then bright colors for cards. */
export const BOARD_SWATCHES = ["#1c1c1e", "#2c2c2e", "#1b2433", "#1d2b24", "#2e2419", "#2a2036", "#331d22", "#f2f2f7"];
export const CARD_SWATCHES = ["#ff453a", "#ff9f0a", "#ffd60a", "#30d158", "#64d2ff", "#0a84ff", "#8a92f2", "#bf5af2", "#ff375f", "#ac8e68", "#8e8e93", "#ffffff"];

export type BackgroundScope = "board" | "all";

/** Sets a background for one board (a command) or as the default of all boards (a vault setting). */
export async function applyBackground(session: Session, runCommand: (command: Command) => boolean, scope: BackgroundScope, boardId: Id, value: string | null): Promise<void> {
  if (scope === "board") runCommand(setBoardBackground(session.context, boardId, value));
  else await session.updateSettings({ defaultBackground: value });
}

/** Asks for an image, copies it into the vault, and uses it as a background. */
export async function chooseBackgroundImage(session: Session, runCommand: (command: Command) => boolean, scope: BackgroundScope, boardId: Id): Promise<string | null> {
  try {
    const path = await session.importImage();
    if (path !== null) await applyBackground(session, runCommand, scope, boardId, path);
    return null;
  } catch (error) {
    return String(error);
  }
}

export function ColorManager({ boardId, placeIds }: { boardId: Id; placeIds: readonly Id[] }) {
  const session = useSession();
  const { readOnly, settings } = useSessionState();
  const runCommand = useRunCommand();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<BackgroundScope>("board");
  const [error, setError] = useState<string | null>(null);
  const frame = useRef<HTMLSpanElement>(null);
  const own = session.store.get("items", boardId)?.background ?? null;
  const current = scope === "board" ? own : settings.defaultBackground;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => frame.current !== null && !frame.current.contains(event.target as Node) && setOpen(false);
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const setBackground = (value: string | null) => void applyBackground(session, runCommand, scope, boardId, value);
  const setCards = (color: string | null) => runCommand(setCardColor(session.context, placeIds, color));

  return (
    <span className="color-manager" ref={frame}>
      <button className={`icon-button${open ? " active" : ""}`} data-tip="Colors" disabled={readOnly} onClick={() => setOpen((value) => !value)}>
        <Palette size={17} />
      </button>
      {open && (
        <div className="color-popover" role="dialog" aria-label="Colors">
          <div className="color-section-head">
            <span>Board background</span>
            <span className="plugin-modes" role="group">
              <button className={scope === "board" ? "active" : undefined} onClick={() => setScope("board")}>This board</button>
              <button className={scope === "all" ? "active" : undefined} onClick={() => setScope("all")}>All boards</button>
            </span>
          </div>
          <div className="swatches">
            {BOARD_SWATCHES.map((color) => (
              <button key={color} className={`swatch${current === color ? " active" : ""}`} style={{ background: color }} data-tip={color} onClick={() => setBackground(color)} />
            ))}
            <label className="swatch custom" data-tip="Other color">
              <input type="color" value={current !== null && current.startsWith("#") ? current : "#1c1c1e"} onChange={(event) => setBackground(event.target.value)} />
            </label>
            <button
              className="icon-button small"
              data-tip="Image…"
              onClick={async () => setError(await chooseBackgroundImage(session, runCommand, scope, boardId))}
            >
              <ImagePlus size={14} />
            </button>
            <button className="icon-button small" data-tip={scope === "board" ? "No own background (use the default)" : "No default background"} onClick={() => setBackground(null)}>
              <X size={14} />
            </button>
          </div>
          {scope === "all" && <div className="setting-help">Boards with their own background keep it.</div>}
          <div className="color-section-head">
            <span>Card color</span>
            <span className="muted">{placeIds.length === 0 ? "Select cards first" : `${placeIds.length} selected`}</span>
          </div>
          <div className="swatches">
            {CARD_SWATCHES.map((color) => (
              <button key={color} className="swatch" style={{ background: color }} data-tip={color} disabled={placeIds.length === 0} onClick={() => setCards(color)} />
            ))}
            <label className="swatch custom" data-tip="Other color">
              <input type="color" disabled={placeIds.length === 0} onChange={(event) => setCards(event.target.value)} />
            </label>
            <button className="icon-button small" data-tip="Color of the card kind" disabled={placeIds.length === 0} onClick={() => setCards(null)}>
              <X size={14} />
            </button>
          </div>
          {error !== null && <div className="plugin-error">{error}</div>}
        </div>
      )}
    </span>
  );
}
