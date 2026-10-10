// Parts that the web page reader and the PDF reader share:
// - The notes (highlights, scribbles, margin items) with their file, undo, and redo.
// - The tools. They show in the main tool bar (in place of the board tools) while a page is open.
// - The sheet: the page on a canvas with a margin at each side. The whole canvas zooms (the page does not flow again).
//   Scribbles, comments, and notes can be on the page and in the margins. Their coordinates are page coordinates
//   (page units from the top left of the page; a left margin has negative x).
// - Marks (highlights and the spoken sentence) are boxes over the text (multiply blend), not CSS highlights: WebKit can leave old
//   CSS highlights painted after a change.

import { ArrowLeft, AudioLines, ChevronDown, ChevronUp, Eraser, Highlighter, Maximize2, MessageSquare, Minus, MousePointer2, PenLine, Play, Plus, Redo2, RefreshCw, Search, StickyNote, Trash2, Undo2, X } from "lucide-react";
import { uiLocale } from "../i18n/i18n";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useSession, useSessionState } from "../app/sessionContext";
import { isTextTarget } from "../app/dom";
import { shortcutKey } from "../app/keys";
import { hasNotes, setAnnotated } from "./annotatedPages";
import { EMPTY_NOTES, encodeNotes, MARGIN_RANGE, NOTE_COLORS, notesPath, pathOf, readNotes, type MarginItem, type NoteColor, type WebNotes } from "./savedPages";
import { useWebPages } from "./WebPages";

export type ReaderMode = "read" | "select" | "highlight" | "pen" | "erase" | "comment" | "note";

/** Highlight fill colors, and scribble ink colors. */
export const FILL: Record<NoteColor, string> = {
  yellow: "rgba(255, 214, 10, 0.45)",
  green: "rgba(52, 199, 89, 0.38)",
  pink: "rgba(255, 55, 95, 0.32)",
  blue: "rgba(10, 132, 255, 0.32)",
};
export const INK: Record<NoteColor, string> = { yellow: "#e6b800", green: "#28a745", pink: "#ff375f", blue: "#0a84ff" };
/** Note backgrounds. */
const PAPER: Record<NoteColor, string> = { yellow: "#fff3b0", green: "#d4f5dc", pink: "#ffd9e2", blue: "#d6e9ff" };

export const ZOOM_RANGE = { min: 0.25, max: 4 };
/** The margin width when the page has no wide margins of its own (page units). */
export const DEFAULT_MARGIN = 260;
/** A page side this wide (or wider) without text is a margin already. */
const OWN_MARGIN = 180;

export const clampZoom = (zoom: number) => Math.min(ZOOM_RANGE.max, Math.max(ZOOM_RANGE.min, zoom));

/** A box in page units. */
export type Box = { left: number; top: number; width: number; height: number };
/** A mark: a user highlight (with its color) or the spoken sentence. */
export type Mark = { id: string; color: NoteColor | "spoken" | "find" | "find-current"; boxes: Box[] };

/** The places of a text in the page text: not case-sensitive, at most MAX_FIND_HITS. */
export function findAll(text: string, query: string): { start: number; end: number }[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return [];
  const haystack = text.toLocaleLowerCase();
  const hits: { start: number; end: number }[] = [];
  for (let at = haystack.indexOf(needle); at !== -1 && hits.length < MAX_FIND_HITS; at = haystack.indexOf(needle, at + needle.length)) {
    hits.push({ start: at, end: at + needle.length });
  }
  return hits;
}
const MAX_FIND_HITS = 1000;
/** Matches that get a mark on the page (all count; the current one always has a mark). */
const MAX_FIND_MARKS = 300;

/**
 * Find in the open page or PDF (⌘F while it is open). Matches have a light mark; the current one a strong mark,
 * and the page scrolls to it.
 */
export function usePageFind(text: string, boxes: (start: number, end: number) => Box[]) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(0);
  const [focusKey, setFocusKey] = useState(0);
  const matches = useMemo(() => (open ? findAll(text, query) : []), [open, text, query]);
  const index = matches.length === 0 ? -1 : Math.min(current, matches.length - 1);
  const marks = useMemo<Mark[]>(() => {
    if (index === -1) return [];
    const near = matches.slice(Math.max(0, index - MAX_FIND_MARKS / 2), index + MAX_FIND_MARKS / 2);
    return [
      ...near.filter((match) => match !== matches[index]).map((match) => ({ id: `find:${match.start}`, color: "find" as const, boxes: boxes(match.start, match.end) })),
      { id: "find-current", color: "find-current" as const, boxes: boxes(matches[index]!.start, matches[index]!.end) },
    ];
  }, [matches, index, boxes]);
  return {
    open,
    query,
    count: matches.length,
    index,
    marks,
    /** The box to scroll to (null: none), and a key that changes at each step (the page scrolls again). */
    focus: marks.length > 0 ? { box: marks[marks.length - 1]!.boxes[0] ?? null, key: focusKey } : null,
    show: (initial?: string) => {
      setOpen(true);
      if (initial !== undefined) {
        setQuery(initial);
        setCurrent(0);
      }
      setFocusKey((value) => value + 1);
    },
    close: () => setOpen(false),
    setQuery: (value: string) => {
      setQuery(value);
      setCurrent(0);
      setFocusKey((key) => key + 1);
    },
    step: (delta: number) => {
      if (matches.length === 0) return;
      setCurrent((value) => (Math.min(value, matches.length - 1) + delta + matches.length) % matches.length);
      setFocusKey((key) => key + 1);
    },
  };
}

export type PageFind = ReturnType<typeof usePageFind>;

/** The find bar at the top right of the reader. */
export function FindBar({ find }: { find: PageFind }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (find.open) input.current?.select();
  }, [find.open, find.focus?.key]);
  if (!find.open) return null;
  return (
    <div className="reader-find" role="search">
      <Search size={13} className="muted" />
      <input
        ref={input}
        autoFocus
        value={find.query}
        placeholder="Find in page"
        spellCheck={false}
        onChange={(event) => find.setQuery(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") find.step(event.shiftKey ? -1 : 1);
          else if (event.key === "Escape") find.close();
          else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
            event.preventDefault();
            input.current?.select();
          }
        }}
      />
      <span className="reader-find-count muted">{find.query.trim() === "" ? "" : find.count === 0 ? "No results" : `${find.index + 1} / ${find.count}`}</span>
      <button className="icon-button small" data-tip="Previous (⇧Enter)" disabled={find.count === 0} onClick={() => find.step(-1)}>
        <ChevronUp size={14} />
      </button>
      <button className="icon-button small" data-tip="Next (Enter)" disabled={find.count === 0} onClick={() => find.step(1)}>
        <ChevronDown size={14} />
      </button>
      <button className="icon-button small" data-tip="Close (Esc)" data-tip-end onClick={find.close}>
        <X size={14} />
      </button>
    </div>
  );
}

/**
 * The margin to add at each side. The width that the user set, else none if the page has wide sides without text,
 * else the default. `text`: the left and right edge of the text on the page, or null if not known.
 */
export function marginOf(userMargin: number | undefined, pageWidth: number, text: { left: number; right: number } | null): number {
  if (userMargin !== undefined) return userMargin;
  if (text !== null && text.left >= OWN_MARGIN && pageWidth - text.right >= OWN_MARGIN) return 0;
  return DEFAULT_MARGIN;
}

/** The boxes of a DOM range, in page units: `origin` is the top left of the page in the coordinates of the range rects. */
export function boxesOf(range: Range, origin: { x: number; y: number }, factor: number): Box[] {
  return [...range.getClientRects()]
    .filter((rect) => rect.width > 0.5 && rect.height > 0.5)
    .map((rect) => ({ left: (rect.left - origin.x) / factor, top: (rect.top - origin.y) / factor, width: rect.width / factor, height: rect.height / factor }));
}

/** The notes of a saved page or PDF: web/<key>.notes.json. Changes save after a short pause; closing saves at once. */
export function useReaderNotes(key: string) {
  const session = useSession();
  const { readOnly } = useSessionState();
  const [notes, setNotes] = useState<WebNotes>(EMPTY_NOTES);
  const [loaded, setLoaded] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const notesRef = useRef(notes);
  const undo = useRef<WebNotes[]>([]);
  const redo = useRef<WebNotes[]>([]);
  const saveTimer = useRef<number | undefined>(undefined);
  const pending = useRef<WebNotes | null>(null);

  useEffect(() => {
    let live = true;
    session
      .readWebFile(notesPath(key))
      .then((text) => {
        if (!live) return;
        const read = readNotes(text);
        setAnnotated(session, key, hasNotes(read));
        notesRef.current = read;
        setNotes(read);
        setLoaded(true);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setProblem(String(error));
        setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [session, key]);

  const writeNotes = useCallback(
    (next: WebNotes) => void session.writeWebFile(notesPath(key), encodeNotes(next)).catch((error: unknown) => setProblem(String(error))),
    [session, key],
  );
  const apply = useCallback(
    (next: WebNotes) => {
      notesRef.current = next;
      setNotes(next);
      setAnnotated(session, key, hasNotes(next));
      pending.current = next;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        pending.current = null;
        writeNotes(next);
      }, 400);
    },
    [writeNotes],
  );
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current);
      if (pending.current !== null) writeNotes(pending.current);
    },
    [writeNotes],
  );
  const change = useCallback(
    (next: WebNotes) => {
      if (readOnly) return;
      undo.current.push(notesRef.current);
      redo.current = [];
      apply(next);
    },
    [apply, readOnly],
  );
  const step = useCallback(
    (back: boolean) => {
      const from = back ? undo.current : redo.current;
      const to = back ? redo.current : undo.current;
      const next = from.pop();
      if (next === undefined) return;
      to.push(notesRef.current);
      apply(next);
    },
    [apply],
  );
  return { notes, notesRef, loaded, change, step, problem, setProblem };
}

/**
 * Reader keys (in the app window; a web page frame sends its keys here too): ⌘Z and ⇧⌘Z undo and redo the notes,
 * ⌘+ ⌘- ⌘0 zoom, Esc goes back to the read tool. Not in text fields. True if the key was used.
 */
export function readerKey(event: KeyboardEvent, actions: { step(back: boolean): void; zoomBy(factor: number): void; fit(): void; setMode(mode: ReaderMode): void; find(): void }): boolean {
  if (isTextTarget(event.target)) return false;
  if (event.metaKey || event.ctrlKey) {
    const key = shortcutKey(event);
    // ⌘F while a page is open: find in the page (not the board search).
    if (key === "f" && !event.shiftKey) actions.find();
    else if (event.code === "KeyZ") actions.step(!event.shiftKey);
    else if (key === "=" || key === "+") actions.zoomBy(1.2);
    else if (key === "-") actions.zoomBy(1 / 1.2);
    else if (key === "0") actions.fit();
    else return false;
  } else if (event.key === "Escape") {
    actions.setMode("read");
  } else {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  return true;
}

export function useReaderKeys(actions: Parameters<typeof readerKey>[1]) {
  const live = useRef(actions);
  live.current = actions;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => void readerKey(event, live.current);
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}

type ToolsProps = {
  title: string;
  url: string;
  mode: ReaderMode;
  color: NoteColor;
  readOnly: boolean;
  canRead: boolean;
  zoom: number;
  /** The margin that the user set, or undefined (the reader finds it). */
  margin: number | undefined;
  /** The margin in use now. */
  shownMargin: number;
  /** `keep`: a double-click on the comment or note tool keeps it on after each item (else it makes one item). */
  onMode(mode: ReaderMode, keep?: boolean): void;
  /** True while the comment or note tool stays on. */
  sticky?: boolean;
  onColor(color: NoteColor): void;
  onClose(): void;
  onStep(back: boolean): void;
  onReadFromStart(): void;
  onZoom(zoom: number): void;
  onFit(): void;
  onMargin(margin: number | undefined): void;
  /** "Save again from the web": only for pages from the web. */
  onSaveAgain?: () => void;
};

/** The reader tools. In the main tool bar while the page is open (the board tools do not show then). */
export function ReaderTools(props: ToolsProps) {
  const web = useWebPages();
  const { title, url, mode, color, readOnly, canRead, zoom, margin, shownMargin } = props;
  const tool = (id: ReaderMode, label: string, Icon: typeof AudioLines, disabled = false) => (
    <button
      key={id}
      className={`icon-button${mode === id ? " active" : ""}${mode === id && props.sticky === true ? " sticky" : ""}`}
      data-tip={id === "comment" || id === "note" ? `${label} · double-click: stays on` : label}
      disabled={disabled}
      onClick={() => props.onMode(mode === id && id !== "read" ? "read" : id)}
      onDoubleClick={() => (id === "comment" || id === "note") && props.onMode(id, true)}
    >
      <Icon size={18} strokeWidth={1.75} />
    </button>
  );
  const tools = (
    <span className="reader-tools">
      <button className="icon-button" data-tip="Close the page" data-tip-start onClick={props.onClose}>
        <ArrowLeft size={18} strokeWidth={1.75} />
      </button>
      <span className="reader-title" title={url !== "" ? `${title}\n${url}` : title}>
        {title}
      </span>
      <span className="divider" />
      {tool("read", "Read: click text to read aloud from there", AudioLines, !canRead)}
      {tool("select", "Select: select text, move comments and notes", MousePointer2)}
      {tool("highlight", "Highlight: select text", Highlighter, readOnly)}
      {tool("pen", "Pen: draw on the page or in a margin", PenLine, readOnly)}
      {tool("erase", "Eraser: click a scribble, a highlight, a comment, or a note", Eraser, readOnly)}
      {tool("comment", "Comment: click the page or a margin", MessageSquare, readOnly)}
      {tool("note", "Note: click the page or a margin", StickyNote, readOnly)}
      <span className="web-reader-colors" role="group" aria-label="Color">
        {NOTE_COLORS.map((name) => (
          <button key={name} className={`web-reader-color${color === name ? " active" : ""}`} style={{ background: INK[name] }} data-tip={name} aria-label={name} onClick={() => props.onColor(name)} />
        ))}
      </span>
      <button className="icon-button" data-tip="Undo (⌘Z)" disabled={readOnly} onClick={() => props.onStep(true)}>
        <Undo2 size={16} />
      </button>
      <button className="icon-button" data-tip="Redo (⇧⌘Z)" disabled={readOnly} onClick={() => props.onStep(false)}>
        <Redo2 size={16} />
      </button>
      <span className="divider" />
      <span className="reader-zoom">
        <button className="icon-button small" data-tip="Zoom out (⌘-)" disabled={zoom <= ZOOM_RANGE.min} onClick={() => props.onZoom(zoom / 1.2)}>
          <Minus size={14} />
        </button>
        <span className="reader-zoom-value">{Math.round(zoom * 100)}%</span>
        <button className="icon-button small" data-tip="Zoom in (⌘+)" disabled={zoom >= ZOOM_RANGE.max} onClick={() => props.onZoom(zoom * 1.2)}>
          <Plus size={14} />
        </button>
        <button className="icon-button small" data-tip="Fit the width (⌘0)" onClick={props.onFit}>
          <Maximize2 size={13} />
        </button>
      </span>
      <MarginField margin={margin} shown={shownMargin} readOnly={readOnly} onChange={props.onMargin} />
      <button className="icon-button" data-tip="Read from the start" disabled={!canRead} onClick={props.onReadFromStart}>
        <Play size={16} />
      </button>
      {props.onSaveAgain !== undefined && (
        <button className="icon-button" data-tip="Save again from the web" data-tip-end onClick={props.onSaveAgain}>
          <RefreshCw size={15} />
        </button>
      )}
    </span>
  );
  const slot = web?.toolSlot ?? null;
  return slot === null ? <div className="web-reader-bar">{tools}</div> : createPortal(tools, slot);
}

/** The margin width: empty is automatic (the page sides, or the default width). */
function MarginField({ margin, shown, readOnly, onChange }: { margin: number | undefined; shown: number; readOnly: boolean; onChange(margin: number | undefined): void }) {
  const [draft, setDraft] = useState(margin === undefined ? "" : String(margin));
  useEffect(() => setDraft(margin === undefined ? "" : String(margin)), [margin]);
  const commit = () => {
    const text = draft.trim();
    if (text === "") {
      if (margin !== undefined) onChange(undefined);
      return;
    }
    const value = Number(text);
    if (!Number.isFinite(value)) {
      setDraft(margin === undefined ? "" : String(margin));
      return;
    }
    const next = Math.round(Math.min(MARGIN_RANGE.max, Math.max(MARGIN_RANGE.min, value)));
    setDraft(String(next));
    if (next !== margin) onChange(next);
  };
  return (
    <label className="reader-margin-field" data-tip={`Margin at each side, in px. Empty: automatic (now ${shown} px).`}>
      <span>Margin</span>
      <input
        value={draft}
        disabled={readOnly}
        placeholder={`auto ${shown}`}
        inputMode="numeric"
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(margin === undefined ? "" : String(margin));
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

type SheetProps = {
  /** The page size in page units. */
  pageWidth: number;
  pageHeight: number;
  /** Screen pixels for each page unit. */
  zoom: number;
  margin: number;
  mode: ReaderMode;
  color: NoteColor;
  readOnly: boolean;
  notes: WebNotes;
  change(next: WebNotes): void;
  marks: readonly Mark[];
  /** A box to keep in view (the spoken sentence). */
  focus: Box | null;
  /** The user types in a comment or a note: the reader ends the comment or note tool (the next click makes no new item). */
  onTyping?(): void;
  /** A comment or a note was placed: the reader ends the tool unless it stays on (double-click). */
  onPlaced?(): void;
  /** The current match of "Find in page": the page scrolls to it at each new key. */
  findFocus?: { box: Box | null; key: number } | null;
  /** A zoom change from a gesture: the point under (clientX, clientY) stays in place. */
  onZoom(zoom: number, anchor: { clientX: number; clientY: number } | null): void;
  /** Gives the canvas functions to the reader (for a frame: its scroll and zoom gestures go here). */
  apiRef?: React.MutableRefObject<SheetApi | null>;
  onScroll?(): void;
  className?: string;
  /** The page: it is placed at the left margin, in a box of the page size times the zoom. */
  children: ReactNode;
  /**
   * A column at the right of the right margin (for example a translation), in page units. `render` gets its left edge.
   * `height`: its height; the canvas grows if it is taller than the page.
   */
  side?: { width: number; gap: number; height: number; render(left: number): ReactNode } | null;
};

export type SheetApi = {
  scrollBy(dx: number, dy: number): void;
  /** A zoom gesture at a point of the app window. */
  zoomAt(zoom: number, clientX: number, clientY: number): void;
  /** The width of the visible part of the canvas (screen pixels). */
  viewWidth(): number;
};

/** After a scroll of the user, read aloud does not scroll the page for this time (ms). */
const USER_SCROLL_PAUSE = 4000;

export function ReaderSheet({ pageWidth, pageHeight: page, zoom, margin, mode, color, readOnly, notes, change, marks, focus, findFocus = null, onTyping, onPlaced, onZoom, apiRef, onScroll, className, children, side = null }: SheetProps) {
  const pageHeight = Math.max(page, side?.height ?? 0);
  const { settings } = useSessionState();
  const scroller = useRef<HTMLDivElement>(null);
  const sizer = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [drawing, setDrawing] = useState<[number, number][] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  /** After a zoom at a point: the page point to keep under that screen point. */
  const anchor = useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const live = useRef({ onZoom, margin });
  live.current = { onZoom, margin };

  /** A point of the app window in page units. */
  const pagePoint = useCallback((clientX: number, clientY: number): [number, number] => {
    const box = sizer.current!.getBoundingClientRect();
    return [(clientX - box.left) / zoomRef.current - live.current.margin, (clientY - box.top) / zoomRef.current];
  }, []);

  const zoomAt = useCallback(
    (next: number, clientX: number, clientY: number) => {
      const value = clampZoom(next);
      if (value === zoomRef.current) return;
      const [x, y] = pagePoint(clientX, clientY);
      anchor.current = { x, y, clientX, clientY };
      live.current.onZoom(value, { clientX, clientY });
    },
    [pagePoint],
  );
  useLayoutEffect(() => {
    const point = anchor.current;
    anchor.current = null;
    if (point === null || sizer.current === null || scroller.current === null) return;
    const box = sizer.current.getBoundingClientRect();
    scroller.current.scrollLeft += box.left + (point.x + margin) * zoom - point.clientX;
    scroller.current.scrollTop += box.top + point.y * zoom - point.clientY;
  }, [zoom, margin]);

  useEffect(() => {
    if (apiRef === undefined) return;
    apiRef.current = {
      scrollBy: (dx, dy) => scroller.current?.scrollBy(dx, dy),
      zoomAt,
      viewWidth: () => scroller.current?.clientWidth ?? 900,
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, zoomAt]);

  // Pinch and Ctrl + wheel zoom the canvas. Safari pinch gives gesture events; other engines give Ctrl + wheel.
  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomAt(zoomRef.current * Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
    };
    let start = 1;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      start = zoomRef.current;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { scale: number; clientX: number; clientY: number };
      zoomAt(start * gesture.scale, gesture.clientX, gesture.clientY);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("gesturestart", onGestureStart);
    element.addEventListener("gesturechange", onGestureChange);
    return () => {
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("gesturestart", onGestureStart);
      element.removeEventListener("gesturechange", onGestureChange);
    };
  }, [zoomAt]);

  // The last scroll of the user (wheel, touch, keys, scroll bar). The app does not scroll for read aloud then.
  const userScroll = useRef(0);
  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    const mark = () => void (userScroll.current = performance.now());
    const events = ["wheel", "touchmove", "keydown", "pointerdown"] as const;
    for (const name of events) element.addEventListener(name, mark, { passive: true });
    return () => {
      for (const name of events) element.removeEventListener(name, mark);
    };
  }, []);

  // Keep the spoken sentence in view. Not for some seconds after the user scrolled: the two scrolls would fight.
  useEffect(() => {
    if (focus === null || scroller.current === null || sizer.current === null) return;
    if (performance.now() - userScroll.current < USER_SCROLL_PAUSE) return;
    const view = scroller.current.getBoundingClientRect();
    const box = sizer.current.getBoundingClientRect();
    const top = box.top + focus.top * zoom;
    const bottom = top + focus.height * zoom;
    if (top < view.top + 60 || bottom > view.bottom - 60) scroller.current.scrollBy({ top: top - view.top - view.height / 3, behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.top, focus?.left]);

  // Find in page: the current match goes to the upper third of the view (if it is not in view).
  useEffect(() => {
    const target = findFocus?.box ?? null;
    if (target === null || scroller.current === null || sizer.current === null) return;
    const view = scroller.current.getBoundingClientRect();
    const box = sizer.current.getBoundingClientRect();
    const top = box.top + target.top * zoom;
    const bottom = top + target.height * zoom;
    if (top < view.top + 40 || bottom > view.bottom - 40) scroller.current.scrollBy({ top: top - view.top - view.height / 3 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findFocus?.key, findFocus?.box?.top]);

  const fullWidth = pageWidth + 2 * margin + (side === null ? 0 : side.gap + side.width);
  const placing = mode === "comment" || mode === "note";
  const drawingMode = mode === "pen" && !readOnly;

  const addItem = (event: ReactPointerEvent) => {
    const [x, y] = pagePoint(event.clientX, event.clientY);
    const kind = mode === "comment" ? "comment" : "note";
    const item: MarginItem = { id: nanoid(10), kind, x: Math.round(x), y: Math.round(y), w: kind === "comment" ? 200 : 170, text: "", color, created: new Date().toISOString() };
    if (kind === "comment" && settings.userName !== "") item.author = settings.userName;
    change({ ...notes, items: [...notes.items, item] });
    setEditing(item.id);
    onPlaced?.();
  };

  /** The eraser: removes the highlight under a point of the app window. */
  const eraseHighlightAt = (clientX: number, clientY: number) => {
    const [x, y] = pagePoint(clientX, clientY);
    const hit = marks.find((mark) => mark.color !== "spoken" && mark.color !== "find" && mark.color !== "find-current" && mark.boxes.some((box) => x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height));
    if (hit !== undefined) change({ ...notes, highlights: notes.highlights.filter((highlight) => highlight.id !== hit.id) });
  };

  // The latest notes: an item can save when it closes (after a newer change in the same step), so a change must not
  // start from the notes of an older render.
  const latestNotes = useRef(notes);
  latestNotes.current = notes;
  const updateItem = (id: string, changes: Partial<MarginItem>) => {
    const current = latestNotes.current;
    const next = { ...current, items: current.items.map((item) => (item.id === id ? { ...item, ...changes } : item)) };
    latestNotes.current = next;
    change(next);
  };
  const removeItem = (id: string) => {
    const current = latestNotes.current;
    const next = { ...current, items: current.items.filter((item) => item.id !== id) };
    latestNotes.current = next;
    change(next);
  };

  return (
    <div ref={scroller} className={`reader-scroller mode-${mode}${className === undefined ? "" : ` ${className}`}`} onScroll={onScroll}>
      <div ref={sizer} className="reader-sizer" style={{ width: fullWidth * zoom, height: pageHeight * zoom }}>
        <div className="reader-page" style={{ left: margin * zoom, width: pageWidth * zoom, height: page * zoom }}>
          {children}
        </div>
        {/*
          Marks (highlights, the spoken sentence): each box blends with the page (multiply), so the text under a mark
          stays dark and readable. Each box blends alone (screen units, not in a scaled layer): a blend layer as large
          as the page made scrolling slow, and the screen could go blank for some seconds.
        */}
        {marks.flatMap((mark) =>
          mark.boxes.map((box, index) => (
            <div
              key={`${mark.id}:${index}`}
              className={`reader-mark${mark.color === "spoken" || mark.color === "find" || mark.color === "find-current" ? ` ${mark.color}` : ""}`}
              style={{ left: (margin + box.left) * zoom, top: box.top * zoom, width: box.width * zoom, height: box.height * zoom, background: mark.color === "spoken" || mark.color === "find" || mark.color === "find-current" ? undefined : FILL[mark.color] }}
            />
          )),
        )}
        <div
          ref={overlay}
          // The eraser takes the pointer too: a sweep (button held) over strokes and highlights removes them.
          className={`reader-overlay${placing || drawingMode || (mode === "erase" && !readOnly) ? " active" : ""}`}
          style={{ width: fullWidth, height: pageHeight, transform: `scale(${zoom})` }}
          onPointerDown={(event) => {
            if (mode === "erase" && event.button === 0 && !readOnly) {
              event.preventDefault();
              eraseHighlightAt(event.clientX, event.clientY);
            }
            if (event.button !== 0 || event.target !== event.currentTarget) return;
            if (placing && !readOnly) {
              event.preventDefault();
              addItem(event);
            } else if (drawingMode) {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              setDrawing([pagePoint(event.clientX, event.clientY)]);
            }
          }}
          onPointerMove={(event) => {
            // The eraser with the button held: a sweep over highlights removes them.
            if (mode === "erase" && (event.buttons & 1) === 1 && !readOnly) eraseHighlightAt(event.clientX, event.clientY);
            if (drawing === null) return;
            const next = pagePoint(event.clientX, event.clientY);
            const last = drawing[drawing.length - 1]!;
            if (Math.hypot(next[0] - last[0], next[1] - last[1]) * zoom >= 1.5) setDrawing([...drawing, next]);
          }}
          onPointerUp={() => {
            if (drawing !== null && drawing.length >= 2) {
              const points = drawing.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as [number, number]);
              change({ ...notes, scribbles: [...notes.scribbles, { id: nanoid(10), points, color, width: 2.5 }] });
            }
            setDrawing(null);
          }}
        >
          {margin > 0 && (
            <>
              <div className="reader-margin" style={{ left: 0, width: margin }} />
              <div className="reader-margin" style={{ left: margin + pageWidth, width: margin }} />
            </>
          )}
          {side !== null && side.render(2 * margin + pageWidth + side.gap)}
          <svg className="reader-ink" width={fullWidth} height={pageHeight}>
            <g transform={`translate(${margin} 0)`}>
              {notes.scribbles.map((scribble) => (
                <g key={scribble.id}>
                  <path d={pathOf(scribble.points)} stroke={INK[scribble.color]} strokeWidth={scribble.width} />
                  <path
                    className="scribble-hit"
                    d={pathOf(scribble.points)}
                    stroke="transparent"
                    strokeWidth={14 / zoom}
                    onPointerDown={(event) => {
                      if (mode !== "erase" || readOnly) return;
                      event.stopPropagation();
                      change({ ...notes, scribbles: notes.scribbles.filter((other) => other.id !== scribble.id) });
                    }}
                    // With the button held, a sweep over a stroke removes it.
                    onPointerEnter={(event) => {
                      if (mode === "erase" && !readOnly && (event.buttons & 1) === 1) change({ ...notes, scribbles: notes.scribbles.filter((other) => other.id !== scribble.id) });
                    }}
                  />
                </g>
              ))}
              {drawing !== null && <path d={pathOf(drawing)} stroke={INK[color]} strokeWidth={2.5} />}
            </g>
          </svg>
          {notes.items.map((item) => (
            <MarginItemView
              key={item.id}
              item={item}
              margin={margin}
              zoom={zoom}
              mode={mode}
              readOnly={readOnly}
              editing={editing === item.id}
              onEdit={(on) => setEditing(on ? item.id : null)}
              onChange={(changes) => updateItem(item.id, changes)}
              onRemove={() => removeItem(item.id)}
              onTyping={onTyping}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

type ItemProps = {
  item: MarginItem;
  margin: number;
  zoom: number;
  mode: ReaderMode;
  readOnly: boolean;
  editing: boolean;
  onEdit(on: boolean): void;
  onChange(changes: Partial<MarginItem>): void;
  onRemove(): void;
  onTyping?(): void;
};

/** A comment (dark, pink text, signature) or a note (paper color) on the canvas. Drag its head to move it. */
function MarginItemView({ item, margin, zoom, mode, readOnly, editing, onEdit, onChange, onRemove, onTyping }: ItemProps) {
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  // The text while it is written. It saves after a short pause, and when the editing ends (in any way: a click
  // outside, a click in the page, Esc, a new item, or the reader closes). So a written text is never lost.
  const draft = useRef<string | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const latest = useRef({ item, onChange, onRemove, onEdit });
  latest.current = { item, onChange, onRemove, onEdit };
  const save = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    const text = draft.current;
    if (text === null) return;
    const { item: current, onChange: changeItem } = latest.current;
    if (text !== current.text && text.trim() !== "") changeItem({ text });
  }, []);
  const finish = useCallback(() => {
    // A click outside and the blur that follows: the editing ends one time.
    if (draft.current === null) return;
    save();
    const text = draft.current;
    draft.current = null;
    const { item: current, onRemove: remove, onEdit: edit } = latest.current;
    // A new item that stays empty goes away.
    if ((text ?? current.text).trim() === "" && current.text === "") remove();
    edit(false);
  }, [save]);
  useEffect(() => {
    if (!editing) return;
    area.current?.focus();
    draft.current = latest.current.item.text;
    // A click outside the item ends the editing. A click in the page (a frame) takes the focus from this window.
    const onPointerDown = (event: PointerEvent) => {
      if (frame.current !== null && !frame.current.contains(event.target as Node)) finish();
    };
    const onWindowBlur = () => finish();
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onWindowBlur);
      // The editing ends without a click (a new item, the reader closes): the text saves.
      save();
      draft.current = null;
    };
  }, [editing, finish, save]);
  const time = new Date(item.created);
  return (
    <div
      ref={frame}
      className={`reader-item ${item.kind}`}
      style={{ left: margin + item.x + (offset?.x ?? 0), top: item.y + (offset?.y ?? 0), width: item.w, background: item.kind === "note" ? PAPER[item.color] : undefined }}
      onPointerDown={(event) => {
        if (mode === "erase" && !readOnly) {
          event.stopPropagation();
          onRemove();
        }
      }}
    >
      <div
        className="reader-item-head"
        onPointerDown={(event) => {
          if (readOnly || mode === "erase" || event.button !== 0 || (event.target as Element).closest("button") !== null) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY };
          setOffset({ x: 0, y: 0 });
        }}
        onPointerMove={(event) => {
          if (drag.current === null) return;
          setOffset({ x: (event.clientX - drag.current.x) / zoom, y: (event.clientY - drag.current.y) / zoom });
        }}
        onPointerUp={() => {
          if (drag.current !== null && offset !== null && (offset.x !== 0 || offset.y !== 0)) onChange({ x: Math.round(item.x + offset.x), y: Math.round(item.y + offset.y) });
          drag.current = null;
          setOffset(null);
        }}
      >
        {item.kind === "comment" ? (
          <>
            <MessageSquare size={11} />
            <span className="comment-author">{item.author ?? "Comment"}</span>
            <span className="comment-time">{Number.isNaN(time.getTime()) ? "" : time.toLocaleString(uiLocale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
          </>
        ) : (
          <span className="reader-item-grip" />
        )}
        {!readOnly && (
          <button className="icon-button small reader-item-delete" data-tip="Delete" data-tip-end onClick={onRemove}>
            <Trash2 size={11} />
          </button>
        )}
      </div>
      {editing ? (
        <textarea
          ref={area}
          className="reader-item-input"
          defaultValue={item.text}
          placeholder={item.kind === "comment" ? "Write a comment…" : "Write a note…"}
          onChange={(event) => {
            onTyping?.();
            draft.current = event.target.value;
            window.clearTimeout(saveTimer.current);
            saveTimer.current = window.setTimeout(save, 600);
          }}
          onBlur={finish}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") finish();
          }}
        />
      ) : (
        <div className="reader-item-text" dir="auto" onDoubleClick={() => !readOnly && onEdit(true)}>
          {item.text !== "" ? item.text : <span className="untitled">Double-click to write</span>}
        </div>
      )}
    </div>
  );
}
