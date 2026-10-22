// Compare (lab plugin, capability "compare-text"): the rows of two texts side by side. SPEC 7.15.
// - The plugin compares word by word (spaces, line breaks, and hyphens in words do not count) and gives the changes
//   in order: the part of each text that differs. One side of a change can be empty (only the other side has it).
// - The rows here: the same text, then a change, then the same text, ... A long same part shows only its ends.
// - Plugin output is not trusted: a bad reply is an error, never a wrong view.

/** A part of one text (UTF-16 indexes). `from`: the end of the word before it (a copy takes the space before too). */
export type SidePart = { from: number; start: number; end: number };
export type Change = { left: SidePart; right: SidePart };

/** A row: the same text on the two sides, or a change. `change`: the index of the change. */
export type Row = { kind: "same"; left: string; right: string } | { kind: "change"; left: string; right: string; change: number };

/** The changes of a "compare" reply. They must be in order and inside the texts. */
export function readChanges(value: unknown, leftLength: number, rightLength: number): Change[] {
  const reply = value as { changes?: unknown } | null;
  if (reply === null || !Array.isArray(reply.changes)) throw new Error("The plugin gave a bad reply: it has no changes.");
  const ends: [number, number] = [0, 0];
  return reply.changes.map((entry): Change => {
    const change = entry as { left?: unknown; right?: unknown };
    const left = part(change.left, ends[0], leftLength);
    const right = part(change.right, ends[1], rightLength);
    if (left === null || right === null) throw new Error("The plugin gave a bad reply: its changes are not in order.");
    ends[0] = left.end;
    ends[1] = right.end;
    return { left, right };
  });
}

function part(value: unknown, after: number, length: number): SidePart | null {
  const { from, start, end } = (value ?? {}) as { from?: unknown; start?: unknown; end?: unknown };
  if (![from, start, end].every(Number.isInteger)) return null;
  const [a, b, c] = [from, start, end] as number[];
  return after <= a! && a! <= b! && b! <= c! && c! <= length ? { from: a!, start: b!, end: c! } : null;
}

/** The rows of the two texts: the same parts and the changes, in order. */
export function rowsOf(left: string, right: string, changes: readonly Change[]): Row[] {
  const rows: Row[] = [];
  let at: [number, number] = [0, 0];
  changes.forEach((change, index) => {
    if (change.left.start > at[0] || change.right.start > at[1]) rows.push({ kind: "same", left: left.slice(at[0], change.left.start), right: right.slice(at[1], change.right.start) });
    rows.push({ kind: "change", left: left.slice(change.left.start, change.left.end), right: right.slice(change.right.start, change.right.end), change: index });
    at = [change.left.end, change.right.end];
  });
  if (at[0] < left.length || at[1] < right.length) rows.push({ kind: "same", left: left.slice(at[0]), right: right.slice(at[1]) });
  return rows;
}

/**
 * The text of one side after a change is copied to it from the other side: its part (with the space before it)
 * becomes the part of the other side.
 */
export function copyChange(change: Change, from: string, to: string, fromSide: "left" | "right"): string {
  const source = fromSide === "left" ? change.left : change.right;
  const target = fromSide === "left" ? change.right : change.left;
  return to.slice(0, target.from) + from.slice(source.from, source.end) + to.slice(target.end);
}

/** The text of a PDF or a saved page, as it shows: the line breaks of the layout are spaces. */
export function flowText(text: string): string {
  return text.replace(/\s+/g, " ");
}

/**
 * A long same part shows only the text near the changes: its end (after the change before it) and its start (before
 * the change after it). `head`, `tail`: the shown text; `hidden`: the number of words not shown. Null: it shows whole.
 */
export function shortened(text: string, before: boolean, after: boolean, keep = 240): { head: string; tail: string; hidden: number } | null {
  if (text.length <= keep * 2.5) return null;
  // Cut at a space, so no word is cut in two.
  const head = before ? text.slice(0, text.lastIndexOf(" ", keep) > 0 ? text.lastIndexOf(" ", keep) : keep) : "";
  const tailStart = text.indexOf(" ", text.length - keep);
  const tail = after ? text.slice(tailStart > 0 ? tailStart : text.length - keep) : "";
  const hidden = text.slice(head.length, text.length - tail.length).split(/\s+/).filter(Boolean).length;
  return { head, tail, hidden };
}

/** A marked part of one side: a range of its text, its kind, and its change. An empty range: words only on the other side go here. */
export type MarkKind = "changed" | "removed" | "added";
export type SideMark = { start: number; end: number; kind: MarkKind; change: number };

/** The marks of one side: one for each change. */
export function marksOf(changes: readonly Change[], side: "left" | "right"): SideMark[] {
  return changes.map((change, index) => {
    const own = change[side];
    const other = change[side === "left" ? "right" : "left"];
    const kind: MarkKind = own.start === own.end ? (side === "left" ? "added" : "removed") : other.start === other.end ? (side === "left" ? "removed" : "added") : "changed";
    return { start: own.start, end: own.end, kind, change: index };
  });
}

/** A box on a page, in fractions of the page size (so it fits any zoom). Width 0: a place between words. */
export type PageBox = { page: number; left: number; top: number; width: number; height: number; kind: MarkKind; change: number };
type Run = { start: number; end: number; page: number; left: number; top: number; width: number; height: number; font?: string };

/**
 * The boxes of the marks on the pages of a PDF. `runs`: the text pieces with their boxes, in text order (pdfText).
 * A part of a run is placed by the widths of the characters before it (`measure`; without it, all characters have
 * the same width).
 */
export function pageBoxes(runs: readonly Run[], pages: readonly { width: number; height: number }[], marks: readonly SideMark[], text = "", measure?: (text: string, font: string) => number): PageBox[] {
  const boxes: PageBox[] = [];
  // The x of a character index in a run (page units).
  const xOf = (run: Run, at: number) => {
    const length = run.end - run.start;
    let share = at / length;
    if (measure !== undefined && text !== "") {
      const piece = text.slice(run.start, run.end);
      const whole = measure(piece, run.font ?? "serif");
      if (whole > 0) share = measure(piece.slice(0, at), run.font ?? "serif") / whole;
    }
    return run.left + run.width * share;
  };
  const box = (run: Run, from: number, to: number, mark: SideMark) => {
    const size = pages[run.page - 1];
    if (size === undefined) return;
    const left = xOf(run, from);
    boxes.push({ page: run.page, left: left / size.width, top: run.top / size.height, width: (xOf(run, to) - left) / size.width, height: run.height / size.height, kind: mark.kind, change: mark.change });
  };
  let first = 0;
  for (const mark of [...marks].sort((a, b) => a.start - b.start)) {
    // Runs are in text order: skip the runs that end before this mark.
    while (first < runs.length && runs[first]!.end < mark.start) first += 1;
    if (mark.start === mark.end) {
      // A place: the first run at or after it.
      const run = runs[first];
      if (run !== undefined) box(run, Math.max(0, mark.start - run.start), Math.max(0, mark.start - run.start), mark);
      continue;
    }
    for (let index = first; index < runs.length && runs[index]!.start < mark.end; index += 1) {
      const run = runs[index]!;
      const from = Math.max(mark.start, run.start) - run.start;
      const to = Math.min(mark.end, run.end) - run.start;
      if (to > from && run.end > run.start) box(run, from, to, mark);
    }
  }
  return boxes;
}
