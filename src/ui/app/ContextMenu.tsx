// A right-click menu. The board and the editor use it. Esc, a click outside, or a choice closes it.

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDismiss } from "./useDismiss";

export type MenuEntry =
  | { kind?: "item"; label: string; icon?: ReactNode; disabled?: boolean; onSelect(): void }
  | { kind: "separator" }
  /** A row of color swatches. */
  | { kind: "colors"; colors: string[]; onSelect(color: string): void }
  /** One line with a label and small choice buttons (for example the quotation marks of a quote card). */
  | { kind: "choices"; label: string; choices: { id: string; text: string; tip: string; color?: string }[]; current: string; onSelect(id: string): void };

export type MenuRequest = { x: number; y: number; entries: MenuEntry[] };

export function ContextMenu({ request, onClose }: { request: MenuRequest; onClose(): void }) {
  const frame = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: request.x, top: request.y });

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const box = frame.current?.getBoundingClientRect();
    if (box === undefined) return;
    setPosition({
      left: Math.max(4, Math.min(request.x, window.innerWidth - box.width - 4)),
      top: Math.max(4, Math.min(request.y, window.innerHeight - box.height - 4)),
    });
  }, [request]);

  useDismiss(true, frame, onClose, { capture: true, blur: true });

  return createPortal(
    <div ref={frame} className="context-menu" role="menu" style={position} onContextMenu={(event) => event.preventDefault()}>
      {request.entries.map((entry, index) =>
        entry.kind === "separator" ? (
          <div key={index} className="context-menu-separator" />
        ) : entry.kind === "choices" ? (
          <div key={index} className="context-menu-choices" role="group" aria-label={entry.label}>
            <span className="context-menu-choices-label">{entry.label}</span>
            <span className="context-menu-choices-buttons">
              {entry.choices.map((choice) => (
                <button
                  key={choice.id}
                  className={`${choice.id === entry.current ? "active" : ""}${choice.color !== undefined ? " dot" : ""}` || undefined}
                  style={choice.color === undefined ? undefined : { color: choice.color }}
                  data-tip={choice.tip}
                  aria-pressed={choice.id === entry.current}
                  onClick={() => {
                    onClose();
                    entry.onSelect(choice.id);
                  }}
                >
                  {choice.text}
                </button>
              ))}
            </span>
          </div>
        ) : entry.kind === "colors" ? (
          <div key={index} className="context-menu-colors" role="group" aria-label="Colors">
            {entry.colors.map((color) => (
              <button
                key={color}
                className="context-menu-color"
                style={{ background: color }}
                aria-label={color}
                onClick={() => {
                  onClose();
                  entry.onSelect(color);
                }}
              />
            ))}
          </div>
        ) : (
          <button
            key={index}
            role="menuitem"
            disabled={entry.disabled}
            onClick={() => {
              onClose();
              entry.onSelect();
            }}
          >
            <span className="context-menu-icon">{entry.icon}</span>
            {entry.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
