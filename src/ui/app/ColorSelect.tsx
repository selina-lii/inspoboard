// A small color button that opens the card colors and "Default" (X). One component for every place that colors a
// thing: a link line (tool bar), a small item in a page or a reader (its head).
// The colors open over the window (a portal at the button): a page frame can clip, and a reader canvas is scaled.

import { Palette, X } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CARD_SWATCHES } from "./ColorManager";
import { useDismiss } from "./useDismiss";

type Props = {
  /** The color now, or null for the default. */
  value: string | null;
  disabled?: boolean;
  label: string;
  defaultLabel: string;
  /** Class names of the button (for example "icon-button" or "icon-button small"). */
  buttonClass?: string;
  iconSize?: number;
  onChange(color: string | null): void;
};

export function ColorSelect({ value, disabled = false, label, defaultLabel, buttonClass = "icon-button", iconSize = 16, onChange }: Props) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const menu = useRef<HTMLSpanElement>(null);
  const open = at !== null;
  useDismiss(open, menu, () => setAt(null));
  const choose = (color: string | null) => {
    setAt(null);
    if (color !== value) onChange(color);
  };
  return (
    <>
      <button
        className={`${buttonClass}${open ? " active" : ""}`}
        data-tip={label}
        disabled={disabled}
        // The press does not reach the dismiss of the open menu: a second click closes it (it does not open it again).
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          if (open) return setAt(null);
          const box = event.currentTarget.getBoundingClientRect();
          setAt({ left: Math.max(4, Math.min(box.left, window.innerWidth - 260)), top: box.bottom + 4 });
        }}
      >
        <Palette size={iconSize} style={value === null ? undefined : { color: value }} />
      </button>
      {at !== null &&
        createPortal(
          <span ref={menu} className="cap-menu swatches color-select-menu" role="menu" aria-label={label} style={{ left: at.left, top: at.top }}>
            {CARD_SWATCHES.map((color) => (
              <button key={color} role="menuitem" className={`swatch${color === value ? " active" : ""}`} style={{ background: color }} data-tip={color} onClick={() => choose(color)} />
            ))}
            <button role="menuitem" className="icon-button small" data-tip={defaultLabel} onClick={() => choose(null)}>
              <X size={14} />
            </button>
          </span>,
          document.body,
        )}
    </>
  );
}
