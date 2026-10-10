// One tool bar button for a set of tools (objects, groups). It shows the last tool of its set.
// A click opens the list. A click on a tool selects it for one use; a double-click keeps it on until Esc.

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Tool, ToolId } from "./registry";

type Props = {
  label: string;
  tools: readonly Tool[];
  active: ToolId;
  sticky: boolean;
  disabled: boolean;
  onChoose(tool: ToolId, keep: boolean): void;
};

export function ToolChoice({ label, tools, active, sticky, disabled, onChoose }: Props) {
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<ToolId>(tools[0]!.id);
  const frame = useRef<HTMLSpanElement>(null);
  const current = tools.find((tool) => tool.id === active);
  const shown = current ?? tools.find((tool) => tool.id === last) ?? tools[0]!;
  useEffect(() => {
    if (current !== undefined) setLast(current.id);
  }, [current]);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (frame.current !== null && !frame.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  return (
    <span className="tool-choice" ref={frame}>
      <button
        className={`icon-button tool-choice-button${current !== undefined ? " active" : ""}${current !== undefined && sticky ? " sticky" : ""}`}
        data-tip={`${label}${current !== undefined && sticky ? " (stays on: Esc ends it)" : ""}`}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <shown.icon size={18} strokeWidth={1.75} />
        <ChevronDown size={10} className="tool-choice-arrow" />
      </button>
      {open && (
        <div className="tool-choice-menu" role="menu" aria-label={label}>
          {tools.map((tool) => (
            <button
              key={tool.id}
              role="menuitem"
              className={tool.id === active ? "active" : undefined}
              onClick={() => {
                onChoose(tool.id, false);
                setOpen(false);
              }}
              onDoubleClick={() => {
                onChoose(tool.id, true);
                setOpen(false);
              }}
            >
              <tool.icon size={15} />
              <span>{tool.name ?? tool.label}</span>
              {tool.shortcut !== undefined && <kbd>{tool.shortcut.toUpperCase()}</kbd>}
            </button>
          ))}
          <div className="tool-choice-hint">Double-click: the tool stays on until Esc.</div>
        </div>
      )}
    </span>
  );
}
