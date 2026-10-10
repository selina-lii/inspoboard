// Viewports of boards in this window. Not saved: a viewport is view state, not data.

import type { Viewport } from "@xyflow/react";
import type { Id } from "../../core/types";

const viewports = new Map<Id, Viewport>();

export function savedViewport(boardId: Id): Viewport | undefined {
  return viewports.get(boardId);
}

export function saveViewport(boardId: Id, viewport: Viewport): void {
  viewports.set(boardId, viewport);
}

/** The next visit to this board fits its contents to the view. */
export function forgetViewport(boardId: Id): void {
  viewports.delete(boardId);
}
