// The small items of a page: its comments, notes, and links. A page is a medium-sized item: it holds small items.
// - They show in the page only. On the board, the page card shows a dot while it has open comments.
// - At first they are in a column tight at the right edge of the text. Drag the head of one to put it anywhere
//   (ItemRecord.pageAt: [x, y] from the top-right corner of the text). A comment folds to its head.
// - A thread: a comment and its replies. "Resolve" hides the thread; it stays (with its history) until it is deleted.
// - A comment on a passage shows the passage. A click on it marks the passage in the text.
// - New comments live on the home board of the item, attached to it (ItemRecord.on). On that board they show
//   at the side of the item card. Replies have no placement: they show in their thread.

import { COMMENT_WIDTH_RANGE } from "../../io/settings";
import { uiLocale } from "../i18n/i18n";
import { CheckCheck, ChevronDown, ChevronRight, Globe, MessageSquare, MessageSquarePlus, Reply, RotateCcw, StickyNote, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createItemOnBoard, createReply, deleteThread, setPageAt, setResolved, writeText } from "../../core/actions";
import type { ActionContext } from "../../core/actions";
import type { Id, ItemRecord } from "../../core/types";
import { useRunCommand, useSession, useSessionState, useStoreRevision } from "../app/sessionContext";
import { useWorkspaceActions } from "../app/workspaceActions";
import { hostOf, ReplyInput } from "../board/nodes";
import { fileNameOfPath, isLocalPath } from "../web/savedPages";

const NEW_COMMENT_EVENT = "inspoboard-new-comment";

/**
 * Creates a comment attached to an item (optionally on a text passage) on the home board of the item.
 * Returns the command and the new comment ID. The comment column opens it for typing.
 */
export function commentCommand(context: ActionContext, rootId: Id, itemId: Id, author: string, quote?: string) {
  const home = context.graph.homeOf(itemId);
  return createItemOnBoard(context, { boardId: home?.from ?? rootId, view: "comment", x: (home?.x ?? 0) + (home?.w ?? 200) + 18, y: home?.y ?? 0, on: itemId, author, quote });
}

/** Creates a note in a page: a note item attached to the page item, on the home board of the page (hidden there). */
export function pageNoteCommand(context: ActionContext, rootId: Id, itemId: Id) {
  const home = context.graph.homeOf(itemId);
  return createItemOnBoard(context, { boardId: home?.from ?? rootId, view: "note", x: (home?.x ?? 0) + (home?.w ?? 200) + 18, y: home?.y ?? 0, on: itemId });
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
export function useCommentColumn(itemId: Id): { shown: boolean; toggle(): void; open: number; add(): void; addNote(): void } {
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
  const open = attachedParts(session, itemId).comments.filter((comment) => comment.resolved !== true).length;
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
    addNote: () => {
      const { command, itemId: noteId } = pageNoteCommand(session.context, session.rootId, itemId);
      if (runCommand(command)) announceNewComment(itemId, noteId);
    },
  };
}

export function CommentColumn({ itemId }: { itemId: Id }) {
  const session = useSession();
  const { readOnly, settings } = useSessionState();
  const runCommand = useRunCommand();
  const actions = useWorkspaceActions();
  useStoreRevision();
  const [editing, setEditing] = useState<Id | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [, setFoldRevision] = useState(0);
  const { comments, notes, links } = attachedParts(session, itemId);
  const resolved = comments.filter((comment) => comment.resolved === true);
  const shown = comments.filter((comment) => comment.resolved !== true || showResolved);

  useEffect(() => {
    const onNew = (event: Event) => {
      const detail = (event as CustomEvent<{ itemId: Id; commentId: Id }>).detail;
      if (detail.itemId === itemId) setEditing(detail.commentId);
    };
    window.addEventListener(NEW_COMMENT_EVENT, onNew);
    return () => window.removeEventListener(NEW_COMMENT_EVENT, onNew);
  }, [itemId]);

  const move = (id: Id) => (spot: [number, number]) => runCommand(setPageAt(session.context, id, spot));
  const objects = [
    ...shown.map((comment) => ({
      item: comment,
      view: (
        <Thread
          comment={comment}
          editing={editing}
          readOnly={readOnly}
          folded={folded.has(comment.id) && editing !== comment.id}
          onFold={() => {
            if (folded.has(comment.id)) folded.delete(comment.id);
            else folded.add(comment.id);
            setFoldRevision((count) => count + 1);
          }}
          onEdit={setEditing}
          onQuote={() => comment.quote !== undefined && actions.openAt(itemId, { quote: comment.quote })}
          onReply={(text) => runCommand(createReply(session.context, comment.id, settings.userName, text).command)}
          onResolve={(value) => runCommand(setResolved(session.context, comment.id, value))}
          onDelete={(id) => runCommand(deleteThread(session.context, id))}
          onMove={move(comment.id)}
        />
      ),
    })),
    ...notes.map((note) => ({
      item: note,
      view: <PageNote note={note} editing={editing === note.id} readOnly={readOnly} onEdit={(on) => setEditing(on ? note.id : null)} onDelete={() => runCommand(deleteThread(session.context, note.id))} onMove={move(note.id)} />,
    })),
  ];
  const placed = objects.filter(({ item }) => item.pageAt !== undefined);
  const inColumn = objects.filter(({ item }) => item.pageAt === undefined);
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
        {inColumn.map(({ item, view }) => (
          <div key={item.id} className="page-object">
            {view}
          </div>
        ))}
        {comments.length === 0 && notes.length === 0 && links.length === 0 && <div className="comment-empty">No comments. Select text and right-click → “Comment”.</div>}
        {resolved.length > 0 && (
          <button className="comment-resolved-toggle" onClick={() => setShowResolved((value) => !value)}>
            {showResolved ? "Hide resolved" : `Show resolved (${resolved.length})`}
          </button>
        )}
      </aside>
      {/* Small items that the user put somewhere: [x, y] from the top-right corner of the text. */}
      {placed.map(({ item, view }) => (
        <div key={item.id} className="page-object placed" style={{ left: `calc(100% + ${item.pageAt![0]}px)`, top: item.pageAt![1], width }}>
          {view}
        </div>
      ))}
    </>
  );
}

/**
 * A drag on the head of a small item moves it anywhere in the page. During the drag it only shows the move.
 * On release, its new place ([x, y] from the top-right corner of the text) is saved.
 */
function useMove(readOnly: boolean, onMove: (spot: [number, number]) => void) {
  const [delta, setDelta] = useState<[number, number] | null>(null);
  const onPointerDown = (event: React.PointerEvent) => {
    if (readOnly || event.button !== 0 || (event.target as Element).closest("button, textarea, input") !== null) return;
    const box = (event.currentTarget as HTMLElement).closest(".page-object");
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
    };
    const up = () => {
      head.removeEventListener("pointermove", move);
      head.removeEventListener("pointerup", up);
      head.removeEventListener("pointercancel", up);
      setDelta(null);
      // A click (no real move) does not move the item.
      if (Math.hypot(last[0], last[1]) >= 3) onMove([origin[0] + last[0], origin[1] + last[1]]);
    };
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", up);
    head.addEventListener("pointercancel", up);
  };
  return { dragging: delta !== null, style: delta === null ? undefined : { transform: `translate(${delta[0]}px, ${delta[1]}px)` }, onPointerDown };
}

type ThreadProps = {
  comment: ItemRecord;
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
};

function Thread({ comment, editing, readOnly, folded, onFold, onEdit, onQuote, onReply, onResolve, onDelete, onMove }: ThreadProps) {
  const session = useSession();
  const [replying, setReplying] = useState(false);
  const mover = useMove(readOnly, onMove);
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
          </>
        )}
        {folded && replies.length > 0 && <span className="comment-reply-count">{replies.length}</span>}
      </Entry>
      {!folded && (
        <>
          {comment.quote !== undefined && (
            <button className="comment-quote" data-tip="Show the passage" onClick={onQuote}>
              “{comment.quote}”
            </button>
          )}
          {replies.map((reply) => (
            <div key={reply.id} className="comment-reply-entry">
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

type PageNoteProps = { note: ItemRecord; editing: boolean; readOnly: boolean; onEdit(on: boolean): void; onDelete(): void; onMove(spot: [number, number]): void };

/** A sticky note in a page: its head moves it; double-click its text to write. */
function PageNote({ note, editing, readOnly, onEdit, onDelete, onMove }: PageNoteProps) {
  const session = useSession();
  const mover = useMove(readOnly, onMove);
  const body = session.store.get("texts", note.id)?.body ?? "";
  return (
    <div className={`page-note${mover.dragging ? " dragging" : ""}`} style={mover.style}>
      <div className={`page-note-head${readOnly ? "" : " movable"}`} onPointerDown={mover.onPointerDown}>
        <StickyNote size={11} />
        <span className="spacer" />
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

/** The comment buttons for a page head: show or hide the column (with the number of open threads), and add one. */
export function CommentButtons({ itemId, column }: { itemId: Id; column: ReturnType<typeof useCommentColumn> }) {
  const { readOnly } = useSessionState();
  return (
    <>
      <button className={`icon-button comment-toggle${column.shown ? " active" : ""}`} data-tip={column.shown ? "Hide comments" : "Show comments"} onClick={column.toggle} aria-label={`Comments of ${itemId}`}>
        <MessageSquare size={15} />
        {column.open > 0 && <span className="comment-count">{column.open}</span>}
      </button>
      {!readOnly && (
        <>
          <button className="icon-button" data-tip="Add a comment" onClick={column.add}>
            <MessageSquarePlus size={15} />
          </button>
          <button className="icon-button" data-tip="Add a note to the page" onClick={column.addNote}>
            <StickyNote size={15} />
          </button>
        </>
      )}
    </>
  );
}
