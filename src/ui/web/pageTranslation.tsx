// Translation of a saved web page or PDF, in a column at the right of the page (on the reader canvas).
// - Paragraphs come from the layout of the page, not only from its text (layoutParagraphs):
//   - A web page: each block of the page (each line of the page text) is a paragraph.
//   - A PDF: the lines of the PDF join into paragraphs by their places: the same column, a small space between them,
//     the same text size. Small parts in a line (a superscript, a part of a formula) stay in their line. A new
//     paragraph starts at a larger space, an indent, a change of column or text size, or after a short last line.
// - The column is a copy of the page layout at the width of the column: each translation is in a box at the same
//   height as its paragraph, with the same height, and at the same place across (scaled). Two columns of a PDF page
//   thus show as two columns. The text of a box is smaller if necessary, so that it fits; if it does not fit at the
//   smallest size, it scrolls in its box (while it is read aloud, the box scrolls to the marked sentence). Boxes can
//   overlap a little: a press on one brings it to the front (placedBox.tsx).
// - Only paragraphs with words are translated: page numbers, single words, and formulas are not (no box).
// - The plugin gets the paragraphs in parts (Progress and Cancel in the plugin menu). The results show at once.
// - Results stay while the app is open (per page, plugin, and options), by the text of the paragraph: a new layout
//   of the page keeps them. They are never saved. The translation goes on when the page closes.
// - The column width is a setting. Drag its right edge to change it.

import { isEquationText } from "./webText";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { usePlugins } from "../plugins/pluginsContext";
import { useSession, useSessionState } from "../app/sessionContext";
import { TRANSLATION_WIDTH_RANGE } from "../../io/settings";
import type { Range } from "../plugins/sentencePairs";
import type { Box } from "./readerShared";
import { PlacedBox, useFront } from "./placedBox";

export type PageParagraph = {
  start: number;
  end: number;
  /** The text of the paragraph, on one line. */
  text: string;
  /** The place of the paragraph on the page (page units), or null if it is not on the page. */
  box: Box | null;
  /** The height of one line of the paragraph (page units). */
  lineHeight: number;
  /** False for a paragraph with no words (a page number, a formula): it is not translated. */
  translate: boolean;
};

/** A part of the page text: a line (a block of a web page, or a line of a PDF). */
export type TextUnit = { start: number; end: number };

/** The lines of a page text that have letters or digits. */
export function textUnits(text: string): TextUnit[] {
  const units: TextUnit[] = [];
  let at = 0;
  for (const line of text.split("\n")) {
    const lead = line.length - line.trimStart().length;
    const trimmed = line.trim();
    if (/[\p{L}\p{N}]/u.test(trimmed)) units.push({ start: at + lead, end: at + lead + trimmed.length });
    at += line.length + 1;
  }
  return units;
}

/** True if a paragraph has words to translate (two words or more, not a formula). */
export function isTranslatable(text: string): boolean {
  // Each CJK character counts as a word (no spaces between words).
  const words = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|\p{L}{2,}/gu) ?? [];
  return words.length >= 2 && !isEquationText(text);
}

type Line = { start: number; end: number; box: Box; height: number };

function union(boxes: readonly Box[]): Box {
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.left + box.width));
  const bottom = Math.max(...boxes.map((box) => box.top + box.height));
  return { left, top, width: right - left, height: bottom - top };
}

const bottomOf = (box: Box) => box.top + box.height;
const rightOf = (box: Box) => box.left + box.width;

/**
 * The paragraphs of a page: the units with their places (`boxesOf`: the boxes of a text range, page units).
 * `merge`: join lines into paragraphs by their places (a PDF). Else each unit is a paragraph (a web page).
 */
export function layoutParagraphs(text: string, units: readonly TextUnit[], boxesOf: (start: number, end: number) => Box[], merge: boolean): PageParagraph[] {
  const lines: Line[] = [];
  for (const unit of units) {
    const boxes = boxesOf(unit.start, unit.end).filter((box) => box.width > 0 && box.height > 0);
    if (boxes.length === 0) continue;
    const heights = boxes.map((box) => box.height).sort((a, b) => a - b);
    lines.push({ ...unit, box: union(boxes), height: heights[Math.floor(heights.length / 2)]! });
  }
  type Open = { start: number; end: number; box: Box; last: Box; lineHeight: number; lines: number };
  const groups: Open[] = [];
  for (const line of lines) {
    const current = groups[groups.length - 1];
    if (merge && current !== undefined && joins(current, line)) {
      current.end = line.end;
      current.box = union([current.box, line.box]);
      const overlap = Math.min(bottomOf(current.last), bottomOf(line.box)) - Math.max(current.last.top, line.box.top);
      // A part of the same line (it overlaps the line in height) widens that line; else it is the next line.
      if (overlap > 0) current.last = union([current.last, line.box]);
      else {
        current.last = line.box;
        current.lines += 1;
      }
      continue;
    }
    groups.push({ start: line.start, end: line.end, box: line.box, last: line.box, lineHeight: line.height, lines: 1 });
  }
  return groups.map((group) => {
    const value = text.slice(group.start, group.end).replace(/\s*\n\s*/g, " ").trim();
    return { start: group.start, end: group.end, text: value, box: group.box, lineHeight: group.lineHeight, translate: isTranslatable(value) };
  });
}

/** True if a PDF line continues the open paragraph. */
function joins(paragraph: { box: Box; last: Box; lineHeight: number; lines: number }, line: Line): boolean {
  const height = Math.max(1, paragraph.lineHeight);
  const last = paragraph.last;
  // A part of the last line (a superscript, a part of a formula): it overlaps that line in height, near it across.
  const overlap = Math.min(bottomOf(last), bottomOf(line.box)) - Math.max(last.top, line.box.top);
  const near = line.box.left <= rightOf(last) + height * 2 && rightOf(line.box) >= last.left - height * 2;
  if (overlap > Math.min(last.height, line.box.height) * 0.3 && near) return true;
  // The same column: the line overlaps the paragraph across.
  if (line.box.left >= rightOf(paragraph.box) - 2 || rightOf(line.box) <= paragraph.box.left + 2) return false;
  const gap = line.box.top - bottomOf(last);
  // Above the last line (an other column, or text out of order), or a larger space: a new paragraph.
  if (gap < -height * 0.5 || gap > height * 0.75) return false;
  // An other text size (a heading and its text).
  if (Math.abs(line.height - height) > height * 0.3) return false;
  // An indent: the first line of a new paragraph.
  if (line.box.left - paragraph.box.left > height * 0.8) return false;
  // A short last line: the paragraph ended there.
  if (rightOf(last) < rightOf(paragraph.box) - height * 4) return false;
  return true;
}

/** `partial`: texts with only the text so far of a run that did not end: a new run translates them again. */
type Cached = { plugin: string; optionsKey: string; byText: Map<string, string>; partial: Set<string> };
/** Results of this app session, by page key. */
const cache = new Map<string, Cached>();
/** The paragraphs of each page that shows a translation (for the subtitle of read aloud). */
const shownParagraphs = new Map<string, readonly PageParagraph[]>();
/** Open readers that show a page: they get each change of its results (also of a run that a closed reader started). */
const listeners = new Map<string, Set<(value: Cached) => void>>();

function publish(key: string, value: Cached): void {
  cache.set(key, value);
  for (const listener of listeners.get(key) ?? []) listener(value);
}

function textsOf(value: Cached | null | undefined, paragraphs: readonly PageParagraph[]): (string | null)[] | null {
  if (value == null) return null;
  return paragraphs.map((paragraph) => (paragraph.translate ? (value.byText.get(paragraph.text) ?? null) : paragraph.text));
}

/** The paragraphs and results of a page so far (null: not translated in this app session). For the subtitle. */
export function cachedPageTranslation(key: string): { paragraphs: readonly PageParagraph[]; texts: readonly (string | null)[] } | null {
  const paragraphs = shownParagraphs.get(key);
  const texts = paragraphs === undefined ? null : textsOf(cache.get(key), paragraphs);
  return paragraphs === undefined || texts === null ? null : { paragraphs, texts };
}

/** The translation of one page: its results (or null), and run / hide. */
export function usePageTranslation(key: string, paragraphs: readonly PageParagraph[]) {
  const plugins = usePlugins();
  const [state, setState] = useState<Cached | null>(() => cache.get(key) ?? null);
  const [shown, setShown] = useState(() => cache.has(key));
  useEffect(() => {
    const listener = (value: Cached) => setState(value);
    const set = listeners.get(key) ?? new Set();
    set.add(listener);
    listeners.set(key, set);
    // A run that went on while the reader was closed.
    if (cache.has(key)) setState(cache.get(key)!);
    return () => void set.delete(listener);
  }, [key]);
  useEffect(() => {
    shownParagraphs.set(key, paragraphs);
  }, [key, paragraphs]);
  const run = useCallback(
    async (plugin: string) => {
      const optionsKey = plugins.resultKey(plugin);
      const before = cache.get(key);
      setShown(true);
      let next: Cached = before !== undefined && before.plugin === plugin && before.optionsKey === optionsKey ? before : { plugin, optionsKey, byText: new Map(), partial: new Set() };
      publish(key, next);
      const pending = [...new Set(paragraphs.filter((paragraph) => paragraph.translate && (!next.byText.has(paragraph.text) || next.partial.has(paragraph.text))).map((paragraph) => paragraph.text))];
      if (pending.length === 0) return;
      await plugins.transformList(plugin, pending, (start, results, partial = false) => {
        const byText = new Map(next.byText);
        const partials = new Set(next.partial);
        results.forEach((text, offset) => {
          const source = pending[start + offset]!;
          byText.set(source, text);
          if (partial) partials.add(source);
          else partials.delete(source);
        });
        next = { ...next, byText, partial: partials };
        publish(key, next);
      });
    },
    [key, paragraphs, plugins],
  );
  const texts = shown ? textsOf(state, paragraphs) : null;
  return { texts, run, hide: () => setShown(false), shown: shown && state !== null };
}

/** The space between the translation column and the page (or its margin), in page units. */
export const COLUMN = { gap: 28 } as const;

/** The width of the translation column (page units): the setting, or the width during a drag of its edge. */
export function useColumnWidth() {
  const session = useSession();
  const saved = useSessionState().settings.translationWidth;
  const [dragged, setDragged] = useState<number | null>(null);
  const onWidth = useCallback(
    (width: number, done: boolean) => {
      const value = Math.round(Math.min(TRANSLATION_WIDTH_RANGE.max, Math.max(TRANSLATION_WIDTH_RANGE.min, width)));
      if (!done) setDragged(value);
      else void session.updateSettings({ translationWidth: value }).finally(() => setDragged(null));
    },
    [session],
  );
  return { width: dragged ?? saved, onWidth };
}

type ColumnProps = {
  /** The left edge of the column in canvas units (from the left of the canvas). */
  left: number;
  paragraphs: readonly PageParagraph[];
  texts: readonly (string | null)[];
  /** The width of the page (page units): the column is the page layout at its own width. */
  pageWidth: number;
  /** The height the column needs (page units): the canvas grows if it is longer than the page. */
  onHeight(height: number): void;
  width: number;
  /** The zoom of the canvas: a drag of the edge moves in screen pixels. */
  zoom: number;
  onWidth(width: number, done: boolean): void;
  /** The sentence of the translation that matches the sentence read aloud, or null. */
  spoken: { paragraph: number; range: Range } | null;
};

/** A box is at least this wide (page units), if the column has the room. */
const MIN_BOX_WIDTH = 140;

/** The results, each in a box at the place of its paragraph. Inside the scaled canvas layer: units are page units. */
export function TranslationColumn({ left, paragraphs, texts, pageWidth, onHeight, width, zoom, onWidth, spoken }: ColumnProps) {
  const scale = width / Math.max(1, pageWidth);
  const placed = paragraphs.flatMap((paragraph, index) => (paragraph.box !== null && paragraph.translate ? [{ paragraph, index, box: paragraph.box }] : []));
  const height = Math.max(0, ...placed.map(({ box }) => bottomOf(box)));
  const { front, bringToFront } = useFront();
  useLayoutEffect(() => onHeight(height), [height, onHeight]);
  const onResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const at = (next: PointerEvent) => width + (next.clientX - startX) / Math.max(0.05, zoom);
    const move = (next: PointerEvent) => onWidth(at(next), false);
    const up = (next: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      onWidth(at(next), true);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  return (
    <div className="translation-column" style={{ left, width }}>
      {placed.map(({ paragraph, index, box }) => {
        const boxLeft = Math.min(box.left * scale, Math.max(0, width - MIN_BOX_WIDTH));
        return (
          <TranslationBox
            key={`${index}:${paragraph.start}`}
            text={texts[index] ?? paragraph.text}
            waiting={texts[index] == null}
            range={spoken !== null && spoken.paragraph === index && texts[index] != null ? spoken.range : null}
            top={box.top}
            left={boxLeft}
            width={Math.min(width - boxLeft, Math.max(box.width * scale, MIN_BOX_WIDTH))}
            height={Math.max(box.height, paragraph.lineHeight * 1.2)}
            fontSize={Math.min(20, Math.max(10, paragraph.lineHeight * 0.8))}
            inFront={front === `${index}`}
            onFront={() => bringToFront(`${index}`)}
          />
        );
      })}
      <div className="translation-resize" style={{ height }} data-tip="Drag to change the width of the translation" onPointerDown={onResize} />
    </div>
  );
}

type BoxProps = { text: string; waiting: boolean; range: Range | null; top: number; left: number; width: number; height: number; fontSize: number; inFront: boolean; onFront(): void };

/** One translation (placedBox.tsx: it fits its box, then it scrolls; a press brings it to the front). */
function TranslationBox({ text, waiting, range, top, left, width, height, fontSize, inFront, onFront }: BoxProps) {
  const frame = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLElement>(null);
  // The sentence that is read aloud: the box scrolls (inside) so that the marked text is in view.
  const rangeKey = range === null ? null : range.start;
  useEffect(() => {
    const element = mark.current;
    const box = frame.current;
    if (element == null || box == null || box.scrollHeight <= box.clientHeight) return;
    const at = element.offsetTop - box.offsetTop;
    if (at < box.scrollTop || at + element.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTo({ top: Math.max(0, at - box.clientHeight / 3), behavior: "smooth" });
  }, [rangeKey]);
  return (
    <PlacedBox className={`translation-paragraph boxed${waiting ? " waiting" : ""}`} top={top} left={left} width={width} height={height} fontSize={fontSize} fitKey={text} inFront={inFront} onFront={onFront} frameRef={frame}>
      {range === null ? (
        text
      ) : (
        <>
          {text.slice(0, range.start)}
          <mark ref={mark} className="translation-spoken">
            {text.slice(range.start, range.end)}
          </mark>
          {text.slice(range.end)}
        </>
      )}
    </PlacedBox>
  );
}
