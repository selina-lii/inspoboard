// Drops between a page and the board (SPEC 1.1): a small item moves out of a page onto the board, or a card moves
// into an open page. The board view registers how a screen point maps to a board point.

import type { Id } from "../../core/types";

type BoardTarget = (clientX: number, clientY: number) => { boardId: Id; x: number; y: number } | null;
let target: BoardTarget | null = null;

/** The board view gives its point function. Returns the function that removes it. */
export function registerBoardDrop(next: BoardTarget): () => void {
  target = next;
  return () => {
    if (target === next) target = null;
  };
}

/** The board point under a screen point (the empty board, not a page window over it), or null. */
export function boardPointAt(clientX: number, clientY: number): { boardId: Id; x: number; y: number } | null {
  return target?.(clientX, clientY) ?? null;
}

/** The open page under a screen point, and the point in it ([x, y] from the top-right corner of its text), or null. */
export function pagePointAt(clientX: number, clientY: number): { pageId: Id; at: [number, number] } | null {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const page = element.closest(".text-page[data-page-id]");
    if (page === null) continue;
    const body = page.querySelector(".text-page-body")?.getBoundingClientRect();
    const pageId = page.getAttribute("data-page-id");
    if (body === undefined || pageId === null) return null;
    return { pageId, at: [Math.round(clientX - body.right), Math.round(clientY - body.top)] };
  }
  return null;
}
