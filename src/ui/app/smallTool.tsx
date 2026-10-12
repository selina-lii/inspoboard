// The small-item tool of a page, a saved web page, or a PDF (SPEC 1.1): one button with a list of all small kinds.
// - A click on a kind arms the tool for one item; a double-click keeps it on until Esc.
// - The next click on the surface (on the text or in a margin) makes the item there. The surface does that: it reads
//   the armed tool with useSmallTool() and calls `used()` after it made an item.
// - Text that is selected when the kind is chosen: the new item points to it.

import { useEffect, useState } from "react";
import type { ViewStyle } from "../../core/types";
import { ToolChoice } from "../tools/ToolChoice";
import { TOOLS, type Tool, type ToolId } from "../tools/registry";

export type TextAnchor = { text: string; at?: number };
export type ArmedTool = { view: ViewStyle; keep: boolean; anchor: TextAnchor | null };

/** The small kinds, in the order of the board menu (a text card is not a small item). */
export const SMALL_TOOLS: readonly Tool[] = TOOLS.filter((tool) => tool.menu === "small");

/**
 * True while a page or a saved web page / PDF is the open view: then the keys of the small kinds (N, M, W, I, F, Q)
 * choose that kind in the small-item button (not the board tool).
 */
export function smallSurfaceOpen(): boolean {
  return document.querySelector(".web-reader, .board-area > .text-page, .board-area .text-page[data-page-id]") !== null;
}

/** The key of a small kind: arms the small-item tool for that kind. False if the key is not a small kind. */
export function armSmallByKey(key: string): boolean {
  const tool = SMALL_TOOLS.find((entry) => entry.shortcut === key);
  if (tool?.createsView === undefined) return false;
  if (armed !== null && armed.view === tool.createsView) armSmallTool(null);
  else armSmallTool({ view: tool.createsView, keep: false, anchor: null });
  return true;
}

let armed: ArmedTool | null = null;
const listeners = new Set<() => void>();
const publish = () => listeners.forEach((listener) => listener());

/** The armed tool now (for key handlers outside React). */
export function armedSmallTool(): ArmedTool | null {
  return armed;
}

export function armSmallTool(tool: ArmedTool | null): void {
  armed = tool;
  publish();
}

/** The surface made an item: a one-use tool ends. */
export function usedSmallTool(): void {
  if (armed !== null && !armed.keep) armSmallTool(null);
  // A kept tool points to the selection only for its first item.
  else if (armed !== null && armed.anchor !== null) armSmallTool({ ...armed, anchor: null });
}

export function useSmallTool(): ArmedTool | null {
  const [, setRevision] = useState(0);
  useEffect(() => {
    const listener = () => setRevision((count) => count + 1);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  // Esc ends the tool.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && armed !== null && armSmallTool(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return armed;
}

/** The tool bar button: the list of small kinds. `selection`: the selected text of the surface now (or null). */
export function SmallItemButton({ disabled, selection }: { disabled: boolean; selection(): TextAnchor | null }) {
  const tool = useSmallTool();
  const active: ToolId = tool === null ? "select" : (SMALL_TOOLS.find((entry) => entry.createsView === tool.view)?.id ?? "select");
  return (
    <ToolChoice
      label="Add a small item: choose its kind, then click on the page (selected text: the item points to it)"
      tools={SMALL_TOOLS}
      active={active}
      sticky={tool?.keep === true}
      disabled={disabled}
      onChoose={(id, keep) => {
        const view = SMALL_TOOLS.find((entry) => entry.id === id)?.createsView;
        if (view === undefined) return;
        if (tool !== null && tool.view === view && !keep) armSmallTool(null);
        else armSmallTool({ view, keep, anchor: selection() });
      }}
    />
  );
}
