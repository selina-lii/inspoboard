// The readable text of a web page, with a map back to its text nodes.
// - Read-aloud gets this text. Highlights (spoken sentence, user highlights) are ranges of it.
// - Each text node keeps its length: tabs and line breaks become spaces. Thus each index maps to one place in one node.
// - A new block (paragraph, heading, list item) starts a new line. Menus, scripts, and hidden parts are not in the text.
// - A formula (MathML, as KaTeX, MathJax, and Wikipedia make it) is one place in the text: its first text node. The
//   index keeps its LaTeX source (the TeX annotation) or its MathML, so that read-aloud can say it as words.
//   The pictures of a formula (KaTeX HTML, a fallback image) are not read.

import type { Formula } from "../plugins/formulas";

/**
 * Parts of a page that are not text to read. Forms and aria-hidden parts are read: some sites put the whole page
 * in a form, or mark the page aria-hidden while a script shows a dialog (the saved page runs no scripts).
 */
const SKIP = "script, style, noscript, template, nav, aside, button, select, option, textarea, svg, iframe, [hidden], .katex-html, .MathJax_Preview";
/** Page head and foot: not read, but text inside an article or main part is. */
const CHROME = "header, footer";

export type TextIndex = {
  text: string;
  nodes: Text[];
  /** The index in `text` of the first character of each node. */
  starts: number[];
  positions: Map<Text, number>;
  /** The formulas of the page (web pages only). */
  formulas?: Formula[];
  /** The visible element of each formula (same order): its box places the formula note. The text of a formula is
   *  its MathML, which KaTeX and MathJax keep hidden (a box of 1 px), so its text range has no useful place. */
  formulaElements?: Element[];
  /** A PDF: the place in `text` of each line of the PDF (the translation joins them into paragraphs by their places). */
  lines?: { start: number; end: number }[];
};

export function indexText(doc: Document): TextIndex {
  const view = doc.defaultView;
  const visible = new Map<Element, boolean>();
  const isVisible = (element: Element): boolean => {
    let known = visible.get(element);
    if (known === undefined) {
      const style = view?.getComputedStyle(element);
      // Only display: none hides text. Some pages hide their text (visibility, opacity) until a script runs.
      known = style === undefined || style.display !== "none";
      if (known && element.parentElement !== null) known = isVisible(element.parentElement);
      visible.set(element, known);
    }
    return known;
  };
  const blocks = new Map<Element, Element>();
  const blockOf = (element: Element): Element => {
    let block = blocks.get(element);
    if (block === undefined) {
      const display = view?.getComputedStyle(element).display ?? "block";
      block = !display.startsWith("inline") && display !== "contents" ? element : element.parentElement === null ? doc.documentElement : blockOf(element.parentElement);
      blocks.set(element, block);
    }
    return block;
  };
  const nodes: Text[] = [];
  const starts: number[] = [];
  const positions = new Map<Text, number>();
  const formulas: Formula[] = [];
  const formulaElements: Element[] = [];
  const doneMath = new Set<Element>();
  let text = "";
  let lastBlock: Element | null = null;
  const body = doc.body ?? doc.documentElement;
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node !== null; node = walker.nextNode() as Text | null) {
    const parent = node.parentElement;
    if (parent === null || node.data === "") continue;
    if (parent.closest(SKIP) !== null) continue;
    if (parent.closest(CHROME) !== null && parent.closest("article, main") === null) continue;
    const math = parent.closest("math");
    if (math !== null) {
      // Only the first text node of a formula is in the text. A formula is visible if its wrapper is (Wikipedia
      // hides the MathML and shows a picture).
      if (doneMath.has(math) || node.data.trim() === "") continue;
      const wrapper = math.closest(".katex, .mwe-math-element, mjx-container, .MathJax") ?? math;
      if (!isVisible(wrapper)) continue;
      doneMath.add(math);
      const tex = math.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
      if (text !== "" && !/\s$/.test(text)) text += " ";
      positions.set(node, nodes.length);
      nodes.push(node);
      starts.push(text.length);
      const start = text.length;
      text += node.data.replace(/[\t\n\r\f\v]/g, " ");
      const display = math.getAttribute("display") === "block";
      formulas.push(tex !== undefined && tex !== "" ? { start, end: text.length, tex, display } : { start, end: text.length, mathml: math.outerHTML, display });
      formulaElements.push(wrapper);
      text += " ";
      continue;
    }
    if (!isVisible(parent)) continue;
    const block = blockOf(parent);
    if (lastBlock !== null && block !== lastBlock && node.data.trim() !== "") {
      if (!text.endsWith("\n")) text += "\n";
    }
    if (node.data.trim() !== "") lastBlock = block;
    positions.set(node, nodes.length);
    nodes.push(node);
    starts.push(text.length);
    text += node.data.replace(/[\t\n\r\f\v]/g, " ");
  }
  return { text, nodes, starts, positions, formulas, formulaElements };
}

/** The text index of a DOM position (for example the caret at a click). Null if it is not in the text. */
export function offsetAt(index: TextIndex, node: Node, offset: number): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const at = index.positions.get(node as Text);
    if (at !== undefined) return index.starts[at]! + Math.min(offset, (node as Text).data.length);
    // Text that is not in the index (for example a menu): the next indexed text after it.
    const doc = node.ownerDocument!;
    const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT);
    walker.currentNode = node;
    for (let next = walker.nextNode() as Text | null; next !== null; next = walker.nextNode() as Text | null) {
      const position = index.positions.get(next);
      if (position !== undefined) return index.starts[position]!;
    }
    return null;
  }
  // An element position: the first indexed text node at or after it.
  const doc = node.ownerDocument ?? (node as Document);
  const child = node.childNodes[offset] ?? node;
  const walker = doc.createTreeWalker(child, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode() as Text | null; text !== null; text = walker.nextNode() as Text | null) {
    const at = index.positions.get(text);
    if (at !== undefined) return index.starts[at]!;
  }
  return null;
}

/** The node that holds a text index: the last node that starts at or before it. */
function nodeAt(index: TextIndex, offset: number, preferNext: boolean): number {
  let low = 0;
  let high = index.nodes.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (index.starts[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  // At the end of a node (or on an added line break): the next node, for a range start.
  const end = index.starts[low]! + index.nodes[low]!.data.length;
  if (preferNext && offset >= end && low + 1 < index.nodes.length) return low + 1;
  return low;
}

/** A DOM range for a text range. Null if the index has no text. */
export function rangeOf(index: TextIndex, start: number, end: number): Range | null {
  if (index.nodes.length === 0 || end <= start) return null;
  const doc = index.nodes[0]!.ownerDocument;
  const first = nodeAt(index, start, true);
  const last = nodeAt(index, Math.max(start, end - 1), false);
  const range = doc.createRange();
  const startNode = index.nodes[first]!;
  const endNode = index.nodes[last]!;
  range.setStart(startNode, Math.max(0, Math.min(startNode.data.length, start - index.starts[first]!)));
  range.setEnd(endNode, Math.max(0, Math.min(endNode.data.length, end - index.starts[last]!)));
  return range;
}

/**
 * Which runs are numbers in a side margin: line numbers of a manuscript, or a page number at the side. Content must
 * never go: a run is left out only if all of these are true.
 * - It is only a number (1 to 4 digits), all left of the text column of its page or all right of it. The text column:
 *   from the left end to the right end of the page's long runs (15 characters or more).
 * - On its side of the page, it is the only such number and it is above or below all the long runs (a page number at
 *   a corner), or it is in a straight column of 3 or more
 *   such numbers (same left edge, within 3 px) that count up from the top down (line numbers). A table or the
 *   numbers of a figure that stick out of the column do not count up like that: they stay.
 */
export function sideNumbers(runs: readonly { text: string; left: number; right: number; top: number; page: unknown }[]): boolean[] {
  const columns = new Map<unknown, { left: number; right: number; top: number; bottom: number }>();
  for (const run of runs) {
    if (run.text.trim().length < 15) continue;
    const column = columns.get(run.page);
    columns.set(
      run.page,
      column === undefined
        ? { left: run.left, right: run.right, top: run.top, bottom: run.top }
        : { left: Math.min(column.left, run.left), right: Math.max(column.right, run.right), top: Math.min(column.top, run.top), bottom: Math.max(column.bottom, run.top) },
    );
  }
  // The candidates on each side of each page.
  const groups = new Map<string, number[]>();
  const pageIds = new Map<unknown, number>();
  runs.forEach((run, at) => {
    const column = columns.get(run.page);
    if (column === undefined || !/^\s*\d{1,4}\s*$/.test(run.text)) return;
    const side = run.right <= column.left ? "left" : run.left >= column.right ? "right" : null;
    if (side === null) return;
    if (!pageIds.has(run.page)) pageIds.set(run.page, pageIds.size);
    const key = `${pageIds.get(run.page)}:${side}`;
    groups.set(key, [...(groups.get(key) ?? []), at]);
  });
  const out = runs.map(() => false);
  for (const members of groups.values()) {
    if (members.length === 1) {
      const run = runs[members[0]!]!;
      const column = columns.get(run.page)!;
      out[members[0]!] = run.top < column.top || run.top > column.bottom;
      continue;
    }
    // Straight columns: the same left edge. Each must count up from the top down.
    const rails: number[][] = [];
    for (const at of members) {
      const rail = rails.find((list) => Math.abs(runs[list[0]!]!.left - runs[at]!.left) <= 3);
      if (rail !== undefined) rail.push(at);
      else rails.push([at]);
    }
    for (const rail of rails) {
      if (rail.length < 3) continue;
      const ordered = [...rail].sort((a, b) => runs[a]!.top - runs[b]!.top).map((at) => Number(runs[at]!.text.trim()));
      if (ordered.every((value, index) => index === 0 || value > ordered[index - 1]!)) for (const at of rail) out[at] = true;
    }
  }
  return out;
}

/** One line of a PDF page, in screen units. */
export type PdfLine = { page: unknown; top: number; left: number; right: number; height: number; text: string };

/**
 * True if a text is an equation: most of it is math (math letters such as 𝑃 𝑿, Greek letters, operators, arrows,
 * digits, brackets), and it has few words (at most one word of 4 or more letters, as "where"). PDFs keep
 * formulas as such glyphs, not as LaTeX.
 */
export function isEquationText(text: string): boolean {
  const chars = [...text.replace(/\s+/g, "")];
  if (chars.length < 3) return false;
  const math = chars.filter((char) => MATH_CHAR.test(char)).length;
  const words = text.match(/[A-Za-zÀ-ɏ]{4,}/g)?.length ?? 0;
  const styled = chars.filter((char) => STYLED_MATH.test(char)).length;
  return words <= 1 && (math / chars.length >= 0.5 || (styled >= 2 && math / chars.length >= 0.3));
}
/** Math glyphs: styled math letters, Greek, operators, arrows, sub/superscripts, digits, brackets, and = + − × / ^ _. */
const MATH_CHAR = /[\u{1d400}-\u{1d7ff}Ͱ-Ͽ∀-⋿←-⇿⟀-⟯⦀-⫿⁰-₟²³¹±×÷′-‷∑∫0-9=+\-−*/^_()[\]{}|∣<>,.;:!]/u;
/** Styled math letters (𝑃, 𝑿, 𝒙): only formulas use them. */
const STYLED_MATH = /[\u{1d400}-\u{1d7ff}]/u;

const WIDE_END = /[⺀-鿿가-힯＀-￯]$/u;
const WIDE_START = /^[⺀-鿿가-힯＀-￯]/u;
const LIST_START = /^\s*([•●▪◦‣∙·–—-]\s|\(?\d{1,3}[.)]\s|\(?[a-z][.)]\s|\[\d{1,3}\]\s)/u;
const SENTENCE_END = /[.!?:;。！？：；…"”'’)）]\s*$/u;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * The separator after each line (but the last): "\n" where a paragraph ends, else " " (or "" between CJK lines).
 * Each page has its own measures: the usual distance from line to line, and the right edge of each column.
 * A paragraph ends at:
 * - a new page, or a new column (the next line is higher up, or far to the side);
 * - more space than usual before the next line, or a change of the font size (a heading);
 * - a short line (it ends before the right edge of its column), for example the last line of a paragraph;
 * - an indented next line (a first-line indent), or a next line that starts as a list item;
 * - an equation line (mostly math glyphs): it is a paragraph of its own. The pieces of one equation (a fraction, an
 *   index above or below, a second line close under it) join it.
 */
export function pdfSeparators(lines: readonly PdfLine[]): string[] {
  const separators: string[] = [];
  // The measures of each page.
  const pages = new Map<unknown, PdfLine[]>();
  for (const line of lines) pages.set(line.page, [...(pages.get(line.page) ?? []), line]);
  const pitch = new Map<unknown, number>();
  for (const [page, list] of pages) {
    const steps: number[] = [];
    for (let index = 1; index < list.length; index += 1) {
      const a = list[index - 1]!;
      const b = list[index]!;
      const step = b.top - a.top;
      if (step > 0 && step < a.height * 3 && Math.abs(b.left - a.left) < a.height * 3 && Math.abs(b.height - a.height) < a.height * 0.2) steps.push(step);
    }
    pitch.set(page, median(steps));
  }
  /** The right edge of the column of a line: the right end of the long lines that start near its left edge. */
  const columnRight = (line: PdfLine): number => {
    const near = (pages.get(line.page) ?? []).filter((other) => Math.abs(other.left - line.left) < line.height * 4 && other.right > line.left);
    return Math.max(line.right, median(near.map((other) => other.right).filter((right) => right >= median(near.map((value) => value.right)))) || line.right);
  };
  for (let index = 1; index < lines.length; index += 1) {
    const a = lines[index - 1]!;
    const b = lines[index]!;
    const height = Math.max(1, Math.min(a.height, b.height));
    const usual = pitch.get(a.page) ?? 0;
    const step = b.top - a.top;
    const width = Math.max(1, columnRight(a) - a.left);
    const equationA = isEquationText(a.text);
    const equationB = isEquationText(b.text);
    // Two pieces of one equation: both math, close (they overlap in height, or the next one starts within 1.6 lines).
    const sameEquation = equationA && equationB && b.page === a.page && step > -height * 1.5 && step < height * 1.6;
    // A small line beside an equation (an index above or below it): part of the equation.
    const piece = b.page === a.page && Math.abs(step) < height * 1.2 && (equationA || equationB) && Math.min(a.height, b.height) < Math.max(a.height, b.height) * 0.85 && isEquationText(`${a.text}${b.text}`);
    if (sameEquation || piece) {
      separators.push(" ");
      continue;
    }
    const breakHere =
      equationA ||
      equationB ||
      b.page !== a.page ||
      step < -height * 0.5 ||
      Math.abs(b.left - a.left) > width * 0.5 ||
      Math.abs(b.height - a.height) > height * 0.2 ||
      (usual > 0 ? step > usual * 1.35 : step > height * 1.9) ||
      (columnRight(a) - a.right > Math.max(height * 2, width * 0.12) && !/-$/.test(a.text.trimEnd())) ||
      (b.left - a.left > height * 0.8 && b.left - a.left < height * 6 && SENTENCE_END.test(a.text)) ||
      LIST_START.test(b.text);
    separators.push(breakHere ? "\n" : WIDE_END.test(a.text.trimEnd()) && WIDE_START.test(b.text.trimStart()) ? "" : " ");
  }
  return separators;
}
