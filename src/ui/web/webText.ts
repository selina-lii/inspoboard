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
  return { text, nodes, starts, positions, formulas };
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
 * The text of a PDF text layer (one span for each text run, in reading order).
 * - Runs on one line join (with a space if there is a gap). Lines join into paragraphs (pdfSeparators).
 * - Each paragraph is one line of the text ("\n" between paragraphs), as in a web page: a translation and
 *   read-aloud work paragraph by paragraph.
 */
export function indexPdfText(root: Element): TextIndex {
  type Run = { node: Text; box: DOMRect; page: Element | null };
  const runs: Run[] = [];
  for (const span of root.querySelectorAll(".textLayer span")) {
    const node = [...span.childNodes].find((child): child is Text => child.nodeType === Node.TEXT_NODE);
    if (node === undefined || node.data === "") continue;
    runs.push({ node, box: span.getBoundingClientRect(), page: span.closest(".pdf-page") });
  }
  // The runs in lines: a run on the same page at about the same height joins the line.
  const lines: { runs: Run[]; box: PdfLine }[] = [];
  for (const run of runs) {
    const line = lines[lines.length - 1];
    const height = line === undefined ? 1 : Math.max(1, Math.min(line.box.height, run.box.height));
    if (line !== undefined && run.page === line.runs[0]!.page && Math.abs(run.box.top - line.box.top) < height * 0.5 && run.box.left >= line.box.left - height) {
      line.runs.push(run);
      line.box.right = Math.max(line.box.right, run.box.right);
      line.box.text += run.node.data;
      continue;
    }
    lines.push({ runs: [run], box: { page: run.page, top: run.box.top, left: run.box.left, right: run.box.right, height: run.box.height, text: run.node.data } });
  }
  const separators = pdfSeparators(lines.map((line) => line.box));
  const nodes: Text[] = [];
  const starts: number[] = [];
  const positions = new Map<Text, number>();
  let text = "";
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      const separator = separators[lineIndex - 1]!;
      // A soft line end: no space after a hyphen or before a space that is there.
      text += separator === " " && (/[\s-]$/.test(text) || /^\s/.test(line.runs[0]!.node.data)) ? "" : separator;
    }
    let last: DOMRect | null = null;
    for (const run of line.runs) {
      if (last !== null) {
        const height = Math.max(1, Math.min(last.height, run.box.height));
        const boundarySpace = /\s$/.test(text) || /^\s/.test(run.node.data);
        if (!boundarySpace && run.box.left - last.right >= height * 0.15) text += " ";
      }
      positions.set(run.node, nodes.length);
      nodes.push(run.node);
      starts.push(text.length);
      text += run.node.data.replace(/[\t\n\r\f\v]/g, " ");
      last = run.box;
    }
  });
  return { text, nodes, starts, positions };
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
