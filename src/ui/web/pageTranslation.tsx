// Translation of a saved web page or PDF, in a column at the right of the page (on the reader canvas).
// - The page text (webText.ts) has one line for each block of the page. Each non-empty line is a paragraph.
// - The plugin gets the paragraphs in parts (Progress and Cancel in the plugin menu). The results show at once.
// - The column width is a setting (default 1.5 times the old 440). Drag its right edge to change it.
// - While the page is read aloud, the matching sentence of the translation is marked too.
// - Each result starts level with its paragraph on the page. If a result is longer than the space to the next
//   paragraph, the next result goes down (no overlap).
// - Results stay while the app is open (per page, plugin, and options). They are never saved.
// - The translation goes on when the page closes. Open the page again: the column shows the results so far, and
//   the rest as they come.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { usePlugins } from "../plugins/pluginsContext";
import { useSession, useSessionState } from "../app/sessionContext";
import { TRANSLATION_WIDTH_RANGE } from "../../io/settings";
import type { Range } from "../plugins/sentencePairs";
import type { Box } from "./readerShared";

export type PageParagraph = { start: number; end: number; text: string };

/** The paragraphs of a page text: its non-empty lines. */
export function pageParagraphs(text: string): PageParagraph[] {
  const result: PageParagraph[] = [];
  let at = 0;
  for (const line of text.split("\n")) {
    const lead = line.length - line.trimStart().length;
    const trimmed = line.trim();
    if (/[\p{L}\p{N}]/u.test(trimmed)) result.push({ start: at + lead, end: at + lead + trimmed.length, text: trimmed });
    at += line.length + 1;
  }
  return result;
}

type Cached = { plugin: string; optionsKey: string; texts: (string | null)[] };
/** Results of this app session, by page key. */
const cache = new Map<string, Cached>();
/** Open readers that show a page: they get each change of its results (also of a run that a closed reader started). */
const listeners = new Map<string, Set<(value: Cached) => void>>();

function publish(key: string, value: Cached): void {
  cache.set(key, value);
  for (const listener of listeners.get(key) ?? []) listener(value);
}

/** The results of a page so far (null: not translated in this app session). For the subtitle. */
export function cachedPageTexts(key: string): readonly (string | null)[] | null {
  return cache.get(key)?.texts ?? null;
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
  const run = useCallback(
    async (plugin: string) => {
      const optionsKey = plugins.resultKey(plugin);
      const before = cache.get(key);
      setShown(true);
      if (before !== undefined && before.plugin === plugin && before.optionsKey === optionsKey && before.texts.length === paragraphs.length && before.texts.every((text) => text !== null)) {
        setState(before);
        return;
      }
      let next: Cached = { plugin, optionsKey, texts: paragraphs.map(() => null) };
      publish(key, next);
      await plugins.transformList(
        plugin,
        paragraphs.map((paragraph) => paragraph.text),
        (start, results) => {
          const texts = [...next.texts];
          results.forEach((text, index) => (texts[start + index] = text));
          next = { ...next, texts };
          publish(key, next);
        },
      );
    },
    [key, paragraphs, plugins],
  );
  return { texts: shown ? (state?.texts ?? null) : null, run, hide: () => setShown(false), shown: shown && state !== null };
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
  /** The top of each paragraph on the page (page units), or null if it is not placed. */
  topOf(paragraph: PageParagraph): number | null;
  /** The layout of the page changed (zoom with a new draw, a new height): the column measures again. */
  layoutKey: string | number;
  /** The height the column needs (page units): the canvas grows if it is longer than the page. */
  onHeight(height: number): void;
  width: number;
  /** The zoom of the canvas: a drag of the edge moves in screen pixels. */
  zoom: number;
  onWidth(width: number, done: boolean): void;
  /** The sentence of the translation that matches the sentence read aloud, or null. */
  spoken: { paragraph: number; range: Range } | null;
};

/** The results, each level with its paragraph. Inside the scaled canvas layer: units are page units. */
export function TranslationColumn({ left, paragraphs, texts, topOf, layoutKey, onHeight, width, zoom, onWidth, spoken }: ColumnProps) {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const [tops, setTops] = useState<number[]>([]);
  useLayoutEffect(() => {
    let bottom = 0;
    const next = paragraphs.map((paragraph, index) => {
      const wanted = topOf(paragraph) ?? bottom;
      const top = Math.max(wanted, bottom);
      bottom = top + (refs.current[index]?.offsetHeight ?? 0) + 8;
      return top;
    });
    setTops((before) => (before.length === next.length && before.every((value, index) => Math.abs(value - next[index]!) < 0.5) ? before : next));
    onHeight(bottom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texts, paragraphs, layoutKey, width]);
  const mark = useRef<HTMLElement>(null);
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
      {paragraphs.map((paragraph, index) => {
        const text = texts[index] ?? paragraph.text;
        const range = spoken !== null && spoken.paragraph === index && texts[index] != null ? spoken.range : null;
        return (
          <div key={index} ref={(element) => void (refs.current[index] = element)} className={`translation-paragraph${texts[index] == null ? " waiting" : ""}`} style={{ top: tops[index] ?? 0 }} dir="auto">
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
          </div>
        );
      })}
      <div
        className="translation-resize"
        style={{ height: Math.max(0, ...tops.map((top, index) => top + (refs.current[index]?.offsetHeight ?? 0))) }}
        data-tip="Drag to change the width of the translation"
        onPointerDown={onResize}
      />
    </div>
  );
}

/** The top of a paragraph from its boxes. */
export function firstTop(boxes: Box[]): number | null {
  return boxes.length === 0 ? null : Math.min(...boxes.map((box) => box.top));
}
