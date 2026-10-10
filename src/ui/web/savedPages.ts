// Saved web pages in a vault. See docs/SPEC.md section 7.8.
// - web/<key>.html: the page, one file (images, styles, and fonts inside). The web plugin makes it.
// - web/<key>.notes.json: the user's highlights, scribbles, and margin items (comments and notes) on the page.
//   The page file never changes for them.
// The key is the first 24 hex digits of the SHA-256 of the address (without "#..."). The same address gives the same key.

export const NOTES_VERSION = 1;
export const NOTE_COLORS = ["yellow", "green", "pink", "blue"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

/** A highlight: a range of the page text (see webText.ts) and the text it had, to find it again if the ranges move. */
export type WebHighlight = { id: string; start: number; end: number; quote: string; color: NoteColor };
/** A scribble: points in page coordinates (CSS pixels from the top left of the page). */
export type WebScribble = { id: string; points: [number, number][]; color: NoteColor; width: number };
/**
 * A comment or a note on the page canvas: in a margin or on the page. Its position is in page coordinates
 * (a margin left of the page has negative x). `created`: an ISO time.
 */
export type MarginItem = { id: string; kind: "comment" | "note"; x: number; y: number; w: number; text: string; color: NoteColor; author?: string; created: string };
/**
 * The notes of a page. Optional (old files do not have them):
 * - `items`: comments and notes on the page canvas.
 * - `margin`: the width of each margin that the user set (page units). Without it, the reader finds a width.
 * - `width`: the width at which the reader shows a web page. The text flows the same each time, so scribbles stay on their words.
 */
export type WebNotes = { version: number; highlights: WebHighlight[]; scribbles: WebScribble[]; items: MarginItem[]; margin?: number; width?: number };

export const EMPTY_NOTES: WebNotes = { version: NOTES_VERSION, highlights: [], scribbles: [], items: [] };
export const MARGIN_RANGE = { min: 0, max: 2000 };
export const WIDTH_RANGE = { min: 200, max: 4000 };

/** The address without its fragment. */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

export function isWebUrl(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** A local file: "file:///…", "~/…", a full path "/…", or a Windows path "C:\…". */
export function isLocalPath(text: string): boolean {
  const trimmed = text.trim();
  return /^file:\/\//i.test(trimmed) || /^~\//.test(trimmed) || /^\/(?!\/)/.test(trimmed) || /^[A-Za-z]:[\\/]/.test(trimmed);
}

/** True if a local path names a PDF file. */
export function isPdfPath(text: string): boolean {
  return isLocalPath(text) && /\.pdf$/i.test(text.trim());
}

/** The file name of a local path ("report.pdf"). */
export function fileNameOfPath(text: string): string {
  const parts = text.trim().replace(/[\\/]+$/, "").split(/[\\/]/);
  const last = parts[parts.length - 1] ?? text;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** A web address with a scheme: "example.com" becomes "https://example.com". Empty stays empty. A local path stays as it is. */
export function withScheme(url: string): string {
  const trimmed = url.trim();
  if (isLocalPath(trimmed)) return trimmed;
  return trimmed === "" || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export async function webKey(url: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeUrl(url))));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

export const pagePath = (key: string) => `web/${key}.html`;
export const notesPath = (key: string) => `web/${key}.notes.json`;
export const pdfPath = (key: string) => `web/${key}.pdf`;
/** Highlights and scribbles of an item (a note or a page). The same format as the notes of a web page. */
export const marksPath = (itemId: string) => `marks/${itemId}.json`;

/** Reads a notes file. Bad parts are dropped. A missing or bad file gives no notes. */
export function readNotes(text: string | null): WebNotes {
  if (text === null) return EMPTY_NOTES;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return EMPTY_NOTES;
  }
  const record = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const isColor = (color: unknown): color is NoteColor => NOTE_COLORS.includes(color as NoteColor);
  const highlights = (Array.isArray(record.highlights) ? record.highlights : []).flatMap((entry): WebHighlight[] => {
    const { id, start, end, quote, color } = (entry ?? {}) as Record<string, unknown>;
    if (typeof id !== "string" || !Number.isInteger(start) || !Number.isInteger(end) || typeof quote !== "string") return [];
    if ((start as number) < 0 || (end as number) <= (start as number)) return [];
    return [{ id, start: start as number, end: end as number, quote, color: isColor(color) ? color : "yellow" }];
  });
  const scribbles = (Array.isArray(record.scribbles) ? record.scribbles : []).flatMap((entry): WebScribble[] => {
    const { id, points, color, width } = (entry ?? {}) as Record<string, unknown>;
    if (typeof id !== "string" || !Array.isArray(points)) return [];
    const valid = points.filter((point): point is [number, number] => Array.isArray(point) && point.length === 2 && point.every((part) => typeof part === "number" && Number.isFinite(part)));
    if (valid.length < 2) return [];
    return [{ id, points: valid, color: isColor(color) ? color : "yellow", width: typeof width === "number" && width > 0 && width <= 40 ? width : 3 }];
  });
  const finite = (part: unknown): part is number => typeof part === "number" && Number.isFinite(part);
  const items = (Array.isArray(record.items) ? record.items : []).flatMap((entry): MarginItem[] => {
    const { id, kind, x, y, w, text, color, author, created } = (entry ?? {}) as Record<string, unknown>;
    if (typeof id !== "string" || (kind !== "comment" && kind !== "note") || !finite(x) || !finite(y) || typeof text !== "string") return [];
    const item: MarginItem = { id, kind, x, y, w: finite(w) && w >= 40 && w <= 2000 ? w : 200, text, color: isColor(color) ? color : "yellow", created: typeof created === "string" ? created : "" };
    if (typeof author === "string" && author !== "") item.author = author;
    return [item];
  });
  const notes: WebNotes = { version: NOTES_VERSION, highlights, scribbles, items };
  const { margin, width } = record;
  if (finite(margin) && margin >= MARGIN_RANGE.min && margin <= MARGIN_RANGE.max) notes.margin = margin;
  if (finite(width) && width >= WIDTH_RANGE.min && width <= WIDTH_RANGE.max) notes.width = width;
  return notes;
}

export function encodeNotes(notes: WebNotes): string {
  const { highlights, scribbles, items, margin, width } = notes;
  return `${JSON.stringify({ version: NOTES_VERSION, highlights, scribbles, items, margin, width }, null, 1)}\n`;
}

/**
 * The range of a highlight in the current page text. The saved range if its text is the same,
 * else the place of the quote that is nearest to the saved range. Null if the quote is not in the text.
 */
export function placeHighlight(text: string, highlight: WebHighlight): { start: number; end: number } | null {
  if (text.slice(highlight.start, highlight.end) === highlight.quote) return { start: highlight.start, end: highlight.end };
  let best: number | null = null;
  for (let at = text.indexOf(highlight.quote); at !== -1; at = text.indexOf(highlight.quote, at + 1)) {
    if (best === null || Math.abs(at - highlight.start) < Math.abs(best - highlight.start)) best = at;
  }
  return best === null || highlight.quote === "" ? null : { start: best, end: best + highlight.quote.length };
}

/** An SVG path for scribble points. */
export function pathOf(points: readonly [number, number][]): string {
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
}
