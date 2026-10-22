// The text of a PDF for the reader (SPEC 7.8), as PDF readers keep it: from the text items of each page (pdf.js text
// content), never from the screen. The same at any zoom, scroll, or time; ready before a page is drawn.
// - The text: the items in order; items on one line join (a space where there is a gap); lines join into paragraphs
//   (pdfSeparators); numbers in a side margin (line numbers) are left out (sideNumbers). One "\n" between paragraphs.
// - Each item keeps its place on its page (page units: PDF units at scale 1, from the top left of the page). Marks
//   (highlights, find, the spoken sentence, linked passages) are boxes made from these places.
// - The text layer of pdf.js has one span for each text item with text (not for empty items), in the same order: a
//   selection maps to the text by its span (offsetOfSpan).

import { pdfSeparators, sideNumbers, type PdfLine } from "./webText";
import type { PageBox } from "./savedPages";

/** A text item of a page, as pdf.js gives it (getTextContent / streamTextContent). */
export type RawItem = { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean; fontName: string };
export type RawStyle = { fontFamily: string; ascent?: number; descent?: number; vertical?: boolean };
/** A page: its text items (only items with `str`, in order) and the transform of its viewport at scale 1. */
export type RawPage = { number: number; transform: number[]; items: RawItem[]; styles: Record<string, RawStyle> };

/** A text item with its place. `start`: its index in the text (-1: not in the text, a side number). */
export type PdfRun = { page: number; item: number; raw: string; text: string; start: number; left: number; top: number; width: number; height: number; font: string };

export type PdfText = {
  text: string;
  /** The runs in the text, in text order (the side numbers are not here). */
  runs: PdfRun[];
  /** The runs of each page (index: page - 1): one for each text item with text, in item order (as the spans of the
   *  text layer). A run that is not in the text (a side number) has start -1. */
  pages: PdfRun[][];
  /** The place in `text` of each line of the PDF (the translation joins them into paragraphs). */
  lines: { start: number; end: number }[];
};

/** The widths of texts in a font family (a canvas in the app). Without it: all characters have the same width. */
export type Measure = (text: string, font: string) => number;

/** A · B of two transforms (as pdf.js Util.transform). */
function multiply(a: readonly number[], b: readonly number[]): number[] {
  return [a[0]! * b[0]! + a[2]! * b[1]!, a[1]! * b[0]! + a[3]! * b[1]!, a[0]! * b[2]! + a[2]! * b[3]!, a[1]! * b[2]! + a[3]! * b[3]!, a[0]! * b[4]! + a[2]! * b[5]! + a[4]!, a[1]! * b[4]! + a[3]! * b[5]! + a[5]!];
}

/**
 * The text of a PDF from the text items of its pages. `normalize`: the text of an item as the text is read (pdf.js
 * normalizeUnicode: ligatures as letters, as pdf.js gives the text by default). `ascent`: the share of the font height
 * above the baseline for a font family, as the pdf.js text layer measures it (so the boxes are where the text layer
 * puts the text); without it, the ascent of the PDF font (or 0.8).
 */
export function buildPdfText(pages: readonly RawPage[], normalize: (text: string) => string = (text) => text, ascentOf?: (fontFamily: string) => number | null): PdfText {
  // The runs with their boxes, as the pdf.js text layer places its spans: the baseline, up by the ascent of the font.
  const all: PdfRun[] = [];
  const byPage: PdfRun[][] = [];
  for (const page of pages) {
    const list: PdfRun[] = [];
    page.items.forEach((item, index) => {
      if (item.str === "") return;
      const tx = multiply(page.transform, item.transform);
      const height = Math.hypot(tx[2]!, tx[3]!);
      const style = page.styles[item.fontName];
      const measured = ascentOf?.(style?.fontFamily ?? "sans-serif") ?? null;
      const ascent = measured !== null ? measured : style?.ascent !== undefined && style.ascent > 0 ? style.ascent : style?.descent !== undefined && style.descent < 0 ? 1 + style.descent : 0.8;
      const width = style?.vertical === true ? item.height : item.width;
      const run: PdfRun = { page: page.number, item: index, raw: item.str, text: normalize(item.str).replace(/[\t\n\r\f\v]/g, " "), start: -1, left: tx[4]!, top: tx[5]! - ascent * height, width, height, font: style?.fontFamily ?? "serif" };
      list.push(run);
      all.push(run);
    });
    byPage.push(list);
  }
  // Line numbers (and page numbers) in the side margins are not part of the text: they would cut each line.
  const side = sideNumbers(all.map((run) => ({ text: run.text, left: run.left, right: run.left + run.width, top: run.top, page: run.page })));
  // The runs in lines: a run on the same page at about the same height joins the line.
  const lines: { runs: PdfRun[]; box: PdfLine }[] = [];
  all.forEach((run, at) => {
    if (side[at]) return;
    const line = lines[lines.length - 1];
    const height = line === undefined ? 1 : Math.max(1, Math.min(line.box.height, run.height));
    if (line !== undefined && run.page === line.runs[0]!.page && Math.abs(run.top - line.box.top) < height * 0.5 && run.left >= line.box.left - height) {
      line.runs.push(run);
      line.box.right = Math.max(line.box.right, run.left + run.width);
      line.box.text += run.text;
      return;
    }
    lines.push({ runs: [run], box: { page: run.page, top: run.top, left: run.left, right: run.left + run.width, height: run.height, text: run.text } });
  });
  const separators = pdfSeparators(lines.map((line) => line.box));
  const runs: PdfRun[] = [];
  const lineRanges: { start: number; end: number }[] = [];
  let text = "";
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      const separator = separators[lineIndex - 1]!;
      // A soft line end: no space after a hyphen or before a space that is there.
      text += separator === " " && (/[\s-]$/.test(text) || /^\s/.test(line.runs[0]!.text)) ? "" : separator;
    }
    let last: PdfRun | null = null;
    const lineStart = text.length;
    for (const run of line.runs) {
      if (last !== null) {
        const height = Math.max(1, Math.min(last.height, run.height));
        const boundarySpace = /\s$/.test(text) || /^\s/.test(run.text);
        if (!boundarySpace && run.left - (last.left + last.width) >= height * 0.15) text += " ";
      }
      run.start = text.length;
      runs.push(run);
      text += run.text;
      last = run;
    }
    if (text.length > lineStart) lineRanges.push({ start: lineStart, end: text.length });
  });
  return { text, runs, pages: byPage, lines: lineRanges };
}

/** The index of the first run that ends after `offset`. */
function firstRunAt(runs: readonly PdfRun[], offset: number): number {
  let low = 0;
  let high = runs.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (runs[middle]!.start + runs[middle]!.text.length <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The x of a character index of a run (page units). */
function xOf(run: PdfRun, at: number, measure?: Measure): number {
  const length = run.text.length;
  if (length === 0 || at <= 0) return run.left;
  if (at >= length) return run.left + run.width;
  let share = at / length;
  if (measure !== undefined) {
    const whole = measure(run.text, run.font);
    if (whole > 0) share = measure(run.text.slice(0, at), run.font) / whole;
  }
  return run.left + run.width * share;
}

/** The boxes of a text range on the pages: [page, left, top, width, height], one for each run part. */
export function textBoxes(model: PdfText, start: number, end: number, measure?: Measure): PageBox[] {
  const boxes: PageBox[] = [];
  for (let index = firstRunAt(model.runs, start); index < model.runs.length && model.runs[index]!.start < end; index += 1) {
    const run = model.runs[index]!;
    const from = Math.max(start, run.start) - run.start;
    const to = Math.min(end, run.start + run.text.length) - run.start;
    if (to <= from) continue;
    const left = xOf(run, from, measure);
    const right = xOf(run, to, measure);
    // Parts of one line join into one box (as a selection shows them).
    const last = boxes[boxes.length - 1];
    if (last !== undefined && last[0] === run.page && Math.abs(last[2] - run.top) < run.height * 0.5 && left >= last[1] + last[3] - run.height) {
      const top = Math.min(last[2], run.top);
      const bottom = Math.max(last[2] + last[4], run.top + run.height);
      last[3] = Math.max(last[1] + last[3], right) - last[1];
      last[2] = top;
      last[4] = bottom - top;
      continue;
    }
    boxes.push([run.page, left, run.top, right - left, run.height]);
  }
  return boxes;
}

/**
 * The index in the text of a place in a span of the text layer: span `nth` of the page (the nth text item with text),
 * `rawOffset` characters into its string as the span shows it (not normalized). A span that is not in the text (a
 * side number): the next text after it.
 */
export function offsetOfSpan(model: PdfText, page: number, nth: number, rawOffset: number, normalize: (text: string) => string = (text) => text): number | null {
  const list = model.pages[page - 1];
  if (list === undefined) return null;
  const run = list[nth];
  if (run !== undefined && run.start >= 0) return run.start + Math.min(run.text.length, normalize(run.raw.slice(0, Math.max(0, rawOffset))).length);
  // The next run in the text, on this page or a later one.
  for (let number = page; number <= model.pages.length; number += 1) {
    const runs = model.pages[number - 1]!;
    for (let at = number === page ? nth + 1 : 0; at < runs.length; at += 1) if (runs[at]!.start >= 0) return runs[at]!.start;
  }
  return model.text.length;
}

/** The pages of a text range. */
export function pagesOf(model: PdfText, start: number, end: number): number[] {
  const pages = new Set<number>();
  for (let index = firstRunAt(model.runs, start); index < model.runs.length && model.runs[index]!.start < end; index += 1) pages.add(model.runs[index]!.page);
  return [...pages];
}

/** The box of each character of the runs of a page that touch an area (page units of that page), with its text index. */
export function characterBoxes(model: PdfText, page: number, touches: (box: { left: number; top: number; width: number; height: number }) => boolean, measure?: Measure): { offset: number; box: { left: number; top: number; width: number; height: number } }[] {
  const out: { offset: number; box: { left: number; top: number; width: number; height: number } }[] = [];
  for (const run of model.pages[page - 1] ?? []) {
    if (run.start < 0 || !touches({ left: run.left, top: run.top, width: run.width, height: run.height })) continue;
    for (let at = 0; at < run.text.length; at += 1) {
      const left = xOf(run, at, measure);
      out.push({ offset: run.start + at, box: { left, top: run.top, width: xOf(run, at + 1, measure) - left, height: run.height } });
    }
  }
  return out;
}
