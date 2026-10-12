// Node components for the board. Data comes from BoardNode (boardModel.ts).

import { Handle, NodeResizer, Position, type Node, type NodeProps } from "@xyflow/react";
import { uiLocale } from "../i18n/i18n";
import {
  BookOpen,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  File as FileIcon,
  FileText,
  Globe,
  GripHorizontal,
  Layers,
  LayoutGrid,
  Link2,
  List,
  ListOrdered,
  MessageSquare,
  Minimize2,
  Minus,
  PenLine,
  Pencil,
  Reply,
  ScrollText,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { gridDays, monthTitle, WEEKDAYS, CALENDAR } from "../../core/groups";
import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent, type SVGProps } from "react";
import { cleanNumber, roundBoard } from "../../core/stamps";
import { DEFAULT_SIZE } from "../../core/actions";
import { isComposing } from "../app/keys";
import { useOverlay } from "../plugins/pluginsContext";
import type { ListStyle, QuoteMarks } from "../../core/types";
import { textColorOn } from "../app/vaultImages";
import { COLLAPSED_HEIGHT, previewOf, type BoardNode, type InnerStamp } from "./boardModel";
import { fileNameOfPath, isLocalPath } from "../web/savedPages";
import { useAnnotated } from "../web/annotatedPages";
import { useSession } from "../app/sessionContext";

export { COLLAPSED_HEIGHT };

/** True if the item has its own board. Such a card always has the board look. */
export function hasBoard(node: BoardNode): boolean {
  return node.isBoard;
}

/** True if the card shows only its name. Text cards without a board always show their text. */
export function isCollapsed(node: BoardNode): boolean {
  if (node.kind === "stamp" || node.kind === "stub" || node.kind === "outline" || node.kind === "calendar") return false;
  if (node.view === "text" && !hasBoard(node)) return false;
  // A group card is an area: it never folds to its name.
  if (node.view === "group" && !hasBoard(node)) return false;
  return !node.expanded;
}

/**
 * True if a link object shows its full name: as wide as the name (up to a limit), then on more lines.
 * Not in a calendar or an outline: there, rows have a fixed size and the name is cut.
 */
export function isFullLink(node: BoardNode): boolean {
  return node.kind === "item" && node.view === "weblink" && !hasBoard(node) && !node.inCalendar && node.outlineId === null;
}

/** The text of a link without a name: the full address (without "https://"), or only the host where space is small. */
function linkLabel(url: string, short: boolean): string {
  if (short) return hostOf(url);
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

/** True if the card is a quote card (not a board). */
export function isQuote(node: BoardNode): boolean {
  return node.kind === "item" && node.view === "quote" && !hasBoard(node);
}

/** True if the card is a note: short text on the board. It never opens as a page. */
export function isNote(node: BoardNode): boolean {
  return node.kind === "item" && node.view === "note" && !hasBoard(node);
}

/** What is edited in place. "shape": the size of a group frame (its resize handles show). */
export type InlineEdit = "title" | "body" | "url" | "month" | "shape" | null;

/**
 * `linkMode`: the link tool is active. A click on a card picks it as a link end.
 * `linkSource`: this card is the first end of a link that is not finished.
 */
export type BoardNodeData = {
  node: BoardNode;
  linkMode: boolean;
  linkSource: boolean;
  /** A drop now would move the dragged records into this board. */
  dropTarget?: boolean;
  editing: InlineEdit;
};
export type FlowNode = Node<BoardNodeData>;

/** Callbacks from node components to the board. */
export type BoardCallbacks = {
  readOnly: boolean;
  onResizeEnd(placeId: string, rect: { x: number; y: number; w: number; h: number }): void;
  onOpenRecord(recordId: string): void;
  onStartEdit(nodeId: string, edit: InlineEdit): void;
  onRename(itemId: string, name: string): void;
  onBodyChange(itemId: string, body: string): void;
  /** The user types in a card (its name or its text): a tool that stays on (double-click) turns off. */
  onTyping(): void;
  /** The current body text. The node reads it only when the inline editor opens. */
  bodyOf(itemId: string): string;
  onEndEdit(): void;
  onToggleExpanded(placeId: string, expanded: boolean): void;
  onOpenText(itemId: string): void;
  onOutlineList(outlineId: string, list: ListStyle | null): void;
  /** The outline frame got a new width (the full frame width, before and after). */
  onOutlineWidth(outlineId: string, before: number, after: number): void;
  onOutlineDocument(outlineId: string): void;
  onRenameGroup(groupId: string, name: string): void;
  /** Calendar: show a different month. */
  onCalendarMonth(calendarId: string, month: string): void;
  /** Calendar: show any month ("YYYY-MM"). A month outside the range makes the range larger. */
  onCalendarJump(calendarId: string, month: string): void;
  onSetUrl(itemId: string, url: string): void;
  onOpenUrl(url: string): void;
  /** Action items: "Done" removes them. */
  onDone(itemId: string): void;
  /** Comments: a reply, and resolve (hide the thread; it stays). */
  onReply(commentId: string, text: string): void;
  onResolve(commentId: string): void;
};

export const BoardCallbacksContext = createContext<BoardCallbacks | null>(null);

function useBoardCallbacks(): BoardCallbacks {
  const callbacks = useContext(BoardCallbacksContext);
  if (callbacks === null) throw new Error("Node components need BoardCallbacksContext.");
  return callbacks;
}

/**
 * A hidden handle. React Flow draws an edge only between handles. Our edges go from
 * center to center (see edges.tsx), so the handle has no size and no use for input.
 */
function HiddenHandle() {
  return <Handle type="source" position={Position.Right} className="hidden-handle" isConnectable={false} />;
}

function Resizer({ node, selected }: { node: BoardNode; selected: boolean }) {
  const callbacks = useBoardCallbacks();
  const collapsed = isCollapsed(node);
  // A collapsed card fits its name. It has no size to change.
  if (node.placeId === null || callbacks.readOnly || collapsed) return null;
  const placeId = node.placeId;
  return (
    <NodeResizer
      isVisible={selected}
      minWidth={node.kind === "stamp" ? 4 : 40}
      minHeight={node.kind === "stamp" ? 4 : 24}
      // A note is never larger than a sticky note.
      maxWidth={isNote(node) ? DEFAULT_SIZE.note.w : undefined}
      maxHeight={isNote(node) ? DEFAULT_SIZE.note.h : undefined}
      // A scribble keeps its shape: it can only grow or shrink as a whole.
      keepAspectRatio={node.kind === "stamp"}
      lineClassName="resize-line"
      handleClassName="resize-handle"
      onResizeEnd={(_, params) => {
        const w = roundBoard(params.width);
        // A scribble keeps its exact proportions: its height comes from its width.
        const h = node.kind === "stamp" && node.w > 0 ? cleanNumber((w * node.h) / node.w) : roundBoard(params.height);
        callbacks.onResizeEnd(placeId, { x: roundBoard(params.x), y: roundBoard(params.y), w, h });
      }}
    />
  );
}

/**
 * Name field in a card. Only Enter (save) or Escape (cancel) ends the edit.
 * A click elsewhere keeps the field open. If the card goes away (for example, the user
 * opens a different board), the draft is saved, so that no typed text is lost.
 */
/**
 * Puts the focus in a new text field. React Flow hides a card until it has measured it (a quote, a link object:
 * no fixed height), and a hidden field cannot take the focus. Then the edit never ended. Thus: try again on each frame.
 */
function useFocusWhenShown(field: { current: HTMLInputElement | HTMLTextAreaElement | null }, onFocus?: (element: HTMLInputElement | HTMLTextAreaElement) => void) {
  useEffect(() => {
    let frame = 0;
    let tries = 0;
    const attempt = () => {
      const element = field.current;
      if (element === null) return;
      element.focus();
      if (document.activeElement === element) onFocus?.(element);
      else if (++tries < 60) frame = requestAnimationFrame(attempt);
    };
    attempt();
    return () => cancelAnimationFrame(frame);
    // Only when the field opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function TitleInput({ node, value, placeholder, onCommit }: { node: BoardNode; value?: string; placeholder?: string; onCommit?: (text: string) => void }) {
  const callbacks = useBoardCallbacks();
  const initial = value ?? node.title;
  const commitText = onCommit ?? ((text: string) => callbacks.onRename(node.recordId, text));
  const [draft, setDraft] = useState(initial);
  const done = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  useFocusWhenShown(field);
  const latest = useRef({ draft, initial, commitText });
  latest.current = { draft, initial, commitText };

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit && draft.trim() !== initial) commitText(draft.trim());
    callbacks.onEndEdit();
  };

  // Save the draft when the field goes away without Enter or Escape.
  useEffect(
    () => () => {
      if (done.current) return;
      const { draft: text, initial: before, commitText: commitLast } = latest.current;
      if (text.trim() !== before) commitLast(text.trim());
    },
    [],
  );

  const onKeyDown = (event: KeyboardEvent) => {
    if (isComposing(event)) return;
    if (event.key === "Enter") finish(true);
    if (event.key === "Escape") finish(false);
  };
  return (
    <input
      ref={field}
      className="card-title-input nodrag nopan"
      dir="auto"
      value={draft}
      placeholder={placeholder ?? "Untitled"}
      spellCheck={onCommit === undefined}
      // All text is selected, so typing replaces the name (for a new card, its code).
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => {
        setDraft(event.target.value);
        callbacks.onTyping();
      }}
      // A double-click selects a word. It must not open the item.
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={onKeyDown}
    />
  );
}

/** Body text editor in a card. Each change goes to the store. Escape or blur closes it. */
function BodyInput({ node }: { node: BoardNode }) {
  const callbacks = useBoardCallbacks();
  const [draft, setDraft] = useState(() => callbacks.bodyOf(node.recordId));
  const area = useRef<HTMLTextAreaElement>(null);
  useFocusWhenShown(area, (element) => element.setSelectionRange(element.value.length, element.value.length));
  return (
    <textarea
      ref={area}
      className="card-body-input nodrag nopan nowheel"
      value={draft}
      placeholder="Type text…"
      onChange={(event) => {
        setDraft(event.target.value);
        callbacks.onBodyChange(node.recordId, event.target.value);
        callbacks.onTyping();
      }}
      onBlur={() => callbacks.onEndEdit()}
      dir="auto"
      onKeyDown={(event) => !isComposing(event) && event.key === "Escape" && event.currentTarget.blur()}
    />
  );
}

/** The type icon of a card. An item with its own board shows the board icon (an outline or calendar board: its group icon). */
function typeIcon(node: BoardNode): { icon: LucideIcon; label: string } {
  if (node.boardGroup === "outline") return { icon: BookOpen, label: "Outline board" };
  if (node.boardGroup === "calendar") return { icon: CalendarDays, label: "Calendar board" };
  if (hasBoard(node)) return { icon: LayoutGrid, label: "Item with a board" };
  return node.view === "page" ? { icon: FileText, label: "Page" } : { icon: StickyNote, label: "Note" };
}

export function CardNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { node, linkSource, editing, dropTarget } = data;
  const callbacks = useBoardCallbacks();
  const ghost = node.kind === "ghost" || node.isReference;
  // Plugin text (for example a translation) shows in place of the name and text. It is never saved.
  const overlay = useOverlay(node.recordId);
  const shownTitle = overlay?.title ?? node.title;
  const preview = overlay?.body != null ? previewOf(overlay.body) : node.preview;
  // A note with no name shows the first line of its text as its name when it is collapsed.
  const firstLine = preview.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
  const title = shownTitle !== "" ? shownTitle : isNote(node) ? firstLine || "Empty note" : "Untitled";
  const board = hasBoard(node);
  // An item with its own board always has the board look, whatever its view style.
  // Thus a board is never mistaken for a note, a page, or a text.
  const look = board ? "board" : node.view;
  const className = `card view-${look}${board ? " has-board" : ""}${node.boardGroup !== null ? ` group-board-${node.boardGroup}` : ""}${node.inCalendar ? " in-calendar" : ""}${node.calendarPopped ? " calendar-popped" : ""}${ghost ? " ghost" : ""}${node.isReference ? " reference" : ""}${node.color !== null && !ghost ? " custom-color" : ""}${selected ? " selected" : ""}${linkSource ? " link-source" : ""}${dropTarget === true ? " drop-target" : ""}`;
  const type = typeIcon(node);
  const canEdit = !ghost && !callbacks.readOnly;
  const marker = node.marker !== "" ? <span className="outline-marker">{node.marker}</span> : null;
  // A card color replaces the color of the card kind. The text color follows for contrast.
  const colorStyle = node.color !== null && !ghost ? { background: node.color, borderColor: node.color, color: textColorOn(node.color) } : undefined;

  if (!board && !ghost && node.kind === "item") {
    const common = { id, node, selected, editing, title: shownTitle, text: preview, className };
    if (node.view === "comment") return <CommentCard {...common} />;
    if (node.view === "weblink") return <WebLinkCard {...common} />;
    if (node.view === "todo") return <TodoCard {...common} />;
    if (node.view === "flashcard") return <FlashCard {...common} />;
    if (node.view === "quote") return <QuoteCard {...common} />;
    if (node.view === "group") return <GroupShapeCard {...common} />;
  }
  if (node.view === "text" && !board) {
    return (
      <div
        className={className}
        style={colorStyle}
        onDoubleClick={(event) => {
          // Plugin text cannot be edited. "Show original" (in the plugin menu) gives the text back.
          if (!canEdit || overlay !== undefined) return;
          event.stopPropagation();
          callbacks.onStartEdit(id, "body");
        }}
      >
        <Resizer node={node} selected={selected} />
        <HiddenHandle />
        {editing === "body" ? (
          <BodyInput node={node} />
        ) : (
          <div className="card-text" data-item-id={node.recordId} dir="auto">{marker}{preview !== "" ? preview : <span className="untitled">{ghost ? "Missing item" : "Empty text"}</span>}</div>
        )}
        <InnerStamps stamps={node.innerStamps} />
      </div>
    );
  }
  // An open note with no name shows only its text, like a sticky note. Its tools show on hover.
  if (isNote(node) && shownTitle === "" && editing !== "title" && !isCollapsed(node)) {
    return (
      <div className={`${className} untitled-note${editing === "body" ? " note-editing" : ""}`} style={colorStyle}>
        <Resizer node={node} selected={selected} />
        <HiddenHandle />
        {node.placeId !== null && !callbacks.readOnly && (
          <button
            className="card-icon card-hover-only nodrag note-collapse"
            data-tip="Show only the first line"
            onClick={(event) => {
              event.stopPropagation();
              callbacks.onToggleExpanded(node.placeId!, false);
            }}
          >
            <ChevronDown size={14} />
          </button>
        )}
        {canEdit && overlay === undefined && editing === null && (
          <button
            className="card-icon card-hover-only nodrag note-name"
            data-tip="Give it a name"
            onClick={(event) => {
              event.stopPropagation();
              callbacks.onStartEdit(id, "title");
            }}
          >
            <Pencil size={13} />
          </button>
        )}
        {editing === "body" ? (
          <BodyInput node={node} />
        ) : (
          <div className="card-text" data-item-id={node.recordId} dir="auto">{marker}{preview !== "" ? preview : <span className="untitled">Empty note</span>}</div>
        )}
        {overlay !== undefined && <span className="transformed-mark floating" data-tip="Plugin text. It is not saved." />}
        <InnerStamps stamps={node.innerStamps} />
      </div>
    );
  }
  const collapsed = isCollapsed(node);
  const placeId = node.placeId;
  return (
    <div className={`${className}${collapsed ? " collapsed" : ""}${editing === "body" ? (isNote(node) ? " note-editing" : collapsed ? " editing-folded" : "") : ""}`} style={colorStyle}>
      <Resizer node={node} selected={selected} />
      <HiddenHandle />
      {node.openComments > 0 && <span className="comment-dot" data-tip={node.openComments === 1 ? "1 open comment in the page" : `${node.openComments} open comments in the page`} />}
      <div className="card-title">
        {marker}
        {node.timeLabel !== "" && <span className="card-time-label">{node.timeLabel}</span>}
        {editing === "title" ? (
          <TitleInput node={node} />
        ) : (
          <span dir="auto" className={shownTitle === "" && (title === "Empty note" || title === "Untitled") ? "card-name untitled" : shownTitle === "" ? "card-name first-line" : node.codeName ? "card-name code-name" : "card-name"}>
            {title}
          </span>
        )}
        {overlay !== undefined && <span className="transformed-mark" data-tip="Plugin text. It is not saved." />}
        {node.childCount > 0 && <span className="child-count" data-tip="Items on its board">{node.childCount}</span>}
        {/* Hover tools at the right: the type, fold, and edit. The title does not move (in a calendar day they lie over the card). */}
        <span className="card-tools">
          <span className="card-type card-hover-only" data-tip={node.isReference ? "Reference: the item lives on a different board" : type.label}>
            <type.icon size={13} />
          </span>
          {placeId !== null && !callbacks.readOnly && (
            <button
              className="card-icon card-hover-only nodrag"
              data-tip={collapsed ? "Show text" : "Show only the name"}
              onClick={(event) => {
                event.stopPropagation();
                callbacks.onToggleExpanded(placeId, collapsed);
              }}
            >
              {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
          {!ghost && !isNote(node) && (
            <button
              className="card-icon card-hover-only nodrag"
              data-tip="Edit text"
              data-tip-end
              onClick={(event) => {
                event.stopPropagation();
                callbacks.onOpenText(node.recordId);
              }}
            >
              <PenLine size={13} />
            </button>
          )}
        </span>
      </div>
      {/* A folded card (for example in a full calendar day) shows its text while it is edited: it grows over its neighbors. */}
      {editing === "body" ? <BodyInput node={node} /> : !collapsed && <div className="card-preview" data-item-id={node.recordId} dir="auto">{preview}</div>}
      {!collapsed && <InnerStamps stamps={node.innerStamps} />}
    </div>
  );
}

type ObjectProps = { id: string; node: BoardNode; selected: boolean; editing: InlineEdit; title: string; text: string; className: string };

/** A short date and time for a comment. */
function shortTime(time: string): string {
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(uiLocale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** A comment: dark, with electric pink text and a signature. Double-click to write. Replies show under it. */
function CommentCard({ id, node, selected, editing, text, className }: ObjectProps) {
  const callbacks = useBoardCallbacks();
  const [replying, setReplying] = useState(false);
  return (
    <div className={className} onDoubleClick={(event) => (event.stopPropagation(), !callbacks.readOnly && callbacks.onStartEdit(id, "body"))}>
      <Resizer node={node} selected={selected} />
      <HiddenHandle />
      <div className="comment-head">
        <MessageSquare size={12} />
        <span className="comment-author">{node.author !== "" ? node.author : "Comment"}</span>
        <span className="comment-time">{shortTime(node.created)}</span>
        {!callbacks.readOnly && (
          <span className="comment-actions card-hover-only">
            <button className="card-icon nodrag" data-tip="Reply" onClick={(event) => (event.stopPropagation(), setReplying(true))}>
              <Reply size={12} />
            </button>
            <button className="card-icon nodrag" data-tip="Resolve: hide the thread (it stays)" data-tip-end onClick={(event) => (event.stopPropagation(), callbacks.onResolve(node.recordId))}>
              <CheckCheck size={12} />
            </button>
          </span>
        )}
      </div>
      <div className="comment-thread nowheel">
        {node.quote !== "" && <div className="comment-quote" dir="auto">“{node.quote}”</div>}
        {editing === "body" ? <BodyInput node={node} /> : <div className="card-text comment-text" data-item-id={node.recordId} dir="auto">{text !== "" ? text : <span className="untitled">Double-click to write a comment</span>}</div>}
        {node.replies.map((reply) => (
          <div key={reply.id} className="comment-reply" dir="auto">
            <span className="comment-author">{reply.author !== "" ? reply.author : "Reply"}</span> {reply.text}
          </div>
        ))}
        {replying && (
          <ReplyInput
            onDone={(value) => {
              setReplying(false);
              if (value.trim() !== "") callbacks.onReply(node.recordId, value.trim());
            }}
          />
        )}
      </div>
    </div>
  );
}

/** A reply field: Enter saves, Shift+Enter is a new line, Escape cancels. */
export function ReplyInput({ onDone }: { onDone(text: string): void }) {
  const [draft, setDraft] = useState("");
  return (
    <textarea
      className="comment-reply-input nodrag nopan nowheel"
      autoFocus
      rows={2}
      value={draft}
      placeholder="Reply… (Enter saves)"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onDone(draft)}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (isComposing(event)) return;
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          onDone(draft);
        }
        if (event.key === "Escape") onDone("");
      }}
    />
  );
}

/**
 * A link object: only its name (like a collapsed note). Double-click opens it: a web page, a local PDF (in the reader),
 * or another local file (in Finder). Its buttons (or the menu) edit the name and the address together.
 */
function WebLinkCard({ node, selected, editing, title, className }: ObjectProps) {
  const callbacks = useBoardCallbacks();
  const local = isLocalPath(node.url);
  // A saved page with notes: the card is solid blue, and a double-click opens the saved copy.
  const annotated = useAnnotated(useSession(), node.recordId, node.url);
  const Icon = local ? FileIcon : Globe;
  if (editing === "title" || editing === "url") {
    return (
      <div className={`${className} editing-link`}>
        <HiddenHandle />
        <LinkFields node={node} focus={editing} />
      </div>
    );
  }
  return (
    <div className={`${className}${annotated ? " weblink-annotated" : ""}${isFullLink(node) ? " link-full" : ""}`} data-tip={node.url !== "" ? (annotated ? `${node.url} · saved copy with your notes` : node.url) : undefined}>
      <Resizer node={node} selected={selected} />
      <HiddenHandle />
      <div className="card-title">
        <Icon size={13} className="weblink-icon" />
        <span className={title === "" && node.url === "" ? "card-name untitled" : "card-name"} dir="auto">{title !== "" ? title : node.url === "" ? "New link" : local ? fileNameOfPath(node.url) : linkLabel(node.url, !isFullLink(node))}</span>
        {!callbacks.readOnly && editing === null && (
          <>
            <button className="card-icon card-hover-only nodrag" data-tip="Edit the name" onClick={(event) => (event.stopPropagation(), callbacks.onStartEdit(node.id, "title"))}>
              <PenLine size={12} />
            </button>
            <button className="card-icon card-hover-only nodrag" data-tip="Edit the web address" data-tip-end onClick={(event) => (event.stopPropagation(), callbacks.onStartEdit(node.id, "url"))}>
              <Link2 size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The name and the address of a link object, in one form. Enter (in either field) saves both; Escape cancels.
 * If the form goes away without Enter or Escape, it saves (as the name field of other cards does).
 */
function LinkFields({ node, focus }: { node: BoardNode; focus: "title" | "url" }) {
  const callbacks = useBoardCallbacks();
  const [name, setName] = useState(node.title);
  const [url, setUrl] = useState(node.url);
  const done = useRef(false);
  const latest = useRef({ name, url });
  latest.current = { name, url };
  const save = () => {
    const { name: nextName, url: nextUrl } = latest.current;
    if (nextName.trim() !== node.title) callbacks.onRename(node.recordId, nextName.trim());
    if (nextUrl.trim() !== node.url) callbacks.onSetUrl(node.recordId, nextUrl.trim());
  };
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) save();
    callbacks.onEndEdit();
  };
  useEffect(
    () => () => {
      if (!done.current) save();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const onKeyDown = (event: KeyboardEvent) => {
    if (isComposing(event)) return;
    if (event.key === "Enter") finish(true);
    if (event.key === "Escape") finish(false);
  };
  return (
    <div className="link-fields nodrag nopan" onDoubleClick={(event) => event.stopPropagation()}>
      <label>
        <span>Name</span>
        <input className="card-title-input" autoFocus={focus === "title"} dir="auto" value={name} placeholder="Name (optional)" onChange={(event) => setName(event.target.value)} onKeyDown={onKeyDown} />
      </label>
      <label>
        <span>Link</span>
        <input className="card-title-input" autoFocus={focus === "url"} value={url} spellCheck={false} placeholder="https://…, or a file path: ~/Documents/file.pdf" onChange={(event) => setUrl(event.target.value)} onKeyDown={onKeyDown} />
      </label>
      <div className="link-fields-hint">Enter saves · Esc cancels · a PDF opens in the app, other files show in Finder</div>
    </div>
  );
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** An action item: half-transparent fluorescent film. "Done" removes it. Double-click to write. */
function TodoCard({ id, node, selected, editing, text, className }: ObjectProps) {
  const callbacks = useBoardCallbacks();
  const color = node.color ?? "#f4ff3a";
  // Folded: one line of text, no Done button. While it is edited, it opens.
  const folded = isCollapsed(node) && editing !== "body";
  return (
    <div
      className={`${className}${editing === "body" ? " todo-editing" : ""}${folded ? " todo-folded" : ""}`}
      style={{ background: `${color}8c`, borderColor: color }}
      onDoubleClick={(event) => (event.stopPropagation(), !callbacks.readOnly && callbacks.onStartEdit(id, "body"))}
    >
      <Resizer node={node} selected={selected} />
      <HiddenHandle />
      {!callbacks.readOnly && !folded && (
        <button className="todo-done card-hover-only nodrag" data-tip="Done: remove it (undo brings it back)" data-tip-end onClick={(event) => (event.stopPropagation(), callbacks.onDone(node.recordId))}>
          <Check size={13} />
        </button>
      )}
      {editing === "body" ? (
        <BodyInput node={node} />
      ) : (
        <div className="card-text todo-text" data-item-id={node.recordId} dir="auto">
          {text !== "" ? (folded ? text.split("\n").find((line) => line.trim() !== "")?.trim() ?? "" : text) : <span className="untitled">To do…</span>}
        </div>
      )}
    </div>
  );
}

/** A flashcard: the name is the front, the text is the back. Double-click flips it. The pencil (top right) edits the side that shows. */
function FlashCard({ node, editing, title, text, className }: ObjectProps) {
  const [flipped, setBack] = useState(false);
  // An edit shows its side: the front (name) or the back (text). Edit from the right-click menu.
  const back = editing === "body" || (editing !== "title" && flipped);
  return (
    <div className={`${className}${back ? " flipped" : ""}`} onDoubleClick={(event) => (event.stopPropagation(), editing === null && setBack((current) => !current))}>
      <HiddenHandle />
      <span className="flash-side-label">
        <Layers size={10} /> {back ? "Back" : "Front"}
      </span>
      <div className="flash-face" key={back ? "back" : "front"} dir="auto">
        {back ? (
          editing === "body" ? <BodyInput node={node} /> : text !== "" ? text : <span className="untitled">Back</span>
        ) : editing === "title" ? (
          <TitleInput node={node} placeholder="Front" />
        ) : title !== "" ? (
          title
        ) : (
          <span className="untitled">Front</span>
        )}
      </div>
    </div>
  );
}

/** The quotation marks of a quote card: opening and closing glyph, and a tip for the menu. */
export const QUOTE_GLYPHS: Record<QuoteMarks, { open: string; close: string; tip: string }> = {
  en: { open: "‘", close: "’", tip: "English" },
  cjk: { open: "「", close: "」", tip: "Traditional Chinese, Japanese" },
  zh: { open: "“", close: "”", tip: "Chinese" },
  es: { open: "«", close: "»", tip: "Spanish, French" },
  none: { open: "", close: "", tip: "No marks" },
};

/** The first words of a quote for its folded bubble: two words, or two characters of CJK text. */
export function quoteStart(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat === "") return "";
  if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(flat)) {
    const characters = [...flat];
    return characters.slice(0, 2).join("") + (characters.length > 2 ? "…" : "");
  }
  const words = flat.split(" ");
  return words.slice(0, 2).join(" ") + (words.length > 2 ? "…" : "");
}

/**
 * A quote: a passage on newsprint paper, framed by quotation marks. The name is its source (it can be empty).
 * Double-click writes the text (like a note; the board does it). The size can change; the height grows with the text.
 * Folded, it is a small gray speech bubble with the first two words. Double-click unfolds it, ready for typing.
 */
function QuoteCard({ id, node, selected, editing, title, text, className }: ObjectProps) {
  const callbacks = useBoardCallbacks();
  const glyph = QUOTE_GLYPHS[node.marks];
  const folded = isCollapsed(node) && editing === null;
  if (folded) {
    return (
      <div
        className={`${className} quote-bubble`}
        data-tip={text !== "" ? text.slice(0, 200) : undefined}
      >
        <HiddenHandle />
        <span className="card-text quote-bubble-text" data-item-id={node.recordId} dir="auto">
          {quoteStart(text) || <span className="untitled">Quote</span>}
        </span>
      </div>
    );
  }
  return (
    <div
      className={`${className} quote-marks-${node.marks}`}
      style={{ minHeight: node.h }}
    >
      <Resizer node={node} selected={selected} />
      <HiddenHandle />
      {node.marks !== "none" && (
        <span className="quote-mark open" aria-hidden>
          {glyph.open}
        </span>
      )}
      {!callbacks.readOnly && node.placeId !== null && editing === null && (
        <button className="card-icon card-hover-only quote-fold nodrag" data-tip="Fold into a bubble" data-tip-end onClick={(event) => (event.stopPropagation(), callbacks.onToggleExpanded(node.placeId!, false))}>
          <Minimize2 size={11} />
        </button>
      )}
      {editing === "body" ? (
        <BodyInput node={node} />
      ) : (
        <div className="card-text quote-text" data-item-id={node.recordId} dir="auto">
          {text !== "" ? text : <span className="untitled">Double-click to write a quote</span>}
        </div>
      )}
      {editing === "title" ? (
        <TitleInput node={node} placeholder="Source (optional)" />
      ) : (
        title !== "" && (
          <div className="quote-source" dir="auto">
            — {title}
          </div>
        )
      )}
      {node.marks !== "none" && (
        <span className="quote-mark close" aria-hidden>
          {glyph.close}
        </span>
      )}
    </div>
  );
}

/** Scribbles that a note holds. They move with the card and the card clips them. */
/**
 * A group card: a loose area of the board (rounded rectangle, ellipse, or free shape) with a name at its top left.
 * Only its edge and its name take the pointer: a click inside the shape goes to the board or to the cards in it.
 * Drag the name or the edge to move the group with its cards. Double-click the name to rename it.
 */
function GroupShapeCard({ id, node, selected, editing, title, className }: ObjectProps) {
  const callbacks = useBoardCallbacks();
  const color = node.color ?? "var(--group-shape)";
  const w = Math.max(node.w, 1);
  const h = Math.max(node.h, 1);
  // Outline: a dashed edge only. Filled: the color fills the area, and the edge is solid.
  const look = node.filled
    ? { fill: color, fillOpacity: 0.18, stroke: color, strokeOpacity: 0.8, strokeWidth: 1.5 }
    : { fill: "none", stroke: color, strokeOpacity: 0.85, strokeWidth: 1.75, strokeDasharray: "7 5" };
  // The visible edge, and a wide clear edge on it that takes the pointer (to move the group).
  const hit = { fill: "none", stroke: "transparent", strokeWidth: 12, className: "group-shape-hit" };
  const outline = (props: SVGProps<SVGElement>) =>
    node.shape === "blob" && node.shapePath !== "" ? (
      <path d={node.shapePath} vectorEffect="non-scaling-stroke" {...(props as SVGProps<SVGPathElement>)} />
    ) : node.shape === "ellipse" ? (
      <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 1} ry={h / 2 - 1} vectorEffect="non-scaling-stroke" {...(props as SVGProps<SVGEllipseElement>)} />
    ) : (
      <rect x={1} y={1} width={w - 2} height={h - 2} rx={18} vectorEffect="non-scaling-stroke" {...(props as SVGProps<SVGRectElement>)} />
    );
  return (
    <div className={`${className} group-shape shape-${node.shape}`}>
      <Resizer node={node} selected={selected} />
      <svg className="group-shape-svg" viewBox={`0 0 ${node.shape === "blob" ? 100 : w} ${node.shape === "blob" ? 100 : h}`} preserveAspectRatio="none" aria-hidden>
        {outline({ ...look, className: "group-shape-edge" })}
        {outline(hit)}
      </svg>
      <HiddenHandle />
      <div
        className="group-shape-name"
        style={node.color === null ? undefined : { color: node.color }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (!callbacks.readOnly) callbacks.onStartEdit(id, "title");
        }}
      >
        {editing === "title" ? <TitleInput node={node} placeholder="Group" /> : title !== "" ? <span dir="auto">{title}</span> : <span className="untitled">Group</span>}
      </div>
    </div>
  );
}

function InnerStamps({ stamps }: { stamps: readonly InnerStamp[] }) {
  if (stamps.length === 0) return null;
  return (
    <div className="inner-stamps" aria-hidden>
      {stamps.map((stamp) => (
        <svg
          key={stamp.placeId}
          className="stamp inner"
          style={{ left: stamp.x, top: stamp.y, width: stamp.w, height: stamp.h }}
          viewBox={`0 0 ${Math.max(stamp.w, 0.1)} ${Math.max(stamp.h, 0.1)}`}
          preserveAspectRatio="none"
        >
          <path d={stamp.path} vectorEffect="non-scaling-stroke" style={stamp.color === null ? undefined : { stroke: stamp.color }} />
        </svg>
      ))}
    </div>
  );
}

const LIST_BUTTONS: { value: ListStyle | null; icon: LucideIcon; tip: string }[] = [
  { value: null, icon: Minus, tip: "No marks" },
  { value: "bullets", icon: List, tip: "Bullets" },
  { value: "numbers", icon: ListOrdered, tip: "Numbers" },
];

/**
 * The frame of an outline. Drag the frame to move the outline with all its cards.
 * Its bar has the list style and "read as one document". Right-click the frame for more.
 */
export function OutlineNode({ data, selected }: NodeProps<FlowNode>) {
  const { node } = data;
  const callbacks = useBoardCallbacks();
  const outlineId = node.outlineId;
  return (
    <div className={`outline-frame${selected ? " selected" : ""}${data.dropTarget === true ? " drop-target" : ""}${data.editing === "shape" ? " shape-edit" : ""}`}>
      {data.editing === "shape" && outlineId !== null && <OutlineWidthEdit outlineId={outlineId} width={node.w} />}
      <div className="outline-bar">
        <GripHorizontal size={14} className="outline-grip" />
        <BookOpen size={13} className="group-icon outline" />
        <GroupName data={data} />
        {outlineId !== null && !callbacks.readOnly && (
          <span className="outline-tools nodrag">
            {LIST_BUTTONS.map(({ value, icon: Icon, tip }) => (
              <button
                key={value ?? "none"}
                className={`icon-button small${node.list === value ? " active" : ""}`}
                data-tip={tip}
                onClick={(event) => {
                  event.stopPropagation();
                  callbacks.onOutlineList(outlineId, value);
                }}
              >
                <Icon size={12} />
              </button>
            ))}
            <button
              className="icon-button small"
              data-tip="Read as one document"
              onClick={(event) => {
                event.stopPropagation();
                callbacks.onOutlineDocument(outlineId);
              }}
            >
              <ScrollText size={12} />
            </button>

          </span>
        )}
      </div>
    </div>
  );
}

/** Resize handles at the left and right of an outline frame. Esc or "Done" ends the edit. */
function OutlineWidthEdit({ outlineId, width }: { outlineId: string; width: number }) {
  const callbacks = useBoardCallbacks();
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || isComposing(event)) return;
      event.preventDefault();
      callbacks.onEndEdit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [callbacks]);
  return (
    <>
      <NodeResizer
        isVisible
        minWidth={120}
        lineClassName="resize-line"
        handleClassName="resize-handle"
        // Only the width changes: the rows give the height.
        shouldResize={(_, params) => params.direction[0] !== 0}
        onResizeEnd={(_, params) => callbacks.onOutlineWidth(outlineId, width, roundBoard(params.width))}
      />
      <button className="shape-done nodrag nopan" onClick={(event) => (event.stopPropagation(), callbacks.onEndEdit())}>
        Done
      </button>
    </>
  );
}

export function StampNode({ data, selected }: NodeProps<FlowNode>) {
  const { node } = data;
  const stamp = node.stamp;
  if (stamp === undefined) return null;
  return (
    <div className={`stamp${selected ? " selected" : ""}`}>
      <Resizer node={node} selected={selected} />
      {/* The view box equals the stamp box. Thus each point shows exactly where it was drawn. */}
      <svg viewBox={`0 0 ${stamp.w} ${stamp.h}`} preserveAspectRatio="none" role="img" aria-label={stamp.alt}>
        <path d={stamp.path} vectorEffect="non-scaling-stroke" style={node.color === null ? undefined : { stroke: node.color }} />
      </svg>
    </div>
  );
}

export function StubNode({ data }: NodeProps<FlowNode>) {
  const { node, linkMode } = data;
  const callbacks = useBoardCallbacks();
  return (
    // With the link tool, a click on a stub picks it as a link end (the board handles it). Else it opens the record.
    <button
      className="stub nopan nodrag"
      data-tip={linkMode ? `Link to ${node.title}` : `Open ${node.title}`}
      onClick={() => !linkMode && callbacks.onOpenRecord(node.recordId)}
    >
      <HiddenHandle />
      → {node.title}
    </button>
  );
}

/** The name of a group in its bar. Double-click or the menu edits it. */
function GroupName({ data }: { data: BoardNodeData }) {
  const callbacks = useBoardCallbacks();
  const { node } = data;
  if (data.editing === "title" && node.outlineId !== null) {
    const groupId = node.outlineId;
    return <TitleInput node={node} value={node.groupName} placeholder={node.kind === "calendar" ? "Calendar title" : "Outline title"} onCommit={(name) => callbacks.onRenameGroup(groupId, name)} />;
  }
  return (
    <span
      className={`group-name${node.groupName === "" ? " untitled" : ""}`}
      dir="auto"
      data-tip="Double-click to rename"
      onDoubleClick={(event) => {
        if (callbacks.readOnly) return;
        event.stopPropagation();
        callbacks.onStartEdit(node.id, "title");
      }}
    >
      {node.groupName !== "" ? node.groupName : node.kind === "calendar" ? "Calendar" : "Outline"}
    </span>
  );
}

/**
 * A calendar group: a month grid, Sunday first. The arrows show the month before or after (in its range).
 * Cards of the shown month sit in their days. Drag a card onto a day to put it there.
 */
export function CalendarNode({ data, selected }: NodeProps<FlowNode>) {
  const { node } = data;
  const callbacks = useBoardCallbacks();
  const days = gridDays(node.month);
  const index = node.months.indexOf(node.month);
  const today = new Date().toISOString().slice(0, 10);
  const go = (step: number) => (event: React.MouseEvent) => {
    event.stopPropagation();
    const month = node.months[index + step];
    if (month !== undefined && node.outlineId !== null) callbacks.onCalendarMonth(node.outlineId, month);
  };
  return (
    <div className={`calendar-frame${selected ? " selected" : ""}${data.dropTarget === true ? " drop-target" : ""}`} style={{ padding: `0 ${CALENDAR.pad}px` }}>
      <div className="calendar-bar" style={{ height: CALENDAR.bar }}>
        <GripHorizontal size={14} className="outline-grip" />
        <CalendarDays size={14} className="group-icon calendar" />
        <GroupName data={data} />
        <span className="spacer" />
        <button className="icon-button small nodrag" data-tip="Month before" disabled={index <= 0} onClick={go(-1)}>
          <ChevronLeft size={14} />
        </button>
        {data.editing === "month" && node.outlineId !== null ? (
          <input
            className="calendar-month-input nodrag nopan"
            type="month"
            autoFocus
            defaultValue={node.month}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                callbacks.onCalendarJump(node.outlineId!, event.currentTarget.value);
                callbacks.onEndEdit();
              }
              if (event.key === "Escape") callbacks.onEndEdit();
            }}
            onBlur={(event) => {
              if (event.currentTarget.value !== "") callbacks.onCalendarJump(node.outlineId!, event.currentTarget.value);
              callbacks.onEndEdit();
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          />
        ) : (
          <span className="calendar-month" data-tip="Double-click the calendar: go to any month">{monthTitle(node.month)}</span>
        )}
        <button className="icon-button small nodrag" data-tip="Month after" disabled={index === -1 || index >= node.months.length - 1} onClick={go(1)}>
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="calendar-weekdays" style={{ height: CALENDAR.weekdays, gridTemplateColumns: `repeat(7, ${CALENDAR.cellW}px)` }}>
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="calendar-grid" style={{ gridTemplateColumns: `repeat(7, ${CALENDAR.cellW}px)`, gridAutoRows: `${CALENDAR.cellH}px` }}>
        {Array.from({ length: 42 }, (_, slot) => {
          const day = days[slot]!;
          // A day of the month before or after: dimmed, but its cards show (as in Google Calendar).
          const outside = !day.startsWith(node.month);
          const number = Number(day.slice(8));
          return (
            <div key={slot} className={`calendar-cell${outside ? " outside" : ""}${day === today ? " today" : ""}${slot % 7 === 0 || slot % 7 === 6 ? " weekend" : ""}`}>
              <span className="calendar-day">{number === 1 ? `${monthTitle(day.slice(0, 7)).split(" ")[0]!.slice(0, 3)} 1` : number}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const NODE_TYPES = { card: CardNode, stamp: StampNode, stub: StubNode, outline: OutlineNode, calendar: CalendarNode };
