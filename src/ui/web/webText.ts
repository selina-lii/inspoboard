// The readable text of a web page, with a map back to its text nodes.
// - Read-aloud gets this text. Highlights (spoken sentence, user highlights) are ranges of it.
// - Each text node keeps its length: tabs and line breaks become spaces. Thus each index maps to one place in one node.
// - A new block (paragraph, heading, list item) starts a new line. Menus, scripts, and hidden parts are not in the text.

/**
 * Parts of a page that are not text to read. Forms and aria-hidden parts are read: some sites put the whole page
 * in a form, or mark the page aria-hidden while a script shows a dialog (the saved page runs no scripts).
 */
const SKIP = "script, style, noscript, template, nav, aside, button, select, option, textarea, svg, math, iframe, [hidden]";
/** Page head and foot: not read, but text inside an article or main part is. */
const CHROME = "header, footer";

export type TextIndex = {
  text: string;
  nodes: Text[];
  /** The index in `text` of the first character of each node. */
  starts: number[];
  positions: Map<Text, number>;
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
  let text = "";
  let lastBlock: Element | null = null;
  const body = doc.body ?? doc.documentElement;
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node !== null; node = walker.nextNode() as Text | null) {
    const parent = node.parentElement;
    if (parent === null || node.data === "") continue;
    if (parent.closest(SKIP) !== null) continue;
    if (parent.closest(CHROME) !== null && parent.closest("article, main") === null) continue;
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
  return { text, nodes, starts, positions };
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
 * The text of a PDF text layer (one span for each text run, in reading order). Runs on one line join
 * (with a space if there is a gap). A new line joins with a space; a large gap, or a new page, starts a new line.
 */
export function indexPdfText(root: Element): TextIndex {
  const nodes: Text[] = [];
  const starts: number[] = [];
  const positions = new Map<Text, number>();
  let text = "";
  let last: { top: number; bottom: number; right: number; height: number; page: Element | null } | null = null;
  for (const span of root.querySelectorAll(".textLayer span")) {
    const node = [...span.childNodes].find((child): child is Text => child.nodeType === Node.TEXT_NODE);
    if (node === undefined || node.data === "") continue;
    const box = span.getBoundingClientRect();
    const page = span.closest(".pdf-page");
    if (last !== null) {
      const height = Math.max(1, Math.min(last.height, box.height));
      const sameLine = Math.abs(box.top - last.top) < height * 0.5;
      const boundarySpace = /\s$/.test(text) || /^\s/.test(node.data);
      let separator = "";
      if (page !== last.page) separator = "\n";
      else if (sameLine) separator = boundarySpace || box.left - last.right < height * 0.15 ? "" : " ";
      else if (box.top - last.bottom > height * 0.9) separator = "\n";
      else separator = boundarySpace || text.endsWith("-") ? "" : " ";
      text += separator;
    }
    positions.set(node, nodes.length);
    nodes.push(node);
    starts.push(text.length);
    text += node.data.replace(/[\t\n\r\f\v]/g, " ");
    last = { top: box.top, bottom: box.bottom, right: box.right, height: box.height, page };
  }
  return { text, nodes, starts, positions };
}
