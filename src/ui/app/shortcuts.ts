// Global keyboard shortcuts. Keys typed in a text field or the editor go to that field.

import { useEffect } from "react";
import { armSmallByKey, smallSurfaceOpen } from "./smallTool";
import { isTextTarget } from "./dom";
import { isComposing, shortcutKey } from "./keys";
import { TOOLS, type ToolId } from "../tools/registry";
import { useSession } from "./sessionContext";

type Options = {
  setTool(update: ToolId | ((current: ToolId) => ToolId)): void;
  /** `replace`: show the replace field too (Ctrl+Alt+F). */
  openSearch(replace?: boolean): void;
  addItem(): void;
  collapseAll(): void;
  back(): void;
  forward(): void;
};

export function useShortcuts({ setTool, openSearch, addItem, collapseAll, back, forward }: Options): void {
  const session = useSession();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isComposing(event)) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = shortcutKey(event);
      // Save works everywhere, also in the editor.
      if (mod && key === "s" && !event.shiftKey) {
        event.preventDefault();
        void session.saveNow();
        return;
      }
      // Search works everywhere, also in the editor. With Alt: search and replace.
      if (mod && key === "f") {
        event.preventDefault();
        openSearch(event.altKey);
        return;
      }
      // Ctrl+Shift+P (or Cmd+Shift+P): collapse all cards on the board. Works also in a text field.
      if (mod && event.shiftKey && key === "p") {
        event.preventDefault();
        collapseAll();
        return;
      }
      // A text that cannot change (for example a translation in place of the text): ⌘Z is the app undo.
      const lockedText = event.target instanceof HTMLElement && event.target.closest(".cm-editor")?.querySelector(".cm-content")?.getAttribute("contenteditable") === "false";
      if (isTextTarget(event.target) && !(lockedText && mod && (key === "z" || key === "y"))) return;
      // Cmd+[ and Cmd+]: back and forward through the views, as in a browser.
      if (mod && (key === "[" || key === "]")) {
        event.preventDefault();
        if (key === "[") back();
        else forward();
        return;
      }
      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) session.history.redo();
        else session.history.undo();
        return;
      }
      if (mod && key === "y") {
        event.preventDefault();
        session.history.redo();
        return;
      }
      if (mod || event.altKey) return;
      if (key === "escape") {
        setTool("select");
        return;
      }
      if (key === "a") {
        addItem();
        return;
      }
      // A page or a saved web page / PDF is open: the keys of the small kinds choose that kind there (SPEC 1.1).
      if (smallSurfaceOpen() && armSmallByKey(key)) return;
      const tool = TOOLS.find((candidate) => candidate.shortcut === key);
      // The key of the active tool turns it off, as a second click on its button does.
      if (tool !== undefined) setTool((current) => (current === tool.id ? "select" : tool.id));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [session, setTool, openSearch, addItem, collapseAll, back, forward]);
}
