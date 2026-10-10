// Marks of an item (a note or a page): highlights and scribbles on its text. See docs/SPEC.md section 7.5.
// - They are in marks/<item id>.json, never in the item text. The format is the same as the notes of a web page.
// - A highlight keeps its text range and its text (to find it again if the text changed outside the editor).
//   Edits in the editor move it.
// - A scribble keeps its points in the coordinates of the text area (CSS pixels from its top left). On a text page,
//   the pen draws on the whole width of the page: a point in a margin has x < 0 or x > the text width.
//   If the text area gets narrower or wider, the text flows again and a scribble can move away from its words.
// - The lasso selects scribbles (draw around them). Drag a selected scribble to move all selected ones; Delete removes them.
// - Each change by the user is one step of the app undo history: the same history as the text, comments, and notes of
//   the page. (The moves of highlights by text edits are no steps: the text steps undo them.)

import { Eraser, Highlighter, Lasso, PenLine } from "lucide-react";
import { nanoid } from "nanoid";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Id } from "../../core/types";
import { useSession, useSessionState } from "../app/sessionContext";
import { EMPTY_NOTES, encodeNotes, marksPath, NOTE_COLORS, pathOf, placeHighlight, readNotes, type NoteColor, type WebNotes } from "../web/savedPages";
import type { MarkRange } from "../editor/marks";
import { isTextTarget } from "../app/dom";

export type MarkMode = "none" | "highlight" | "pen" | "erase" | "lasso";

export type MarksValue = {
  itemId: Id;
  notes: WebNotes;
  mode: MarkMode;
  color: NoteColor;
  readOnly: boolean;
  setMode(mode: MarkMode): void;
  setColor(color: NoteColor): void;
  addHighlight(from: number, to: number, text: string): void;
  removeHighlight(id: string): void;
  /** The editor moved the highlights (edits). `text` is the new item text. */
  moveHighlights(ranges: readonly MarkRange[], text: string): void;
  addScribble(points: [number, number][]): void;
  removeScribble(id: string): void;
  /** The scribbles that the lasso selected. */
  selected: ReadonlySet<string>;
  select(ids: ReadonlySet<string>): void;
  moveScribbles(ids: ReadonlySet<string>, dx: number, dy: number): void;
  removeScribbles(ids: ReadonlySet<string>): void;
  /** True if a text page draws the scribbles on its whole width (the editor then draws none). */
  pageLayer: boolean;
  /** The highlights placed in a text (by range, or by their quote). */
  rangesIn(text: string): MarkRange[];
};

const MarksContext = createContext<MarksValue | null>(null);

/** The marks of the item of this view, or null (for example, in the document view). */
export function useMarks(): MarksValue | null {
  return useContext(MarksContext);
}

export const INK: Record<NoteColor, string> = { yellow: "#e6b800", green: "#28a745", pink: "#ff375f", blue: "#0a84ff" };

export function MarksProvider({ itemId, pageLayer = false, children }: { itemId: Id; pageLayer?: boolean; children: ReactNode }) {
  const session = useSession();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const { readOnly } = useSessionState();
  const [notes, setNotes] = useState<WebNotes>(EMPTY_NOTES);
  const [mode, setMode] = useState<MarkMode>("none");
  const [color, setColor] = useState<NoteColor>("yellow");
  const latest = useRef(notes);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<WebNotes | null>(null);

  useEffect(() => {
    let live = true;
    void session
      .readWebFile(marksPath(itemId))
      .then((text) => {
        if (!live) return;
        latest.current = readNotes(text);
        setNotes(latest.current);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [session, itemId]);

  const write = useCallback((next: WebNotes) => void session.writeWebFile(marksPath(itemId), encodeNotes(next)).catch(() => undefined), [session, itemId]);
  /** Shows and saves notes. No undo step (see `change`). */
  const apply = useCallback(
    (next: WebNotes) => {
      if (readOnly) return;
      latest.current = next;
      setNotes(next);
      pending.current = next;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        pending.current = null;
        write(next);
      }, 400);
    },
    [readOnly, write],
  );
  /** A change by the user: one step of the app undo history. */
  const change = useCallback(
    (next: WebNotes, label: string) => {
      if (readOnly) return;
      const before = latest.current;
      apply(next);
      session.history.recordView(label, { undo: () => apply(before), redo: () => apply(next) });
    },
    [readOnly, apply, session],
  );
  // Closing the view saves at once.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (pending.current !== null) write(pending.current);
    },
    [write],
  );
  // Esc ends a tool (and the lasso selection). Delete removes the selected scribbles.
  useEffect(() => {
    if (mode === "none" && selected.size === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMode("none");
        setSelected(new Set());
      } else if ((event.key === "Delete" || event.key === "Backspace") && selected.size > 0 && !isTextTarget(event.target)) {
        event.preventDefault();
        change({ ...latest.current, scribbles: latest.current.scribbles.filter((scribble) => !selected.has(scribble.id)) }, "Delete scribbles");
        setSelected(new Set());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, selected, change]);
  // A different tool ends the lasso selection.
  useEffect(() => {
    if (mode !== "lasso") setSelected(new Set());
  }, [mode]);

  const value: MarksValue = {
    itemId,
    notes,
    mode,
    color,
    readOnly,
    setMode,
    setColor,
    addHighlight: (from, to, text) => change({ ...latest.current, highlights: [...latest.current.highlights, { id: nanoid(10), start: from, end: to, quote: text.slice(from, to), color }] }, "Highlight"),
    removeHighlight: (id) => change({ ...latest.current, highlights: latest.current.highlights.filter((highlight) => highlight.id !== id) }, "Remove highlight"),
    moveHighlights: (ranges, text) => {
      const byId = new Map(ranges.map((range) => [range.id, range]));
      const highlights = latest.current.highlights.flatMap((highlight) => {
        const range = byId.get(highlight.id);
        if (range === undefined) return [];
        return [{ ...highlight, start: range.from, end: range.to, quote: text.slice(range.from, range.to) }];
      });
      const same = highlights.length === latest.current.highlights.length && highlights.every((highlight, index) => {
        const before = latest.current.highlights[index]!;
        return before.start === highlight.start && before.end === highlight.end;
      });
      if (!same) apply({ ...latest.current, highlights });
    },
    addScribble: (points) => change({ ...latest.current, scribbles: [...latest.current.scribbles, { id: nanoid(10), points, color, width: 2.5 }] }, "Scribble"),
    removeScribble: (id) => change({ ...latest.current, scribbles: latest.current.scribbles.filter((scribble) => scribble.id !== id) }, "Erase scribble"),
    selected,
    select: setSelected,
    moveScribbles: (ids, dx, dy) =>
      change(
        {
          ...latest.current,
          scribbles: latest.current.scribbles.map((scribble) =>
            ids.has(scribble.id) ? { ...scribble, points: scribble.points.map(([x, y]) => [Math.round((x + dx) * 10) / 10, Math.round((y + dy) * 10) / 10] as [number, number]) } : scribble,
          ),
        },
        "Move scribbles",
      ),
    removeScribbles: (ids) => change({ ...latest.current, scribbles: latest.current.scribbles.filter((scribble) => !ids.has(scribble.id)) }, "Delete scribbles"),
    pageLayer,
    rangesIn: (text) =>
      latest.current.highlights.flatMap((highlight) => {
        const placed = placeHighlight(text, highlight);
        return placed === null ? [] : [{ id: highlight.id, from: placed.start, to: placed.end, color: highlight.color }];
      }),
  };
  return <MarksContext.Provider value={value}>{children}</MarksContext.Provider>;
}

/**
 * The mark tools for a page head or a window bar: highlight (a click highlights the selected text; with no selection,
 * the tool stays on and each selection gets a highlight), pen, eraser, and the color.
 */
export function MarkTools({ compact = false, onHighlightSelection }: { compact?: boolean; onHighlightSelection(): boolean }) {
  const marks = useMarks();
  if (marks === null || marks.readOnly) return null;
  const size = compact ? 14 : 16;
  const toggle = (mode: MarkMode) => marks.setMode(marks.mode === mode ? "none" : mode);
  return (
    <span className="mark-tools">
      <button
        className={`icon-button${compact ? " small" : ""}${marks.mode === "highlight" ? " active" : ""}`}
        data-tip="Highlight: the selected text, or each selection until Esc"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (marks.mode !== "highlight" && onHighlightSelection()) return;
          toggle("highlight");
        }}
      >
        <Highlighter size={size} />
      </button>
      <button className={`icon-button${compact ? " small" : ""}${marks.mode === "pen" ? " active" : ""}`} data-tip="Pen: draw on the text (Esc ends)" onClick={() => toggle("pen")}>
        <PenLine size={size} />
      </button>
      <button className={`icon-button${compact ? " small" : ""}${marks.mode === "erase" ? " active" : ""}`} data-tip="Eraser: click a highlight or a scribble" onClick={() => toggle("erase")}>
        <Eraser size={size} />
      </button>
      <button className={`icon-button${compact ? " small" : ""}${marks.mode === "lasso" ? " active" : ""}`} data-tip="Lasso: draw around scribbles, then drag them or press Delete" onClick={() => toggle("lasso")}>
        <Lasso size={size} />
      </button>
      {marks.mode !== "none" && marks.mode !== "erase" && marks.mode !== "lasso" && (
        <span className="mark-colors">
          {NOTE_COLORS.map((name) => (
            <button key={name} className={`mark-color${marks.color === name ? " active" : ""}`} style={{ background: INK[name] }} aria-label={name} onClick={() => marks.setColor(name)} />
          ))}
        </span>
      )}
    </span>
  );
}

/** The scribbles of the item, in the scroll area of the editor (they scroll with the text). For an editor window. */
export function ScribbleLayer({ host }: { host: HTMLElement }) {
  const marks = useMarks();
  const [size, setSize] = useState({ w: host.scrollWidth, h: host.scrollHeight });
  useEffect(() => {
    const observer = new ResizeObserver(() => setSize({ w: host.scrollWidth, h: host.scrollHeight }));
    observer.observe(host);
    const content = host.querySelector(".cm-content");
    if (content !== null) observer.observe(content);
    return () => observer.disconnect();
  }, [host]);
  if (marks === null || marks.pageLayer) return null;
  return createPortal(<ScribbleCanvas width={size.w} height={size.h} origin={{ x: 0, y: 0 }} pointOrigin={() => {
    const box = host.getBoundingClientRect();
    return { x: box.left - host.scrollLeft, y: box.top - host.scrollTop };
  }} />, host);
}

/**
 * The scribbles on the whole width of a text page. `page` is the scroll area of the page; `textArea()` gives the
 * text area of the editor (the origin of the scribble points). The layer scrolls with the page.
 */
export function PageScribbleLayer({ page, textArea }: { page: HTMLElement; textArea(): HTMLElement | null }) {
  const marks = useMarks();
  const [layout, setLayout] = useState({ w: 0, h: 0, x: 0, y: 0 });
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const area = textArea();
        if (area === null) return;
        const pageBox = page.getBoundingClientRect();
        const areaBox = area.getBoundingClientRect();
        const next = { w: page.clientWidth, h: Math.max(page.scrollHeight, page.clientHeight), x: areaBox.left - pageBox.left + page.scrollLeft, y: areaBox.top - pageBox.top + page.scrollTop };
        setLayout((before) => (before.w === next.w && before.h === next.h && Math.abs(before.x - next.x) < 0.5 && Math.abs(before.y - next.y) < 0.5 ? before : next));
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    for (const child of page.children) observer.observe(child);
    const area = textArea();
    if (area !== null) observer.observe(area);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [page, textArea]);
  if (marks === null) return null;
  return (
    <ScribbleCanvas
      width={layout.w}
      height={layout.h}
      origin={{ x: layout.x, y: layout.y }}
      pointOrigin={() => {
        const area = textArea();
        const box = area?.getBoundingClientRect();
        return box === undefined ? { x: 0, y: 0 } : { x: box.left, y: box.top };
      }}
      className="page-scribbles"
    />
  );
}

type Point = [number, number];

/** True if a point is inside a polygon (even-odd rule). */
export function insidePolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The scribbles that a lasso holds: at least half of their points are inside it. */
export function lassoSelect(scribbles: readonly { id: string; points: Point[] }[], lasso: readonly Point[]): Set<string> {
  if (lasso.length < 3) return new Set();
  return new Set(scribbles.filter((scribble) => scribble.points.filter((point) => insidePolygon(point, lasso)).length * 2 >= scribble.points.length).map((scribble) => scribble.id));
}

/**
 * The drawing surface: the scribbles, the pen, the eraser, and the lasso. Points are in text area units:
 * `origin` is where the text area starts in this surface; `pointOrigin()` gives the text area start on the screen.
 */
function ScribbleCanvas({ width, height, origin, pointOrigin, className = "" }: { width: number; height: number; origin: { x: number; y: number }; pointOrigin(): { x: number; y: number }; className?: string }) {
  const marks = useMarks();
  const [drawing, setDrawing] = useState<Point[] | null>(null);
  const [lasso, setLasso] = useState<Point[] | null>(null);
  const [drag, setDrag] = useState<{ start: Point; now: Point } | null>(null);
  if (marks === null) return null;
  const pointOf = (event: ReactPointerEvent): Point => {
    const start = pointOrigin();
    return [Math.round((event.clientX - start.x) * 10) / 10, Math.round((event.clientY - start.y) * 10) / 10];
  };
  const pen = marks.mode === "pen";
  const lassoMode = marks.mode === "lasso";
  const offset = drag === null ? { x: 0, y: 0 } : { x: drag.now[0] - drag.start[0], y: drag.now[1] - drag.start[1] };
  const selectedBox = (() => {
    const points = marks.notes.scribbles.filter((scribble) => marks.selected.has(scribble.id)).flatMap((scribble) => scribble.points);
    if (points.length === 0) return null;
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    return { x: Math.min(...xs) - 6, y: Math.min(...ys) - 6, w: Math.max(...xs) - Math.min(...xs) + 12, h: Math.max(...ys) - Math.min(...ys) + 12 };
  })();
  const startDrag = (event: ReactPointerEvent<Element>) => {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    const point = pointOf(event);
    setDrag({ start: point, now: point });
  };
  return (
    <svg
      className={`scribble-layer ${className}${pen ? " pen" : ""}${marks.mode === "erase" ? " erase" : ""}${lassoMode ? " lasso" : ""}`}
      width={width}
      height={height}
      onPointerDown={(event) => {
        // The eraser: no text selection while the button is held (the sweep erases strokes).
        if (marks.mode === "erase" && event.button === 0) event.preventDefault();
        if ((!pen && !lassoMode) || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        if (pen) setDrawing([pointOf(event)]);
        else {
          marks.select(new Set());
          setLasso([pointOf(event)]);
        }
      }}
      onPointerMove={(event) => {
        if (drag !== null) {
          setDrag({ ...drag, now: pointOf(event) });
          return;
        }
        const line = drawing ?? lasso;
        if (line === null) return;
        const next = pointOf(event);
        const last = line[line.length - 1]!;
        if (Math.hypot(next[0] - last[0], next[1] - last[1]) < 1.5) return;
        if (drawing !== null) setDrawing([...drawing, next]);
        else setLasso([...line, next]);
      }}
      onPointerUp={() => {
        if (drag !== null) {
          if (Math.hypot(offset.x, offset.y) >= 1) marks.moveScribbles(marks.selected, offset.x, offset.y);
          setDrag(null);
          return;
        }
        if (drawing !== null && drawing.length >= 2) marks.addScribble(drawing);
        if (lasso !== null) marks.select(lassoSelect(marks.notes.scribbles, lasso));
        setDrawing(null);
        setLasso(null);
      }}
    >
      <g transform={`translate(${origin.x} ${origin.y})`}>
        {marks.notes.scribbles.map((scribble) => {
          const chosen = marks.selected.has(scribble.id);
          return (
            <g key={scribble.id} transform={chosen && drag !== null ? `translate(${offset.x} ${offset.y})` : undefined}>
              <path d={pathOf(scribble.points)} stroke={INK[scribble.color]} strokeWidth={scribble.width} />
              {/* A wide invisible line: the eraser hits a scribble easily, and a selected one can be dragged. */}
              <path
                className={`scribble-hit${chosen ? " chosen" : ""}`}
                d={pathOf(scribble.points)}
                stroke="transparent"
                strokeWidth={14}
                onPointerDown={(event) => {
                  if (marks.mode === "lasso" && chosen && event.button === 0) {
                    startDrag(event);
                    return;
                  }
                  if (marks.mode !== "erase") return;
                  event.stopPropagation();
                  marks.removeScribble(scribble.id);
                }}
                // Eraser: with the button held, a sweep over a stroke removes it.
                onPointerEnter={(event) => {
                  if (marks.mode === "erase" && (event.buttons & 1) === 1) marks.removeScribble(scribble.id);
                }}
              />
            </g>
          );
        })}
        {selectedBox !== null && (
          <rect
            className="scribble-selection"
            x={selectedBox.x + offset.x}
            y={selectedBox.y + offset.y}
            width={selectedBox.w}
            height={selectedBox.h}
            onPointerDown={(event) => event.button === 0 && startDrag(event)}
          />
        )}
        {drawing !== null && <path d={pathOf(drawing)} stroke={INK[marks.color]} strokeWidth={2.5} />}
        {lasso !== null && <path className="scribble-lasso" d={`${pathOf(lasso)} Z`} />}
      </g>
    </svg>
  );
}
