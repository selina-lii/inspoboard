// Paragraph alignment for side-by-side results (for example a translation at the right of its text).
// - A block is a Markdown paragraph: lines up to an empty line. A heading, a list item, a quote line, a table row,
//   and a code block (fence to fence) are blocks of their own. A block keeps the empty lines after it.
// - The two texts are paired block by block. If the counts differ (the plugin joined or split blocks), the blocks
//   are paired in proportion, so that the rows stay in order.

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
