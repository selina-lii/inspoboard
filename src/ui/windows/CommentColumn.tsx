// The small items of a page: comments, notes, action items, flashcards, quotes, texts, and web links (SPEC 1.1).
// A page is a medium-sized item: it holds small items (inside links, core/inside.ts; older vaults: `on` + `pageAt`).
// - They show in the page only. On the board, the page card shows a dot while it has open comments.
// - At first they are in a column tight at the right edge of the text (ordered by the place of their text, then by
//   time). Drag the head of one to put it anywhere ([x, y] from the top-right corner of the text). A comment folds.
// - A thread: a comment and its replies. "Resolve" hides the thread; it stays (with its history) until it is deleted.
// - An item that points to text has a faint dashed curve to that text (AnchorCurves). A click on the quote of a
//   comment marks the passage in the text.
// - Other items (a note in a window, a card on a board): their comments are attached (ItemRecord.on) and show here
//   too. On the board they show at the side of the card. Replies have no placement: they show in their thread.

import { COMMENT_WIDTH_RANGE } from "../../io/settings";
import { uiLocale } from "../i18n/i18n";
import { Check, CheckCheck, ChevronDown, ChevronRight, Globe, Highlighter, Layers, MessageSquare, MessageSquarePlus, Quote, Reply, RotateCcw, StickyNote, Trash2, Type, Unlink } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { completeItems, createItemOnBoard, createReply, deleteThread, setPageAt, setResolved, writeText } from "../../core/actions";
import type { ActionContext } from "../../core/actions";
import { createInside, insideEntries, isPageHome, moveInside, moveOut, pointInside, type InsideEntry } from "../../core/inside";
import type { Id, ItemRecord, ViewStyle } from "../../core/types";
import type { TextEditorApi } from "../editor/TextEditor";
import { findQuote } from "../web/savedPages";
import { SmallItemButton, type TextAnchor } from "../app/smallTool";
import { boardPointAt, pagePointAt } from "../app/boardDrop";
import { useRunCommand, useSession, useSessionState, useStoreRevision } from "../app/sessionContext";
import { useWorkspaceActions } from "../app/workspaceActions";
import { benchSlotAt, hoverBench, sendToBench } from "../app/LinkBench";
import { hostOf, ReplyInput } from "../board/nodes";
import { fileNameOfPath, isLocalPath } from "../web/savedPages";

const NEW_COMMENT_EVENT = "inspoboard-new-comment";

/**
 * Creates a comment on an item (optionally on a text passage). In a page: inside the page (SPEC 1.1). On other items:
 * attached to the item, on its home board. Returns the command and the new comment ID. The comment column opens it
 * for typing.
 */
export function commentCommand(context: ActionContext, rootId: Id, itemId: Id, author: string, quote?: string, quoteAt?: number) {
  if (isPageHome(context.store, context.graph, itemId)) return createInside(context, { homeId: itemId, view: "comment", at: null, author, quote, quoteAt });
  const home = context.graph.homeOf(itemId);
  return createItemOnBoard(context, { boardId: home?.from ?? rootId, view: "comment", x: (home?.x ?? 0) + (home?.w ?? 200) + 18, y: home?.y ?? 0, on: itemId, author, quote });
}

/** Creates a small item inside a page at a place (or in the column: null), optionally pointing to text. */
export function smallItemCommand(context: ActionContext, pageId: Id, view: ViewStyle, at: [number, number] | null, author: string, anchor: TextAnchor | null) {
  return createInside(context, { homeId: pageId, view, at, author: view === "comment" ? author : undefined, quote: anchor?.text, quoteAt: anchor?.at });
}

/** Tells the comment column of an item to show and to open a new comment for typing. */
export function announceNewComment(itemId: Id, commentId: Id): void {
  window.dispatchEvent(new CustomEvent<{ itemId: Id; commentId: Id }>(NEW_COMMENT_EVENT, { detail: { itemId, commentId } }));
}

/** The comment threads and the links of an item. Link objects have a web address; all other attached objects are comments. */
export function attachedParts(session: { store: ActionContext["store"]; graph: ActionContext["graph"] }, itemId: Id): { comments: ItemRecord[]; notes: ItemRecord[]; links: ItemRecord[] } {
  const attached = session.graph.attachedTo(itemId);
  const viewOf = (item: ItemRecord) => session.graph.parentsOf(item.id).find((place) => place.kind === "place")?.view;
  const links = attached.filter((item) => item.url !== undefined || viewOf(item) === "weblink");
  const notes = attached.filter((item) => !links.includes(item) && viewOf(item) === "note");
  return { comments: attached.filter((item) => !links.includes(item) && !notes.includes(item)), notes, links };
}

/** Folded comments. View state for the app session (not saved). */
const folded = new Set<Id>();

/** Whether the column shows. View state for the app session (not saved). It shows by default. */
let shownForSession = true;

/** The button in the page head: shows or hides the column, and the number of open threads. */
export function useCommentColumn(itemId: Id): { shown: boolean; toggle(): void; open: number; add(): void } {
  const session = useSession();
  const { settings } = useSessionState();
  const runCommand = useRunCommand();
  useStoreRevision();
  const [shown, setShown] = useState(shownForSession);
  useEffect(() => {
    const onNew = (event: Event) => {
      if ((event as CustomEvent<{ itemId: Id }>).detail.itemId !== itemId) return;
      shownForSession = true;
      setShown(true);
    };
    window.addEventListener(NEW_COMMENT_EVENT, onNew);
    return () => window.removeEventListener(NEW_COMMENT_EVENT, onNew);
  }, [itemId]);
  const open = smallParts(session, itemId).comments.filter((comment) => comment.item.resolved !== true).length;
  return {
    shown,
    open,
    toggle: () => {
      shownForSession = !shown;
      setShown(!shown);
    },
    add: () => {
      const { command, itemId: commentId } = commentCommand(session.context, session.rootId, itemId, settings.userName);
      if (runCommand(command)) announceNewComment(itemId, commentId);
    },
  };
}

/** One small item of the column: its record, kind, place, and text anchor. `entry`: null for an attached object. */
type Part = { item: ItemRecord; view: ViewStyle; at: [number, number] | null; quote: string | null; quoteAt: number | null; color: string | null; entry: InsideEntry | null };

/**
 * The small items of an item, by kind. A page: the items inside it. Other items: the attached comments and notes,
 * and the attached links.
 */
export function smallParts(session: { store: ActionContext["store"]; graph: ActionContext["graph"] }, itemId: Id): { comments: Part[]; others: Part[]; links: ItemRecord[] } {
  if (isPageHome(session.store, session.graph, itemId)) {
    const parts = insideEntries(session.store, session.graph, itemId).map((entry): Part => ({ item: entry.item, view: entry.view, at: entry.at, quote: entry.quote, quoteAt: entry.quoteAt, color: entry.color, entry }));
    return { comments: parts.filter((part) => part.view === "comment"), others: parts.filter((part) => part.view !== "comment"), links: [] };
  }
  const { comments, notes, links } = attachedParts(session, itemId);
  const part = (item: ItemRecord, view: ViewStyle): Part => ({ item, view, at: item.pageAt ?? null, quote: item.quote ?? null, quoteAt: null, color: null, entry: null });
  return { comments: comments.map((item) => part(item, "comment")), others: notes.map((item) => part(item, "note")), links };
}

export function CommentColumn({ itemId, editorRef }: { itemId: Id; editorRef?: MutableRefObject<TextEditorApi | null> }) {
  const session = useSession();
  const { readOnly, settings } = useSessionState();
  const runCommand = useRunCommand();
  const actions = useWorkspaceActions();
  useStoreRevision();
  const [editing, setEditing] = useState<Id | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [, setFoldRevision] = useState(0);
  const { comments, others, links } = smallParts(session, itemId);
  const resolved = comments.filter((comment) => comment.item.resolved === true);
  const shown = comments.filter((comment) => comment.item.resolved !== true || showResolved);

  useEffect(() => {
    const onNew = (event: Event) => {
      const detail = (event as CustomEvent<{ itemId: Id; commentId: Id }>).detail;
      if (detail.itemId === itemId) setEditing(detail.commentId);
    };
    window.addEventListener(NEW_COMMENT_EVENT, onNew);
    return () => window.removeEventListener(NEW_COMMENT_EVENT, onNew);
  }, [itemId]);

  const move = (part: Part) => (spot: [number, number]) => runCommand(part.entry !== null ? moveInside(session.context, part.entry, spot) : setPageAt(session.context, part.item.id, spot));
  // "Stop pointing to the text": only for an item inside a page that points to text.
  const unpoint = (part: Part) => (part.entry === null || part.quote === null ? undefined : () => runCommand(pointInside(session.context, part.entry!, null)));
  // Out of the page onto the board: a free card there (only items inside a page).
  const out = (part: Part) => (part.entry === null ? undefined : (point: { boardId: Id; x: number; y: number }) => runCommand(moveOut(session.context, part.entry!, point.boardId, point.x, point.y).command));
  const objects = [
    ...shown.map((part) => ({
      part,
      view: (
        <Thread
          comment={part.item}
          quote={part.quote}
          editing={editing}
          readOnly={readOnly}
          folded={folded.has(part.item.id) && editing !== part.item.id}
          onFold={() => {
            if (folded.has(part.item.id)) folded.delete(part.item.id);
            else folded.add(part.item.id);
            setFoldRevision((count) => count + 1);
          }}
          onEdit={setEditing}
          onQuote={() => part.quote !== null && actions.openAt(itemId, { quote: part.quote })}
          onReply={(text) => runCommand(createReply(session.context, part.item.id, settings.userName, text).command)}
          onResolve={(value) => runCommand(setResolved(session.context, part.item.id, value))}
          onDelete={(id) => runCommand(deleteThread(session.context, id))}
          onMove={move(part)}
          onOut={out(part)}
          onUnpoint={unpoint(part)}
        />
      ),
    })),
    ...others.map((part) => ({
      part,
      view:
        part.view === "note" ? (
          <PageNote note={part.item} color={part.color} editing={editing === part.item.id} readOnly={readOnly} onEdit={(on) => setEditing(on ? part.item.id : null)} onDelete={() => runCommand(deleteThread(session.context, part.item.id))} onMove={move(part)} onOut={out(part)} onUnpoint={unpoint(part)} />
        ) : (
          <PageSmall
            part={part}
            editing={editing === part.item.id}
            readOnly={readOnly}
            onEdit={(on) => setEditing(on ? part.item.id : null)}
            onDelete={() => runCommand(deleteThread(session.context, part.item.id))}
            onDone={() => runCommand(completeItems(session.context, [part.item.id]))}
            onOpenUrl={(url) => actions.jumpTo(url)}
            onMove={move(part)}
            onOut={out(part)}
            onUnpoint={unpoint(part)}
          />
        ),
    })),
  ];
  const placed = objects.filter(({ part }) => part.at !== null);
  // The column: by the place of the text that an item points to (items with no text after), then by time.
  const body = session.store.get("texts", itemId)?.body ?? "";
  const textPlace = (part: Part) => (part.quote === null ? Number.POSITIVE_INFINITY : (findQuote(body, part.quote, part.quoteAt ?? 0)?.start ?? Number.POSITIVE_INFINITY));
  const inColumn = objects
    .filter(({ part }) => part.at === null)
    .map((object) => ({ object, place: textPlace(object.part) }))
    .sort((a, b) => (a.place !== b.place ? a.place - b.place : a.object.part.item.created < b.object.part.item.created ? -1 : a.object.part.item.created > b.object.part.item.created ? 1 : 0))
    .map(({ object }) => object);
  // The column width: a setting. A drag on its right edge changes it (saved on release).
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const width = dragWidth ?? settings.commentWidth;
  const onResize = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const start = settings.commentWidth;
    let next = start;
    const move = (pointer: globalThis.PointerEvent) => {
      next = Math.round(Math.min(COMMENT_WIDTH_RANGE.max, Math.max(COMMENT_WIDTH_RANGE.min, start + pointer.clientX - startX)));
      setDragWidth(next);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setDragWidth(null);
      if (next !== start) void session.updateSettings({ commentWidth: next });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  return (
    <>
      <aside className="comment-column" aria-label="Comments and notes" style={{ width }}>
        <span className="comment-resize" data-tip="Drag: change the width of the comments" onPointerDown={onResize} />
        {links.map((link) => (
          <button key={link.id} className="comment-link" data-tip={link.url ?? ""} onClick={() => link.url !== undefined && actions.jumpTo(link.url)}>
            <Globe size={12} />
            <span>{link.name !== "" ? link.name : link.url === undefined ? "Link" : isLocalPath(link.url) ? fileNameOfPath(link.url) : hostOf(link.url)}</span>
          </button>
        ))}
        {inColumn.map(({ part, view }) => (
          <div key={part.item.id} className="page-object" data-item-id={part.item.id}>
            {view}
          </div>
        ))}
        {comments.length === 0 && others.length === 0 && links.length === 0 && <div className="comment-empty">No comments. Select text and right-click → “Comment”, or use the small-item button.</div>}
        {resolved.length > 0 && (
          <button className="comment-resolved-toggle" onClick={() => setShowResolved((value) => !value)}>
            {showResolved ? "Hide resolved" : `Show resolved (${resolved.length})`}
          </button>
        )}
      </aside>
      {/* Small items that the user put somewhere: [x, y] from the top-right corner of the text. */}
      {placed.map(({ part, view }) => (
        <div key={part.item.id} className="page-object placed" data-item-id={part.item.id} style={{ left: `calc(100% + ${part.at![0]}px)`, top: part.at![1], width }}>
          {view}
        </div>
      ))}
      {editorRef !== undefined && <AnchorCurves parts={[...shown, ...others]} body={body} editorRef={editorRef} />}
    </>
  );
}

/**
 * The faint dashed curves from each small item to the text that it points to (SPEC 1.1). Stronger while the item is
 * hovered or selected. They follow the layout (scroll, resize, a drag, an edit).
 */
function AnchorCurves({ parts, body, editorRef }: { parts: Part[]; body: string; editorRef: MutableRefObject<TextEditorApi | null> }) {
  const svg = useRef<SVGSVGElement>(null);
  const [curves, setCurves] = useState<{ id: Id; d: string; end: [number, number] }[]>([]);
  const [hot, setHot] = useState<Id | null>(null);
  const anchored = parts.filter((part) => part.quote !== null);
  const key = anchored.map((part) => `${part.item.id}:${part.quote}:${part.quoteAt}:${part.at?.join(",")}`).join("|");
  useLayoutEffect(() => {
    const frame = svg.current?.parentElement;
    if (frame == null || anchored.length === 0) {
      setCurves([]);
      return;
    }
    let request = 0;
    const measure = () => {
      cancelAnimationFrame(request);
      request = requestAnimationFrame(() => {
        const view = editorRef.current?.view();
        const origin = frame.getBoundingClientRect();
        const next: { id: Id; d: string; end: [number, number] }[] = [];
        for (const part of anchored) {
          const box = frame.querySelector(`.page-object[data-item-id="${part.item.id}"]`)?.getBoundingClientRect();
          const found = findQuote(view?.state.doc.toString() ?? body, part.quote!, part.quoteAt ?? 0);
          if (box === undefined || found === null || view == null) continue;
          const end = view.coordsAtPos(Math.min(found.end, view.state.doc.length), -1);
          if (end === null) continue;
          const tx = end.right - origin.left;
          const ty = (end.top + end.bottom) / 2 - origin.top;
          // From the side of the item that faces the text.
          const left = box.left - origin.left;
          const right = box.right - origin.left;
          const sx = Math.abs(left - tx) < Math.abs(right - tx) ? left : right;
          const sy = Math.min(Math.max(ty, box.top - origin.top + 10), box.bottom - origin.top - 10);
          const bend = Math.max(30, Math.abs(sx - tx) / 2) * (sx > tx ? -1 : 1);
          next.push({ id: part.item.id, d: `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`, end: [tx, ty] });
        }
        setCurves(next);
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    const scroller = frame.closest(".text-page") ?? window;
    scroller.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    const onOver = (event: Event) => setHot((event.target as Element).closest?.(".page-object")?.getAttribute("data-item-id") ?? null);
    frame.addEventListener("pointerover", onOver);
    // A drag moves an item with a transform: measure while the pointer moves.
    frame.addEventListener("pointermove", measure);
    return () => {
      cancelAnimationFrame(request);
      observer.disconnect();
      scroller.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      frame.removeEventListener("pointerover", onOver);
      frame.removeEventListener("pointermove", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, body, editorRef]);
  return (
    <svg ref={svg} className="anchor-curves" aria-hidden="true">
      {curves.map((curve) => (
        <g key={curve.id} className={curve.id === hot ? "hot" : undefined}>
          <path d={curve.d} />
          <circle cx={curve.end[0]} cy={curve.end[1]} r={2.5} />
        </g>
      ))}
    </svg>
  );
}

/** The button that ends the pointing of a small item to text (its dashed curve). It shows while the item is hovered. */
function UnpointButton({ onUnpoint }: { onUnpoint?: () => void }) {
  if (onUnpoint === undefined) return null;
  return (
    <button className="icon-button small unpoint-button" data-tip="Stop pointing to the text (the curve goes)" onClick={onUnpoint}>
      <Unlink size={12} />
    </button>
  );
}

const SMALL_ICONS: Partial<Record<ViewStyle, typeof Globe>> = { weblink: Globe, todo: Highlighter, flashcard: Layers, quote: Quote, text: Type };

type OutHandler = ((point: { boardId: Id; x: number; y: number }) => void) | undefined;
type PageSmallProps = { part: Part; editing: boolean; readOnly: boolean; onEdit(on: boolean): void; onDelete(): void; onDone(): void; onOpenUrl(url: string): void; onMove(spot: [number, number]): void; onOut?: OutHandler; onUnpoint?: () => void };

/** An action item, flashcard, quote, text, or web link in a page: its head moves it; double-click its text to write. */
function PageSmall({ part, editing, readOnly, onEdit, onDelete, onDone, onOpenUrl, onMove, onOut, onUnpoint }: PageSmallProps) {
  const session = useSession();
  const mover = useMove(readOnly, onMove, onOut);
  const body = session.store.get("texts", part.item.id)?.body ?? "";
  const Icon = SMALL_ICONS[part.view] ?? StickyNote;
  const url = part.item.url;
  return (
    <div className={`page-note page-small kind-${part.view}${mover.dragging ? " dragging" : ""}`} style={{ ...mover.style, ...(part.color !== null ? { "--small-color": part.color } : {}) } as React.CSSProperties}>
      <div className={`page-note-head${readOnly ? "" : " movable"}`} onPointerDown={mover.onPointerDown}>
        <Icon size={11} />
        {part.item.name !== "" && (
          <span className="page-small-name" dir="auto" translate="no">
            {part.item.name}
          </span>
        )}
        <span className="spacer" />
        {!readOnly && <UnpointButton onUnpoint={onUnpoint} />}
        {!readOnly && part.view === "todo" && (
          <button className="icon-button small" data-tip="Done (removes the action item)" onClick={onDone}>
            <Check size={12} />
          </button>
        )}
        {!readOnly && (
          <button className="icon-button small" data-tip="Delete" data-tip-end onClick={onDelete}>
            <Trash2 size={12} />
          </button>
        )}
      </div>
      {url !== undefined && url !== "" && (
        <button className="comment-link" data-tip={url} onClick={() => onOpenUrl(url)}>
          <Globe size={12} />
          <span>{isLocalPath(url) ? fileNameOfPath(url) : hostOf(url)}</span>
        </button>
      )}
      {editing ? (
        <textarea
          autoFocus
          className="page-note-input"
          defaultValue={body}
          placeholder={part.view === "weblink" ? "https://… or a note" : "Write…"}
          onChange={(event) => session.store.has("items", part.item.id) && writeText(session.store, part.item.id, event.target.value)}
          onBlur={() => onEdit(false)}
          onKeyDown={(event) => event.key === "Escape" && event.currentTarget.blur()}
        />
      ) : (
        <div className={`page-note-text${part.view === "quote" ? " page-small-quote" : ""}`} dir="auto" onDoubleClick={() => !readOnly && onEdit(true)}>
          {body !== "" ? body : <span className="untitled">Double-click to write</span>}
        </div>
      )}
    </div>
  );
}

/**
 * A drag on the head of a small item moves it anywhere in the page. During the drag it only shows the move.
 * On release, its new place ([x, y] from the top-right corner of the text) is saved.
 * A release on the link bench puts the item in the bench instead. The item does not move.
 * A release on the board (outside the page) moves the item out of the page onto the board (`onOut`, SPEC 1.1).
 */
function useMove(readOnly: boolean, onMove: (spot: [number, number]) => void, onOut?: (point: { boardId: Id; x: number; y: number }) => void) {
  const [delta, setDelta] = useState<[number, number] | null>(null);
  const onPointerDown = (event: React.PointerEvent) => {
    if (readOnly || event.button !== 0 || (event.target as Element).closest("button, textarea, input") !== null) return;
    const box = (event.currentTarget as HTMLElement).closest(".page-object");
    const itemId = box?.getAttribute("data-item-id") ?? null;
    const body = box?.closest(".text-page-body");
    if (box == null || body == null) return;
    event.preventDefault();
    const boxRect = box.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const origin: [number, number] = [boxRect.left - bodyRect.right, boxRect.top - bodyRect.top];
    const start = { x: event.clientX, y: event.clientY };
    const head = event.currentTarget as HTMLElement;
    head.setPointerCapture(event.pointerId);
    let last: [number, number] = [0, 0];
    const move = (next: globalThis.PointerEvent) => {
      last = [next.clientX - start.x, next.clientY - start.y];
      setDelta(last);
      hoverBench(benchSlotAt(next.clientX, next.clientY));
    };
    const up = (end: globalThis.PointerEvent) => {
      head.removeEventListener("pointermove", move);
      head.removeEventListener("pointerup", up);
      head.removeEventListener("pointercancel", up);
      setDelta(null);
      hoverBench(null);
      // A click (no real move) does not move the item.
      if (Math.hypot(last[0], last[1]) < 3) return;
      const slot = end.type === "pointerup" ? benchSlotAt(end.clientX, end.clientY) : null;
      const board = end.type === "pointerup" && onOut !== undefined && pagePointAt(end.clientX, end.clientY) === null ? boardPointAt(end.clientX, end.clientY) : null;
      if (slot !== null && itemId !== null) sendToBench({ itemId }, slot === "bench" ? undefined : slot);
      else if (board !== null) onOut!(board);
      else onMove([origin[0] + last[0], origin[1] + last[1]]);
    };
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", up);
    head.addEventListener("pointercancel", up);
  };
  return { dragging: delta !== null, style: delta === null ? undefined : { transform: `translate(${delta[0]}px, ${delta[1]}px)` }, onPointerDown };
}

type ThreadProps = {
  comment: ItemRecord;
  /** The passage that the comment points to. */
  quote: string | null;
  editing: Id | null;
  readOnly: boolean;
  folded: boolean;
  onFold(): void;
  onEdit(id: Id | null): void;
  onQuote(): void;
  onReply(text: string): void;
  onResolve(resolved: boolean): void;
  onDelete(id: Id): void;
  onMove(spot: [number, number]): void;
  onOut?: OutHandler;
  onUnpoint?: () => void;
};

function Thread({ comment, quote, editing, readOnly, folded, onFold, onEdit, onQuote, onReply, onResolve, onDelete, onMove, onOut, onUnpoint }: ThreadProps) {
  const session = useSession();
  const [replying, setReplying] = useState(false);
  const mover = useMove(readOnly, onMove, onOut);
  const replies: ItemRecord[] = [];
  const walk = (id: Id) => {
    for (const reply of session.graph.attachedTo(id)) {
      if (replies.includes(reply) || reply.id === comment.id) continue;
      replies.push(reply);
      walk(reply.id);
    }
  };
  walk(comment.id);
  const isResolved = comment.resolved === true;
  const fold = (
    <button className="icon-button small" data-tip={folded ? "Show the comment" : "Fold the comment"} onClick={onFold}>
      {folded ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
    </button>
  );
  return (
    <div className={`comment-entry${isResolved ? " resolved" : ""}${folded ? " folded" : ""}${mover.dragging ? " dragging" : ""}`} style={mover.style}>
      <Entry item={comment} editing={editing === comment.id} readOnly={readOnly} folded={folded} lead={fold} onEdit={(on) => onEdit(on ? comment.id : null)} onDelete={() => onDelete(comment.id)} onHeadPointerDown={mover.onPointerDown}>
        {!readOnly && !folded && (
          <>
            {!isResolved && (
              <button className="icon-button small" data-tip="Reply" onClick={() => setReplying(true)}>
                <Reply size={12} />
              </button>
            )}
            <button className="icon-button small" data-tip={isResolved ? "Open the thread again" : "Resolve: hide the thread (it stays)"} onClick={() => onResolve(!isResolved)}>
              {isResolved ? <RotateCcw size={12} /> : <CheckCheck size={12} />}
            </button>
            <UnpointButton onUnpoint={onUnpoint} />
          </>
        )}
        {folded && replies.length > 0 && <span className="comment-reply-count">{replies.length}</span>}
      </Entry>
      {!folded && (
        <>
          {quote !== null && (
            <button className="comment-quote" data-tip="Show the passage" onClick={onQuote}>
              “{quote}”
            </button>
          )}
          {replies.map((reply) => (
            <div key={reply.id} className="comment-reply-entry" data-item-id={reply.id}>
              <Entry item={reply} editing={editing === reply.id} readOnly={readOnly} onEdit={(on) => onEdit(on ? reply.id : null)} onDelete={() => onDelete(reply.id)} />
            </div>
          ))}
          {replying && (
            <ReplyInput
              onDone={(text) => {
                setReplying(false);
                if (text.trim() !== "") onReply(text.trim());
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

type PageNoteProps = { note: ItemRecord; color?: string | null; editing: boolean; readOnly: boolean; onEdit(on: boolean): void; onDelete(): void; onMove(spot: [number, number]): void; onOut?: OutHandler; onUnpoint?: () => void };

/** A sticky note in a page: its head moves it; double-click its text to write. */
function PageNote({ note, color = null, editing, readOnly, onEdit, onDelete, onMove, onOut, onUnpoint }: PageNoteProps) {
  const session = useSession();
  const mover = useMove(readOnly, onMove, onOut);
  const body = session.store.get("texts", note.id)?.body ?? "";
  return (
    <div className={`page-note${mover.dragging ? " dragging" : ""}`} style={{ ...mover.style, ...(color !== null ? { "--small-color": color } : {}) } as React.CSSProperties}>
      <div className={`page-note-head${readOnly ? "" : " movable"}`} onPointerDown={mover.onPointerDown}>
        <StickyNote size={11} />
        <span className="spacer" />
        {!readOnly && <UnpointButton onUnpoint={onUnpoint} />}
        {!readOnly && (
          <button className="icon-button small" data-tip="Delete the note" data-tip-end onClick={onDelete}>
            <Trash2 size={12} />
          </button>
        )}
      </div>
      {editing ? (
        <textarea
          autoFocus
          className="page-note-input"
          defaultValue={body}
          placeholder="Write a note…"
          onChange={(event) => session.store.has("items", note.id) && writeText(session.store, note.id, event.target.value)}
          onBlur={() => onEdit(false)}
          onKeyDown={(event) => event.key === "Escape" && event.currentTarget.blur()}
        />
      ) : (
        <div className="page-note-text" dir="auto" onDoubleClick={() => !readOnly && onEdit(true)}>
          {body !== "" ? body : <span className="untitled">Double-click to write</span>}
        </div>
      )}
    </div>
  );
}

type EntryProps = { item: ItemRecord; editing: boolean; readOnly: boolean; folded?: boolean; lead?: React.ReactNode; onEdit(on: boolean): void; onDelete(): void; onHeadPointerDown?(event: React.PointerEvent): void; children?: React.ReactNode };

/** One comment or reply: signature, time, text (double-click to edit), and its buttons. */
function Entry({ item, editing, readOnly, folded, lead, onEdit, onDelete, onHeadPointerDown, children }: EntryProps) {
  const session = useSession();
  const body = session.store.get("texts", item.id)?.body ?? "";
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) area.current?.focus();
  }, [editing]);
  const time = new Date(item.created);
  return (
    <>
      <div className={`comment-head${onHeadPointerDown !== undefined && !readOnly ? " movable" : ""}`} onPointerDown={onHeadPointerDown}>
        {lead}
        <MessageSquare size={11} />
        <span className="comment-author">{item.author ?? "Comment"}</span>
        {folded !== true && <span className="comment-time">{Number.isNaN(time.getTime()) ? "" : time.toLocaleString(uiLocale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>}
        {children}
        {!readOnly && folded !== true && (
          <button className="icon-button small comment-delete" data-tip="Delete (with its replies)" data-tip-end onClick={onDelete}>
            <Trash2 size={12} />
          </button>
        )}
      </div>
      {editing ? (
        <textarea
          ref={area}
          className="comment-input"
          defaultValue={body}
          placeholder="Write a comment…"
          onChange={(event) => session.store.has("items", item.id) && writeText(session.store, item.id, event.target.value)}
          onBlur={() => onEdit(false)}
          onKeyDown={(event) => event.key === "Escape" && event.currentTarget.blur()}
        />
      ) : (
        // A folded comment shows only the first line of its text.
        <div className={`comment-text${folded === true ? " folded" : ""}`} dir="auto" onDoubleClick={() => !readOnly && onEdit(true)}>
          {body !== "" ? body : <span className="untitled">Double-click to write</span>}
        </div>
      )}
    </>
  );
}

/**
 * The comment buttons for a page head: show or hide the column (with the number of open threads), and the small-item
 * button (all small kinds; then a click on the page makes one there). `selection`: the selected text of the page.
 */
export function CommentButtons({ itemId, column, selection }: { itemId: Id; column: ReturnType<typeof useCommentColumn>; selection(): TextAnchor | null }) {
  const { readOnly } = useSessionState();
  const session = useSession();
  useStoreRevision();
  // Only a page holds small items. A note (in a window) gets attached comments.
  const page = isPageHome(session.store, session.graph, itemId);
  return (
    <>
      <button className={`icon-button comment-toggle${column.shown ? " active" : ""}`} data-tip={column.shown ? "Hide comments" : "Show comments"} onClick={column.toggle} aria-label={`Comments of ${itemId}`}>
        <MessageSquare size={15} />
        {column.open > 0 && <span className="comment-count">{column.open}</span>}
      </button>
      {!readOnly && page && <SmallItemButton disabled={readOnly} selection={selection} />}
      {!readOnly && !page && (
        <button className="icon-button" data-tip="Add a comment" onClick={column.add}>
          <MessageSquarePlus size={15} />
        </button>
      )}
    </>
  );
}
