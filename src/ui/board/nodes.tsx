// Node components for the board. Data comes from BoardNode (boardModel.ts).

import { Handle, NodeResizer, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  FileText,
  LayoutGrid,
  List,
  ListOrdered,
  Minus,
  PenLine,
  Pencil,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { CalendarNode } from "./calendarNode";
import { RadialNode } from "./radialNode";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { cleanNumber, roundBoard } from "../../core/stamps";
import { DEFAULT_SIZE } from "../../core/actions";
import { isComposing } from "../app/keys";
import { useOverlay } from "../plugins/pluginsContext";
import type { CalendarView, ListStyle, MediaInfo } from "../../core/types";
import { MediaCard } from "./mediaCard";
import { textColorOn } from "../app/vaultImages";
import { COLLAPSED_HEIGHT, previewOf, type BoardNode, type InnerStamp } from "./boardModel";
import { useFieldForm } from "./fieldForm";
import { CommentCard, WebLinkCard, hostOf, TodoCard, FlashCard, QuoteCard, GroupShapeCard } from "./objectCards";
import { OutlineNode } from "./outlineNode";

export { COLLAPSED_HEIGHT };

/** True if the item has its own board. Such a card always has the board look. */
export function hasBoard(node: BoardNode): boolean {
  return node.isBoard;
}

/** True if the card shows only its name. Text cards without a board always show their text. */
export function isCollapsed(node: BoardNode): boolean {
  if (node.kind === "stamp" || node.kind === "stub" || node.kind === "outline" || node.kind === "calendar" || node.kind === "radial") return false;
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
export function linkLabel(url: string, short: boolean): string {
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
export type InlineEdit = "title" | "subtitle" | "body" | "url" | "month" | null;

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
  /** Sets the subtitle of a page (empty: none). */
  onSetSubtitle(itemId: string, subtitle: string): void;
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
  /** Calendar: show the period (week, month, year) of a day of its range. */
  onCalendarDay(calendarId: string, day: string): void;
  /** Calendar: show any day ("YYYY-MM-DD"). A month outside the range makes the range larger. */
  onCalendarJump(calendarId: string, day: string): void;
  /** Calendar: change its view (saved), and show a day in it (or keep the shown day). */
  onCalendarView(calendarId: string, view: CalendarView, day?: string): void;
  onSetUrl(itemId: string, url: string): void;
  /** Multimedia items (SPEC 7.14): change the media (null: a note again), open the link, choose a cover. */
  onSetMedia(itemId: string, media: MediaInfo | null): void;
  onOpenUrl(url: string): void;
  onChooseCover(itemId: string): void;
  /** "Get title and cover" with a "media-info" plugin. Null: no such plugin. */
  onFetchMedia: ((itemId: string) => void) | null;
  /** Action items: "Done" removes them. */
  onDone(itemId: string): void;
  /** Comments: a reply, and resolve (hide the thread; it stays). */
  onReply(commentId: string, text: string): void;
  onResolve(commentId: string): void;
};

export const BoardCallbacksContext = createContext<BoardCallbacks | null>(null);

export function useBoardCallbacks(): BoardCallbacks {
  const callbacks = useContext(BoardCallbacksContext);
  if (callbacks === null) throw new Error("Node components need BoardCallbacksContext.");
  return callbacks;
}

/**
 * A hidden handle. React Flow draws an edge only between handles. Our edges go from
 * center to center (see edges.tsx), so the handle has no size and no use for input.
 */
export function HiddenHandle() {
  return <Handle type="source" position={Position.Right} className="hidden-handle" isConnectable={false} />;
}

export function Resizer({ node, selected }: { node: BoardNode; selected: boolean }) {
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

/** `onEnter`: Enter saves and then calls it (in place of the end of the edit), for example to edit the next field. */
export function TitleInput({ node, value, placeholder, className, onCommit, onEnter }: { node: BoardNode; value?: string; placeholder?: string; className?: string; onCommit?: (text: string) => void; onEnter?: () => void }) {
  const callbacks = useBoardCallbacks();
  const initial = value ?? node.title;
  const commitText = onCommit ?? ((text: string) => callbacks.onRename(node.recordId, text));
  const [draft, setDraft] = useState(initial);
  const field = useRef<HTMLInputElement>(null);
  useFocusWhenShown(field);
  const end = useRef(callbacks.onEndEdit);
  const form = useFieldForm(() => draft.trim() !== initial && commitText(draft.trim()), () => end.current());
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && onEnter !== undefined && !isComposing(event)) end.current = onEnter;
    form.onKeyDown(event);
  };
  return (
    <input
      ref={field}
      className={`card-title-input nodrag nopan${className === undefined ? "" : ` ${className}`}`}
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
export function BodyInput({ node }: { node: BoardNode }) {
  const callbacks = useBoardCallbacks();
  const [draft, setDraft] = useState(() => callbacks.bodyOf(node.recordId));
  const area = useRef<HTMLTextAreaElement>(null);
  useFocusWhenShown(area, (element) => element.setSelectionRange(element.value.length, element.value.length));
  // A note grows with its text while it is edited, as it shows all its text.
  const grows = isNote(node) && !node.inCalendar;
  useLayoutEffect(() => {
    const element = area.current;
    if (!grows || element === null) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [grows, draft]);
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
  // A reference is a ghost card, but on a sorting map it shows as the real card (with a dashed edge).
  const ghost = node.kind === "ghost" || (node.isReference && !node.sorted);
  // Plugin text (for example a translation) shows in place of the name and text. It is never saved.
  const overlay = useOverlay(node.recordId);
  const shownTitle = overlay?.title ?? node.title;
  const preview = overlay?.body != null ? previewOf(overlay.body, isNote(node) ? Infinity : undefined) : node.preview;
  // A note with no name shows the first line of its text as its name when it is collapsed.
  const firstLine = preview.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
  const title = shownTitle !== "" ? shownTitle : isNote(node) ? firstLine || "Empty note" : "Untitled";
  const board = hasBoard(node);
  // An item with its own board always has the board look, whatever its view style.
  // Thus a board is never mistaken for a note, a page, or a text.
  const look = board ? "board" : node.view;
  const className = `card view-${look}${board ? " has-board" : ""}${node.boardGroup !== null ? ` group-board-${node.boardGroup}` : ""}${node.inCalendar ? " in-calendar" : ""}${node.calendarPopped ? " calendar-popped" : ""}${ghost ? " ghost" : ""}${node.isReference ? (node.sorted ? " sorted-ref" : " reference") : ""}${node.color !== null && !ghost ? " custom-color" : ""}${selected ? " selected" : ""}${linkSource ? " link-source" : ""}${dropTarget === true ? " drop-target" : ""}`;
  const type = typeIcon(node);
  const canEdit = !ghost && !callbacks.readOnly;
  const marker = node.marker !== "" ? <span className="outline-marker">{node.marker}</span> : null;
  // A card color replaces the color of the card kind. The text color follows for contrast.
  const colorStyle = node.color !== null && !ghost ? { background: node.color, borderColor: node.color, color: textColorOn(node.color) } : undefined;

  if (!board && !ghost && node.kind === "item") {
    const common = { id, node, selected, editing, title: shownTitle, text: preview, className, style: colorStyle };
    if (node.media !== null) return <MediaCard {...common} />;
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
    <div className={`${className}${collapsed ? " collapsed" : ""}${(node.subtitle !== "" && !node.inCalendar) || editing === "subtitle" ? " has-subtitle" : ""}${editing === "body" ? (isNote(node) ? " note-editing" : collapsed ? " editing-folded" : "") : ""}`} style={colorStyle}>
      <Resizer node={node} selected={selected} />
      <HiddenHandle />
      {node.openComments > 0 && <span className="comment-dot" data-tip={node.openComments === 1 ? "1 open comment in the page" : `${node.openComments} open comments in the page`} />}
      <div className="card-title">
        {marker}
        {node.timeLabel !== "" && <span className="card-time-label">{node.timeLabel}</span>}
        {editing === "title" ? (
          // A page: Enter goes on to its subtitle.
          <TitleInput node={node} onEnter={node.view === "page" && !board ? () => callbacks.onStartEdit(id, "subtitle") : undefined} />
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
      {/* A page: its subtitle under the name (also when folded). Enter or a click outside ends the edit. */}
      {editing === "subtitle" ? (
        <div className="card-subtitle">
          <TitleInput node={node} value={node.subtitle} placeholder="Subtitle…" className="card-subtitle-input" onCommit={(text) => callbacks.onSetSubtitle(node.recordId, text)} />
        </div>
      ) : (
        node.subtitle !== "" && !node.inCalendar && <div className="card-subtitle" dir="auto">{node.subtitle}</div>
      )}
      {/* A folded card (for example in a full calendar day) shows its text while it is edited: it grows over its neighbors. */}
      {editing === "body" ? <BodyInput node={node} /> : !collapsed && <div className="card-preview" data-item-id={node.recordId} dir="auto">{preview}</div>}
      {!collapsed && <InnerStamps stamps={node.innerStamps} />}
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

export const LIST_BUTTONS: { value: ListStyle | null; icon: LucideIcon; tip: string }[] = [
  { value: null, icon: Minus, tip: "No marks" },
  { value: "bullets", icon: List, tip: "Bullets" },
  { value: "numbers", icon: ListOrdered, tip: "Numbers" },
];

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
  // A drag moves the stub (its line gets shorter or longer). Only a click without a move opens the record.
  const down = useRef<{ x: number; y: number } | null>(null);
  return (
    // With the link tool, a click on a stub picks it as a link end (the board handles it). Else it opens the record.
    <button
      className="stub nopan"
      data-tip={linkMode ? `Link to ${node.title}` : `Open ${node.title} · drag to move`}
      onPointerDown={(event) => (down.current = { x: event.clientX, y: event.clientY })}
      onClick={(event) => {
        const start = down.current;
        const moved = start !== null && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4;
        if (!linkMode && !moved) callbacks.onOpenRecord(node.recordId);
      }}
    >
      <HiddenHandle />
      → {node.title}
    </button>
  );
}

/** The name of a group in its bar. Double-click or the menu edits it. */
export function GroupName({ data }: { data: BoardNodeData }) {
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

export const NODE_TYPES = { card: CardNode, stamp: StampNode, stub: StubNode, outline: OutlineNode, calendar: CalendarNode, radial: RadialNode };
