// What shows at one step of the view history (navigation.ts): the open windows, the board view, and the scroll places
// of the text page and the windows. Back and forward give it again. View state only: never saved.

import type { Viewport } from "@xyflow/react";
import type { Id } from "../../core/types";
import type { BoardApi } from "../board/BoardView";
import type { EditorWindowState } from "../windows/EditorWindows";

export type ViewSnapshot = {
  windows: EditorWindowState[];
  board: { id: Id; viewport: Viewport } | null;
  /** Scroll places: "page:<id>" (the text page) and "window:<id>" (the text of a window). */
  scrolls: { key: string; top: number }[];
};

export function captureView(windows: EditorWindowState[], board: BoardApi | null): ViewSnapshot {
  const scrolls: ViewSnapshot["scrolls"] = [];
  for (const element of document.querySelectorAll<HTMLElement>(".text-page[data-page-id]")) {
    scrolls.push({ key: `page:${element.dataset.pageId}`, top: element.scrollTop });
  }
  for (const element of document.querySelectorAll<HTMLElement>(".editor-window[data-window-item]")) {
    const scroller = element.querySelector<HTMLElement>(".cm-scroller");
    if (scroller !== null) scrolls.push({ key: `window:${element.dataset.windowItem}`, top: scroller.scrollTop });
  }
  return { windows, board: board === null ? null : { id: board.boardId, viewport: board.viewport() }, scrolls };
}

/** Gives the scroll places again, after the views are made (their text needs a frame or two to lay out). */
export function restoreScrolls(scrolls: ViewSnapshot["scrolls"]): void {
  if (scrolls.length === 0) return;
  const apply = () => {
    for (const { key, top } of scrolls) {
      const [kind, id] = key.split(":");
      const element =
        kind === "page"
          ? document.querySelector<HTMLElement>(`.text-page[data-page-id="${id}"]`)
          : document.querySelector<HTMLElement>(`.editor-window[data-window-item="${id}"] .cm-scroller`);
      if (element !== null) element.scrollTop = top;
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(apply));
  // Text that lays out later (images, long pages): once more.
  window.setTimeout(apply, 250);
}
