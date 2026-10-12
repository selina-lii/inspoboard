// One tool bar button for a set of tools (objects, groups). It shows the last tool of its set.
// A click opens the list. A click on a tool selects it for one use; a double-click keeps it on until Esc.
// Tools with a submenu (for example the shapes of a group) show as one row. The pointer on it (or a click) opens
// the list of its tools at its side.

import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TOOL_SUBMENUS, type Tool, type ToolId, type ToolSubmenu } from "./registry";

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
  const [sub, setSub] = useState<ToolSubmenu | null>(null);
  const [last, setLast] = useState<ToolId>(tools[0]!.id);
  const frame = useRef<HTMLSpanElement>(null);
  const current = tools.find((tool) => tool.id === active);
  const shown = current ?? tools.find((tool) => tool.id === last) ?? tools[0]!;
  useEffect(() => {
    if (current !== undefined) setLast(current.id);
  }, [current]);
  useEffect(() => {
    if (!open) {
      setSub(null);
      return;
    }
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
  const row = (tool: Tool) => (
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
  );
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
          {tools.map((tool, index) => {
            if (tool.submenu === undefined) return row(tool);
            // A submenu: one row, at the place of its first tool.
            if (tools.findIndex((other) => other.submenu === tool.submenu) !== index) return null;
            const id = tool.submenu;
            const members = tools.filter((other) => other.submenu === id);
            const { name, icon: Icon } = TOOL_SUBMENUS[id];
            return (
              <div key={`sub:${id}`} className="tool-choice-sub" onPointerEnter={() => setSub(id)} onPointerLeave={() => setSub((current) => (current === id ? null : current))}>
                <button role="menuitem" aria-haspopup="menu" aria-expanded={sub === id} className={members.some((other) => other.id === active) || sub === id ? "active" : undefined} onClick={() => setSub((current) => (current === id ? null : id))}>
                  <Icon size={15} />
                  <span>{name}</span>
                  <ChevronRight size={13} className="tool-choice-arrow" />
                </button>
                {sub === id && (
                  <div className="tool-choice-menu tool-choice-submenu" role="menu" aria-label={name}>
                    {members.map(row)}
                  </div>
                )}
              </div>
            );
          })}
          <div className="tool-choice-hint">Double-click: the tool stays on until Esc.</div>
        </div>
      )}
    </span>
  );
}
