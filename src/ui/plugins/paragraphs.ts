// Paragraph alignment for side-by-side results (for example a translation at the right of its text).
// - A block is a Markdown paragraph: lines up to an empty line. A heading, a list item, a quote line, a table row,
//   and a code block (fence to fence) are blocks of their own. A block keeps the empty lines after it.
// - The two texts are paired by content (alignBlocks): the length of each block (in the scale of each language),
//   its kind (heading, list item, quote, table row, code), and the numbers and links in it. A row can hold one block
//   at each side, two or three blocks at one side for one block at the other (the plugin joined or split blocks),
//   or a block that has no partner. The rows stay in order.

export type Block = { from: number; to: number };

const OWN_LINE = /^\s{0,3}(#{1,6}\s|[-*+]\s|\d{1,9}[.)]\s|>|\|)/;
const FENCE = /^\s{0,3}(```|~~~)/;

/** The blocks of a text, in order. They cover the whole text (the first block also holds empty lines before it). */
export function paragraphBlocks(text: string): Block[] {
  const starts: number[] = [];
  let at = 0;
  /** True after an empty line, a heading, or the end of a code block: the next text line starts a block. */
  let breakBefore = true;
  let inFence = false;
  for (const line of text.split("\n")) {
    const blank = line.trim() === "";
    const fence = FENCE.test(line);
    if (inFence) {
      if (fence) {
        inFence = false;
        breakBefore = true;
      }
    } else if (!blank && (breakBefore || OWN_LINE.test(line) || fence)) {
      starts.push(at);
      inFence = fence;
      breakBefore = /^\s{0,3}#{1,6}\s/.test(line);
    } else {
      breakBefore = blank;
    }
    at += line.length + 1;
  }
  if (starts.length === 0) return [{ from: 0, to: text.length }];
  starts[0] = 0;
  return starts.map((from, index) => ({ from, to: index + 1 < starts.length ? starts[index + 1]! : text.length }));
}

/**
 * Rows of paired blocks: each row has a range of left blocks and a range of right blocks (end not included).
 * Equal counts pair one to one. Else each right block goes to the left block at the same relative place.
 */
export function pairBlocks(left: number, right: number): { left: [number, number]; right: [number, number] }[] {
  if (left === 0 || right === 0) return [{ left: [0, left], right: [0, right] }];
  const owner = Array.from({ length: right }, (_, index) => Math.min(left - 1, Math.floor((index * left) / right)));
  const rows: { left: [number, number]; right: [number, number] }[] = [];
  for (let index = 0; index < left; index += 1) {
    const first = owner.indexOf(index);
    const mine = owner.filter((value) => value === index).length;
    // A left block with no right block joins the row before it (the rows stay in order).
    if (mine === 0) {
      if (rows.length > 0) rows[rows.length - 1]!.left[1] = index + 1;
      else rows.push({ left: [index, index + 1], right: [0, 0] });
      continue;
    }
    rows.push({ left: [index, index + 1], right: [first, first + mine] });
  }
  return rows;
}

export type Row = { left: [number, number]; right: [number, number] };

/** The kind of a block, from its first line that is not empty. */
function kindOf(text: string): string {
  const line = text.split("\n").find((part) => part.trim() !== "") ?? "";
  const heading = /^\s{0,3}(#{1,6})\s/.exec(line);
  if (heading !== null) return `h${heading[1]!.length}`;
  if (FENCE.test(line)) return "code";
  if (/^\s{0,3}[-*+]\s/.test(line)) return "bullet";
  if (/^\s{0,3}\d{1,9}[.)]\s/.test(line)) return "number";
  if (/^\s{0,3}>/.test(line)) return "quote";
  if (/^\s{0,3}\|/.test(line)) return "table";
  return line === "" ? "empty" : "text";
}

const WIDE = /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/gu;
/** One CJK character holds about as much meaning as this many Latin letters. */
const WIDE_WEIGHT = 3;

/** The size of the meaning of a text: letters and digits, with CJK characters at a higher weight. Spaces do not count. */
function sizeOf(text: string): number {
  const wide = text.match(WIDE)?.length ?? 0;
  const other = text.replace(WIDE, "").replace(/\s+/g, "").length;
  return wide * WIDE_WEIGHT + other;
}

/** Numbers and links: a translation keeps them. */
function anchorsOf(text: string): Set<string> {
  return new Set(text.match(/https?:\/\/\S+|item:[A-Za-z0-9_-]+|\d+(?:[.,]\d+)*/g) ?? []);
}

type Info = { size: number; kind: string; anchors: Set<string>; text: string };

function infoOf(text: string): Info {
  return { size: sizeOf(text), kind: kindOf(text), anchors: anchorsOf(text), text: text.trim() };
}

/** The moves of the alignment: blocks at the left and at the right in one row, and the cost of the move itself. */
const MOVES: { left: number; right: number; cost: number }[] = [
  { left: 1, right: 1, cost: 0 },
  { left: 1, right: 0, cost: 2.5 },
  { left: 0, right: 1, cost: 2.5 },
  { left: 2, right: 1, cost: 0.9 },
  { left: 1, right: 2, cost: 0.9 },
  { left: 3, right: 1, cost: 1.8 },
  { left: 1, right: 3, cost: 1.8 },
  { left: 2, right: 2, cost: 1.4 },
];

/**
 * Rows of paired blocks by content (dynamic programming, like the Gale–Church sentence alignment):
 * - Length: the size of the right side against the size of the left side, times the size ratio of the whole texts.
 * - Kind: a heading pairs with a heading of the same level, code with code, and so on.
 * - Numbers and links: blocks that share them pair more easily. A block that is the same at both sides (kept as it is)
 *   pairs at no cost.
 */
export function alignBlocks(left: readonly string[], right: readonly string[]): Row[] {
  const n = left.length;
  const m = right.length;
  if (n === 0 || m === 0) return [{ left: [0, n], right: [0, m] }];
  const lefts = left.map(infoOf);
  const rights = right.map(infoOf);
  const total = (list: Info[]) => list.reduce((sum, info) => sum + info.size, 0);
  const ratio = Math.max(0.05, (total(rights) + 1) / (total(lefts) + 1));

  const groupCost = (a: Info[], b: Info[]): number => {
    if (a.length === 0 || b.length === 0) {
      // A block with no partner: an empty block costs nothing; a large one costs more.
      const lone = [...a, ...b];
      return lone.every((info) => info.size === 0) ? 0 : Math.min(1.5, Math.log1p(lone.reduce((sum, info) => sum + info.size, 0) / 40));
    }
    if (a.length === 1 && b.length === 1 && a[0]!.text !== "" && a[0]!.text === b[0]!.text) return -0.5;
    const sizeA = a.reduce((sum, info) => sum + info.size, 0) * ratio;
    const sizeB = b.reduce((sum, info) => sum + info.size, 0);
    let cost = 2 * Math.abs(Math.log((sizeB + 12) / (sizeA + 12)));
    // Kind: compare the first blocks; a heading in a group of more than one block is not likely.
    if (a[0]!.kind !== b[0]!.kind) cost += a[0]!.kind.startsWith("h") || b[0]!.kind.startsWith("h") || a[0]!.kind === "code" || b[0]!.kind === "code" ? 2.5 : 1;
    if (a.length + b.length > 2 && [...a, ...b].some((info) => info.kind.startsWith("h"))) cost += 1.5;
    const anchorsA = new Set(a.flatMap((info) => [...info.anchors]));
    const anchorsB = new Set(b.flatMap((info) => [...info.anchors]));
    if (anchorsA.size > 0 || anchorsB.size > 0) {
      const shared = [...anchorsA].filter((anchor) => anchorsB.has(anchor)).length;
      cost += 1 - (2 * shared) / (anchorsA.size + anchorsB.size);
    }
    return cost;
  };

  // best[i][j]: the lowest cost to align the first i left blocks with the first j right blocks.
  const best = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity));
  const from = Array.from({ length: n + 1 }, () => new Int8Array(m + 1).fill(-1));
  best[0]![0] = 0;
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      const here = best[i]![j]!;
      if (here === Infinity) continue;
      MOVES.forEach((move, index) => {
        const ni = i + move.left;
        const nj = j + move.right;
        if (ni > n || nj > m) return;
        const cost = here + move.cost + groupCost(lefts.slice(i, ni), rights.slice(j, nj));
        if (cost < best[ni]![nj]!) {
          best[ni]![nj] = cost;
          from[ni]![nj] = index;
        }
      });
    }
  }
  const path: Row[] = [];
  for (let i = n, j = m; i > 0 || j > 0; ) {
    const move = MOVES[from[i]![j]!]!;
    path.push({ left: [i - move.left, i], right: [j - move.right, j] });
    i -= move.left;
    j -= move.right;
  }
  path.reverse();
  // Each row needs a left block (the space goes after it): a right block with no partner joins a row next to it.
  const rows: Row[] = [];
  let pending: number | null = null;
  for (const row of path) {
    if (row.left[0] === row.left[1]) {
      if (rows.length > 0) rows[rows.length - 1]!.right[1] = row.right[1];
      else pending ??= row.right[0];
      continue;
    }
    rows.push({ left: [...row.left], right: [pending ?? row.right[0], row.right[1]] });
    pending = null;
  }
  return rows;
}

