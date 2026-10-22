// Parts that the web page reader and the PDF reader share (more in readerBasics.ts, readerFind.tsx, readerNotes.ts,
// insideItems.tsx; this file gives them all):
// - The notes (highlights, scribbles) with their file, undo, and redo (readerNotes.ts).
// - The tools. They show in the main tool bar (in place of the board tools) while a page is open.
// - The sheet: the page on a canvas with a margin at each side. The whole canvas zooms (the page does not flow again).
//   Scribbles, comments, and notes can be on the page and in the margins. Their coordinates are page coordinates
//   (page units from the top left of the page; a left margin has negative x).
// - Small items on the page (comments, notes, action items, …) are vault items inside the link object (SPEC 1.1,
//   core/inside.ts): the small-item button makes them. An item that points to text has a faint dashed curve to it.
// - Marks (highlights and the spoken sentence) are boxes over the text (multiply blend), not CSS highlights: WebKit can leave old
//   CSS highlights painted after a change.

import { Lock, ArrowLeft, Contrast, Eraser, Highlighter, Maximize2, Minus, MousePointer2, PenLine, Plus, Redo2, Undo2 } from "lucide-react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useRunCommand, useSession, useSessionState, useStoreRevision } from "../app/sessionContext";
import { completeItems, deleteThread } from "../../core/actions";
import { useWorkspaceActions } from "../app/workspaceActions";
import { createInside, insideEntries, moveInside, pointInside } from "../../core/inside";
import type { Id } from "../../core/types";
import { onShowSpoken } from "../plugins/speech";
import { armedSmallTool, armSmallTool, SmallItemButton, usedSmallTool, useSmallTool, type TextAnchor } from "../app/smallTool";
import { isTextTarget } from "../app/dom";
import { shortcutKey } from "../app/keys";
import { NOTE_COLORS, pathOf, type NoteColor, type WebNotes } from "./savedPages";
import { useWebPages } from "./WebPages";

import { boxesOf, clampZoom, COLOR_NAMES, FILL, INK, marginOf, readyMarkOf, ZOOM_RANGE, type Box, type Mark, type ReaderMode } from "./readerBasics";
import { FindBar, findAll, usePageFind, type PageFind } from "./readerFind";
import { useReaderNotes } from "./readerNotes";
import { InsideCurves, InsideItemView } from "./insideItems";

export { boxesOf, clampZoom, COLOR_NAMES, FILL, INK, marginOf, readyMarkOf, ZOOM_RANGE, FindBar, findAll, usePageFind, useReaderNotes };
export type { Box, Mark, ReaderMode, PageFind };

/**
 * Reader keys (in the app window; a web page frame sends its keys here too): ⌘Z and ⇧⌘Z undo and redo,
 * ⌘+ ⌘- ⌘0 zoom. Esc ends the small-item tool, or goes back to the read tool; with nothing to end, Esc is not used
 * here (for example it ends zen mode). Not in text fields. True if the key was used.
 */
export function readerKey(event: KeyboardEvent, actions: { mode: ReaderMode; step(back: boolean): void; zoomBy(factor: number): void; fit(): void; setMode(mode: ReaderMode): void; find(): void }): boolean {
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
    if (armedSmallTool() !== null) armSmallTool(null);
    else if (actions.mode !== "select") actions.setMode("select");
    else return false;
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
  zoom: number;
  /** `keep`: a double-click on the comment or note tool keeps it on after each item (else it makes one item). */
  onMode(mode: ReaderMode, keep?: boolean): void;
  /** True while the comment or note tool stays on. */
  sticky?: boolean;
  onColor(color: NoteColor): void;
  onClose(): void;
  onStep(back: boolean): void;
  onZoom(zoom: number): void;
  onFit(): void;
  /** "Save again from the web": only for pages from the web. */
  onSaveAgain?: () => void;
  /** More buttons at the end (the Links button). */
  extra?: ReactNode;
  /** The selected text of the page (for a new small item that points to it). */
  selection?: () => TextAnchor | null;
};

/** The reader tools. In the main tool bar while the page is open (the board tools do not show then). */

export function ReaderTools(props: ToolsProps) {
  const web = useWebPages();
  const session = useSession();
  const { settings, readOnlyReason } = useSessionState();
  const { title, url, mode, color, readOnly, zoom } = props;
  const tool = (id: ReaderMode, label: string, Icon: typeof MousePointer2, disabled = false) => (
    <button
      key={id}
      className={`icon-button${mode === id ? " active" : ""}${mode === id && props.sticky === true ? " sticky" : ""}`}
      data-tip={id === "comment" || id === "note" ? `${label} · double-click: stays on` : label}
      disabled={disabled}
      onClick={() => props.onMode(mode === id && id !== "select" ? "select" : id)}
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
      {/* Read-only vault (an other window has it, or it has errors): the tools that change it are off. Say why. */}
      {readOnly && (
        <span className="reader-readonly" data-tip={readOnlyReason ?? "The vault is read-only."}>
          <Lock size={13} />
          <span>Read-only</span>
        </span>
      )}
      {tool("select", "Select: select text, move comments and notes", MousePointer2)}
      {tool("highlight", "Highlight: select text", Highlighter, readOnly)}
      {tool("pen", "Pen: draw on the page or in a margin", PenLine, readOnly)}
      {tool("erase", "Eraser: click a scribble, a highlight, a comment, or a note", Eraser, readOnly)}
      {/* All small kinds (SPEC 1.1): choose one, then click the page or a margin. */}
      <SmallItemButton disabled={readOnly} selection={props.selection ?? (() => null)} />
      <span className="web-reader-colors" role="group" aria-label="Color">
        {NOTE_COLORS.map((name) => (
          <button key={name} className={`web-reader-color${color === name ? " active" : ""}`} style={{ background: INK[name] }} data-tip={COLOR_NAMES[name]} aria-label={COLOR_NAMES[name]} onClick={() => props.onColor(name)} />
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
      {/* Inverted colors: a dark page with light text. A view setting of all web pages and PDFs, not the app theme. */}
      <button
        className={`icon-button${settings.readerInvert ? " active" : ""}`}
        data-tip={settings.readerInvert ? "Inverted colors: on (click for the original colors)" : "Inverted colors: a dark page with light text"}
        aria-pressed={settings.readerInvert}
        onClick={() => void session.updateSettings({ readerInvert: !settings.readerInvert })}
      >
        <Contrast size={15} />
      </button>
      {props.extra}
    </span>
  );
  // "Save again from the web" is in the "More" menu (⋯) of the top bar.
  const setSaveAgain = web?.setSaveAgain;
  const saveAgain = useRef(props.onSaveAgain);
  saveAgain.current = props.onSaveAgain;
  const canSaveAgain = props.onSaveAgain !== undefined;
  useEffect(() => {
    if (setSaveAgain === undefined || !canSaveAgain) return;
    setSaveAgain(() => saveAgain.current?.());
    return () => setSaveAgain(null);
  }, [setSaveAgain, canSaveAgain]);
  const slot = web?.toolSlot ?? null;
  return (
    <>
      {slot === null ? <div className="web-reader-bar">{tools}</div> : createPortal(tools, slot)}
    </>
  );
}

type SheetProps = {
  /** The link object: the home of the small items on the page. */
  homeId: Id;
  /** A new value: the reader fitted the page; the canvas scrolls to the left edge of the page (not its margin). */
  fitKey?: number;
  /** The box (page units) of a text of the page that a small item points to, or null. */
  anchorBox?(quote: string, at: number | null): Box | null;
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
  /** The boxes to keep in view (the lines of the spoken sentence). */
  focus: readonly Box[] | null;
  /** Changes when the spoken sentence changes. Only then the view follows (a zoom does not move the view back). */
  focusKey?: unknown;
  /** The user types in a comment or a note: the reader ends the comment or note tool (the next click makes no new item). */
  onTyping?(): void;
  /** A comment or a note was placed: the reader ends the tool unless it stays on (double-click). */
  onPlaced?(): void;
  /** The current match of "Find in page": the page scrolls to it at each new key. */
  findFocus?: { box: Box | null; key: number } | null;
  /** A zoom change from a gesture: the point under (clientX, clientY) stays in place. */
  onZoom(zoom: number, anchor: { clientX: number; clientY: number } | null): void;
  /** A new zoom, before the canvas keeps the point under the pointer (the PDF viewer takes its new scale here). */
  onZoomLayout?(zoom: number): void;
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
  /** Notes in the left margin (the formula notes), in the scaled layer (page units, x from the left of the canvas). */
  leftNotes?: ReactNode;
  /** Shadows of linked items with their arrows (linkMarks.tsx), in the same layer. */
  shadows?: ReactNode;
};

export type SheetApi = {
  scrollBy(dx: number, dy: number): void;
  /** A zoom gesture at a point of the app window. */
  zoomAt(zoom: number, clientX: number, clientY: number): void;
  /** The width of the visible part of the canvas (screen pixels). */
  viewWidth(): number;
  /** The element that scrolls (absolutely placed: the PDF viewer needs that). */
  element(): HTMLDivElement | null;
};

/** After a scroll of the user, read aloud does not scroll the page for this time (ms). */
const USER_SCROLL_PAUSE = 4000;

/** The box around boxes. */
function unionOf(boxes: readonly Box[]): Box {
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.left + box.width));
  const bottom = Math.max(...boxes.map((box) => box.top + box.height));
  return { left, top, width: right - left, height: bottom - top };
}

/** The scroll that puts a range (screen top and bottom) in the center of the view. A range taller than 70% of the view: its top goes near the top. */
function centerScroll(top: number, bottom: number, view: DOMRect): number {
  return bottom - top > view.height * 0.7 ? top - view.top - view.height * 0.1 : (top + bottom) / 2 - (view.top + view.height / 2);
}

export function ReaderSheet({ homeId, fitKey = 0, anchorBox, pageWidth, pageHeight: page, zoom, margin, mode, color, readOnly, notes, change, marks, focus, focusKey, findFocus = null, onTyping, onPlaced, onZoom, onZoomLayout, apiRef, onScroll, className, children, side = null, leftNotes = null, shadows = null }: SheetProps) {
  const pageHeight = Math.max(page, side?.height ?? 0);
  const { settings } = useSessionState();
  const session = useSession();
  const runCommand = useRunCommand();
  useStoreRevision();
  const smallTool = useSmallTool();
  const actions = useWorkspaceActions();
  const entries = session.store.has("items", homeId) ? insideEntries(session.store, session.graph, homeId) : [];
  const runVault = (command: Parameters<typeof runCommand>[0]) => runCommand(command);
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
  const zoomLayout = useRef(onZoomLayout);
  zoomLayout.current = onZoomLayout;
  useLayoutEffect(() => {
    zoomLayout.current?.(zoom);
    const point = anchor.current;
    anchor.current = null;
    if (point === null || sizer.current === null || scroller.current === null) return;
    const box = sizer.current.getBoundingClientRect();
    scroller.current.scrollLeft += box.left + (point.x + margin) * zoom - point.clientX;
    scroller.current.scrollTop += box.top + point.y * zoom - point.clientY;
  }, [zoom, margin]);

  // After a fit (and at the first fit): the left edge of the page at the left of the view (the margin is out of view).
  useLayoutEffect(() => {
    if (fitKey === 0 || scroller.current === null) return;
    scroller.current.scrollLeft = Math.max(0, margin * zoom - 24);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  useEffect(() => {
    if (apiRef === undefined) return;
    apiRef.current = {
      scrollBy: (dx, dy) => scroller.current?.scrollBy(dx, dy),
      zoomAt,
      viewWidth: () => scroller.current?.clientWidth ?? 900,
      element: () => scroller.current,
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

  // Keep the spoken sentence in view: when it reaches the lowest 15% of the view (or is above the view), the view
  // scrolls to put it in the center. Only when the sentence changes: a zoom or a new drawing of the pages does not
  // move the view. Not for some seconds after the user scrolled: the two scrolls would fight.
  const focusBox = focus === null || focus.length === 0 ? null : unionOf(focus);
  useEffect(() => {
    if (focusBox === null || scroller.current === null || sizer.current === null) return;
    if (performance.now() - userScroll.current < USER_SCROLL_PAUSE) return;
    const view = scroller.current.getBoundingClientRect();
    const box = sizer.current.getBoundingClientRect();
    const top = box.top + focusBox.top * zoom;
    const bottom = top + focusBox.height * zoom;
    if (top < view.top || bottom > view.bottom - view.height * 0.15) scroller.current.scrollBy({ top: centerScroll(top, bottom, view), behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey ?? focusBox?.top, focusBox === null]);

  // "Show the text that is read now" (the read-aloud bar): the spoken sentence goes to the upper third of the view,
  // also right after a scroll of the user.
  const focusRef = useRef(focusBox);
  focusRef.current = focusBox;
  useEffect(
    () =>
      onShowSpoken(() => {
        const target = focusRef.current;
        if (target === null || scroller.current === null || sizer.current === null) return;
        userScroll.current = 0;
        const view = scroller.current.getBoundingClientRect();
        const box = sizer.current.getBoundingClientRect();
        const top = box.top + target.top * zoomRef.current;
        const bottom = top + target.height * zoomRef.current;
        const left = box.left + (live.current.margin + target.left) * zoomRef.current;
        scroller.current.scrollBy({ top: centerScroll(top, bottom, view), left: left < view.left || left > view.right - 40 ? left - view.left - 60 : 0, behavior: "smooth" });
      }),
    [],
  );

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

  // The canvas: the page, a margin of one page width at each side, and the column (it starts at the right of the page).
  const fullWidth = Math.max(pageWidth + 2 * margin, margin + pageWidth + (side === null ? 0 : side.gap + side.width));
  const placing = mode === "comment" || mode === "note" || smallTool !== null;
  const drawingMode = mode === "pen" && !readOnly;

  // A new small item: a vault item inside the link object (SPEC 1.1), at the click, pointing to the selected text.
  const addItem = (event: ReactPointerEvent) => {
    const [x, y] = pagePoint(event.clientX, event.clientY);
    const view = smallTool?.view ?? (mode === "comment" ? "comment" : "note");
    const { command, itemId } = createInside(session.context, {
      homeId,
      view,
      at: [x, y],
      w: view === "comment" ? 200 : 170,
      author: view === "comment" ? settings.userName : undefined,
      color: view === "note" ? INK[color] : undefined,
      quote: smallTool?.anchor?.text,
      quoteAt: smallTool?.anchor?.at,
    });
    if (!runVault(command)) return;
    setEditing(itemId);
    if (smallTool !== null) usedSmallTool();
    else onPlaced?.();
  };
  void nanoid;

  /** The eraser: removes the highlight under a point of the app window. */
  const eraseHighlightAt = (clientX: number, clientY: number) => {
    const [x, y] = pagePoint(clientX, clientY);
    const hit = marks.find((mark) => mark.color !== "spoken" && mark.color !== "find" && mark.color !== "find-current" && mark.color !== "link" && mark.boxes.some((box) => x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height));
    if (hit !== undefined) change({ ...notes, highlights: notes.highlights.filter((highlight) => highlight.id !== hit.id) });
  };


  return (
    <div className="reader-frame">
    <div ref={scroller} className={`reader-scroller mode-${mode}${className === undefined ? "" : ` ${className}`}`} onScroll={onScroll}>
      <div ref={sizer} className={`reader-sizer${settings.readerInvert ? " inverted-page" : ""}`} style={{ width: fullWidth * zoom, height: pageHeight * zoom }}>
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
              className={`reader-mark${mark.color in FILL ? "" : ` ${mark.color}`}`}
              style={{ left: (margin + box.left) * zoom, top: box.top * zoom, width: mark.color === "ready" ? 2 : box.width * zoom, height: box.height * zoom, background: mark.color in FILL ? FILL[mark.color as NoteColor] : undefined }}
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
            // A click on the canvas itself or on a margin (not on an item, a link curve, or the column).
            const target = event.target as Element;
            if (event.button !== 0 || (target !== event.currentTarget && !target.classList.contains("reader-margin"))) return;
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
          {side !== null && side.render(margin + pageWidth + side.gap)}
          {leftNotes}
          {shadows}
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
          <InsideCurves entries={entries} margin={margin} anchorBox={anchorBox} />
          {entries.map((entry) => (
            <InsideItemView
              key={entry.item.id}
              entry={entry}
              margin={margin}
              zoom={zoom}
              mode={mode}
              readOnly={readOnly}
              editing={editing === entry.item.id}
              onEdit={(on) => setEditing(on ? entry.item.id : null)}
              onMove={(x, y) => runVault(moveInside(session.context, entry, [x, y]))}
              onRemove={() => runVault(deleteThread(session.context, entry.item.id))}
              onUnpoint={entry.quote === null ? undefined : () => runVault(pointInside(session.context, entry, null))}
              onDone={() => runVault(completeItems(session.context, [entry.item.id]))}
              onOpenUrl={(url) => actions.jumpTo(url, entry.item.id)}
              onTyping={onTyping}
            />
          ))}
        </div>
      </div>
    </div>
    </div>
  );
}

