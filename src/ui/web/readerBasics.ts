// Basic parts of the readers (web page and PDF): modes, colors, boxes, marks, the zoom range, the margin.

import { type NoteColor } from "./savedPages";


export type ReaderMode = "select" | "highlight" | "pen" | "erase" | "comment" | "note";

/** Highlight fill colors, and scribble ink colors. */
export const FILL: Record<NoteColor, string> = {
  yellow: "rgba(255, 214, 10, 0.45)",
  green: "rgba(52, 199, 89, 0.38)",
  pink: "rgba(255, 55, 95, 0.32)",
  blue: "rgba(10, 132, 255, 0.32)",
};
export const INK: Record<NoteColor, string> = { yellow: "#e6b800", green: "#28a745", pink: "#ff375f", blue: "#0a84ff" };
export const ZOOM_RANGE = { min: 0.25, max: 4 };

export const clampZoom = (zoom: number) => Math.min(ZOOM_RANGE.max, Math.max(ZOOM_RANGE.min, zoom));

/** A box in page units. */
export type Box = { left: number; top: number; width: number; height: number };
/** A mark: a user highlight (with its color) or the spoken sentence. */
export type Mark = { id: string; color: NoteColor | "spoken" | "find" | "find-current" | "link" | "ready"; boxes: Box[] };

/**
 * The "ready" cursor of read aloud (setting speechShowReady): a thin bar after the last sentence whose audio is
 * ready, while it is ahead of the sentence that is read. Null when it does not show.
 */
export function readyMarkOf(state: { sourceId: string; sentences: { start: number; end: number }[]; current: number; readyEnd?: number; preparing: boolean } | null | undefined, sourceId: string, show: boolean, boxes: (start: number, end: number) => Box[]): Mark | null {
  if (!show || state == null || state.preparing || state.sourceId !== sourceId || state.readyEnd === undefined) return null;
  const last = state.sentences[state.readyEnd - 1];
  if (last === undefined || state.readyEnd - 1 <= state.current) return null;
  const box = boxes(Math.max(last.start, last.end - 1), last.end).at(-1);
  return box === undefined ? null : { id: "ready", color: "ready", boxes: [{ left: box.left + box.width, top: box.top, width: 2, height: box.height }] };
}

/**
 * The margin at each side of the page: one page width. The whole canvas (page and margins) takes notes, so the visible
 * area around the page is canvas at any zoom. Nothing about it is saved (older notes files can have `margin`: it is
 * kept, not used).
 */
export function marginOf(pageWidth: number): number {
  return Math.max(400, pageWidth);
}

/** The boxes of a DOM range, in page units: `origin` is the top left of the page in the coordinates of the range rects. */
export function boxesOf(range: Range, origin: { x: number; y: number }, factor: number): Box[] {
  return [...range.getClientRects()]
    .filter((rect) => rect.width > 0.5 && rect.height > 0.5)
    .map((rect) => ({ left: (rect.left - origin.x) / factor, top: (rect.top - origin.y) / factor, width: rect.width / factor, height: rect.height / factor }));
}

/** The names of the note colors (tooltips). */
export const COLOR_NAMES: Record<NoteColor, string> = { yellow: "Yellow", green: "Green", pink: "Pink", blue: "Blue" };
