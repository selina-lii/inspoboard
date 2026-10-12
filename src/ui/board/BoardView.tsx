// Board view: the React Flow adapter. See docs/SPEC.md section 7.1.
// React Flow only draws. The store is the single source: each finished
// gesture (drag, resize, connect, delete, rename) becomes one command.

import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type NodeChange,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import {
  AudioLines,
  CalendarDays,
  CalendarRange,
  Check,
  FileDown,
  Globe,
  MessageSquarePlus,
  Pencil,
  Unlink,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Columns3,
  Download,
  FolderDown,
  FolderUp,
  FolderInput,
  Home,
  ImageMinus,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  ListTree,
  LogOut,
  ArrowRight,
  ArrowLeft,
  Link2,
  Maximize2,
  Minimize2,
  PenLine,
  MoveHorizontal,
  Rows3,
  ScrollText,
  StickyNote,
  Ungroup,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type MutableRefObject } from "react";
import {
  attachItem,
  completeItems,
  createReply,
  setResolved,
  setCardColor,
  setItemUrl,
  TODO_COLORS,
  NOTE_GRAY,
  createItemOnBoard,
  createOutlineWithPage,
  createRelation,
  createStampOnBoard,
  deleteLinks,
  eraseStrokes,
  joinStamps,
  moveIntoBoard,
  moveIntoNote,
  releaseFromNote,
  removeFromBoard,
  renameItem,
  setPlacementExpanded,
  setGroupFilled,
  setQuoteMarks,
  setPlacementRects,
  readStrokesOfPlacement,
  strokeOnBoard,
  writeText,
  type Rect,
  DEFAULT_SIZE,
} from "../../core/actions";
import type { Command } from "../../core/commands";
import {
  createOutline,
  indentRow,
  moveOutline,
  moveRow,
  moveRowTo,
  moveRowToEnd,
  outdentRow,
  removeFromOutline,
  setOutlineDirection,
  setOutlineList,
  setOutlineWidth,
} from "../../core/outline";
import { linksOf } from "../app/textLinks";
import { QUOTE_MARKS, SMALL_KINDS, type Id, type PlaceLink, type QuoteMarks, type ViewStyle } from "../../core/types";
import { ScheduleDialog } from "../dialogs/ScheduleFields";
import { addMonths, createCalendar, addDays, createOnDay, dayAt, setCardSchedule, deleteCalendar, groupDocument, groupTitle, isCalendar, monthOf, renameGroup, reorderInDay, setCalendarRange, snapToDay } from "../../core/groups";
import { fileNameOf } from "../plugins/exportOverlay";
import { isLocalPath, isPdfPath, withScheme } from "../web/savedPages";
import { groupColor } from "../app/colors";
import { applyBackground, chooseBackgroundImage } from "../app/ColorManager";
import { ContextMenu, type MenuEntry, type MenuRequest } from "../app/ContextMenu";
import { useBoardBackground } from "../app/vaultImages";
import { isTextTarget } from "../app/dom";
import { isComposing, shortcutKey } from "../app/keys";
import { usePinchZoom, type PinchHandler } from "../app/gestures";
import { useRunCommand, useSession, useSessionState, useStoreRevision } from "../app/sessionContext";
import { useWorkspaceActions } from "../app/workspaceActions";
import { DrawOverlay } from "../tools/DrawOverlay";
import { toolById, type ToolId } from "../tools/registry";
import { pointInPolygon, strokeHit, strokeToStamp, type Point } from "../tools/stroke";
import { buildBoardModel, cardHeight, OUTLINE_BAR, OUTLINE_PADDING, titleOf, type BoardEdge, type BoardModel, type BoardNode } from "./boardModel";
import { EDGE_TYPES } from "./edges";
import { BoardCallbacksContext, COLLAPSED_HEIGHT, hasBoard, isCollapsed, isFullLink, isNote, isQuote, QUOTE_GLYPHS, NODE_TYPES, type BoardCallbacks, type FlowNode, type InlineEdit } from "./nodes";
import { cleanNumber, roundBoard } from "../../core/stamps";
import { savedViewport, saveViewport } from "./viewports";
import { t } from "../i18n/i18n";
import { SCRIBBLE_COLORS } from "./PenColors";
import { blobFromPoints, boxFromDrag, createGroupShape, membersOf } from "../../core/groupShapes";
import { benchSlotAt, hoverBench, registerBenchSource, sendToBench } from "../app/LinkBench";
import { pagePointAt, registerBoardDrop } from "../app/boardDrop";
import { isPageHome, moveIn } from "../../core/inside";
import { copyCards, pasteCards, type CopiedCard } from "../../core/clipboard";
import { copyWebFiles } from "../web/webHomes";
import "./board.css";

export type BoardSelection = { recordIds: Id[]; placeIds: Id[]; linkIds: Id[]; outlineIds: Id[] };

/** Functions that the workspace can call on the board. */
export type BoardApi = {
  /** The board point at the center of the visible area. */
  viewCenter(): { x: number; y: number };
};

type Props = {
  boardId: Id;
  apiRef?: MutableRefObject<BoardApi | null>;
  tool: ToolId;
  onToolChange(tool: ToolId): void;
  onOpenRecord(recordId: Id): void;
  onSelectionChange(selection: BoardSelection): void;
  /** A card to select and center (a jump to an item on this board). */
  focus?: { recordId: Id; nonce: number } | null;
  /** "Pick an item" mode: a click on a card gives its record. */
  onPick?: (recordId: Id) => void;
  /** Shows an outline as one continuous document. */
  onOpenDocument?: (outlineId: Id) => void;
  /** A double-click made the tool stay on: it does not go back to the select tool after one use. */
  sticky?: boolean;
};

/** The eraser touches strokes within this distance, in screen pixels. */
const ERASER_RADIUS_PX = 6;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;



export function BoardView(props: Props) {
  return (
    <ReactFlowProvider key={props.boardId}>
      <Board {...props} />
    </ReactFlowProvider>
  );
}

/** The shown month of each calendar, for the app session (view state, not saved). */
const shownMonths = new Map<Id, string>();
/** Calendar cards in a full day that the user opened. View state for the app session (not saved). */
const poppedCards = new Set<Id>();

function Board({ boardId, apiRef, tool: toolId, onToolChange, onOpenRecord, onSelectionChange, focus, onPick, onOpenDocument, sticky = false }: Props) {
  const session = useSession();
  const revision = useStoreRevision();
  const { readOnly, settings } = useSessionState();
  const runCommand = useRunCommand();
  const actions = useWorkspaceActions();
  const flow = useReactFlow<FlowNode, Edge>();
  // The board background: its own, or the default of the vault.
  const ownBackground = session.store.get("items", boardId)?.background ?? null;
  const background = useBoardBackground(session, ownBackground ?? settings.defaultBackground);
  // A background image stays still: it fills the view behind the cards. (Records can have "backgroundFixed",
  // "backgroundWidth", and "backgroundCenter" from an older mode in which the image moved with the cards. The app
  // keeps these fields but does not use them.)
  const backgroundStyle =
    background?.kind === "color"
      ? { background: background.color }
      : background?.kind === "image"
        ? { backgroundImage: `url("${background.url}")`, backgroundSize: "cover", backgroundPosition: "center" }
        : null;
  const wrapper = useRef<HTMLDivElement>(null);
  const tool = toolById(toolId);
  const linkMode = tool.connects === true && !readOnly;

  /** The month that each calendar shows. View state: not saved. */
  // The month that each calendar shows. It stays for the app session: back from an item, the calendar shows the same month.
  const [months, setMonthState] = useState<ReadonlyMap<Id, string>>(() => new Map(shownMonths));
  const setMonths = useCallback((update: (current: ReadonlyMap<Id, string>) => ReadonlyMap<Id, string>) => {
    setMonthState((current) => {
      const next = update(current);
      for (const [calendarId, month] of next) shownMonths.set(calendarId, month);
      return next;
    });
  }, []);
  const [popped, setPopped] = useState<ReadonlySet<Id>>(() => new Set(poppedCards));
  const model = useMemo(
    () => buildBoardModel(session.store, session.graph, boardId, { months, popped }),
    // The revision changes after each store write. It is a dependency on purpose.
    [session, boardId, revision, months, popped],
  );
  const modelRef = useRef(model);
  modelRef.current = model;
  /** After a one-time tool, the select tool comes back (not after a double-click on the tool button). */
  const afterUse = useCallback(() => {
    if (tool.oneShot === true && !sticky) onToolChange("select");
  }, [tool, sticky, onToolChange]);

  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [editing, setEditing] = useState<{ nodeId: string; edit: InlineEdit } | null>(null);
  /** A calendar card whose "Days and time" dialog is open (its place ID). */
  const [scheduleFor, setScheduleFor] = useState<Id | null>(null);
  const pendingSelection = useRef<Set<string> | null>(null);
  /** Drag: the board card under the pointer. A drop there moves the dragged records into that board. */
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  /** Link tool: the node that is the first end of the next link. */
  const [linkSourceId, setLinkSourceId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  /** Changes when cards must go back to their saved place (a drop that changed nothing). */
  const [layoutRefresh, setLayoutRefresh] = useState(0);
  const heightOf = useCallback((place: Parameters<typeof cardHeight>[2]) => cardHeight(session.store, session.graph, place), [session]);
  /** Scribble tool: the placement that gets the next stroke. A new tool or Esc starts a new scribble. */
  const scribbleTarget = useRef<Id | null>(null);
  useEffect(() => {
    scribbleTarget.current = null;
  }, [toolId, boardId]);

  // Rebuild the React Flow nodes from the model. Keep the current selection.
  useEffect(() => {
    setNodes((previous) => {
      const selected = pendingSelection.current ?? new Set(previous.filter((node) => node.selected).map((node) => node.id));
      pendingSelection.current = null;
      return toFlowNodes(model, selected, { linkMode, linkSourceId }, readOnly, editing, dropTargetId);
    });
    setEdges((previous) => {
      const selected = new Set(previous.filter((edge) => edge.selected).map((edge) => edge.id));
      return toFlowEdges(model, selected);
    });
  }, [model, linkMode, linkSourceId, readOnly, editing, dropTargetId, layoutRefresh]);

  const stickyRef = useRef(sticky);
  stickyRef.current = sticky;
  const onToolChangeRef = useRef(onToolChange);
  onToolChangeRef.current = onToolChange;
  const callbacks = useMemo<BoardCallbacks>(
    () => ({
      readOnly,
      onOpenRecord,
      onResizeEnd: (placeId, rect) => runCommand(setPlacementRects(session.context, new Map([[placeId, rect]]))),
      onStartEdit: (nodeId, edit) => setEditing({ nodeId, edit }),
      onEndEdit: () => setEditing(null),
      onRename: (itemId, name) => {
        if (!session.store.has("items", itemId)) return;
        // A note can have no name. Other items get a code for an empty name.
        const note = model.nodes.some((node) => node.recordId === itemId && isNote(node));
        runCommand(renameItem(session.context, itemId, name, { allowEmpty: note }));
      },
      onBodyChange: (itemId, body) => {
        if (!readOnly && session.store.has("items", itemId)) writeText(session.store, itemId, body);
      },
      bodyOf: (itemId) => session.store.get("texts", itemId)?.body ?? "",
      // Typing in a new card ends a tool that stays on: the next click finishes the card, it makes no new card.
      onTyping: () => {
        if (stickyRef.current) onToolChangeRef.current("select");
      },
      onToggleExpanded: (placeId, expanded) => {
        const node = modelRef.current.nodes.find((entry) => entry.placeId === placeId);
        // A calendar card: in a full day, it opens over its neighbors (view state). Its saved fold state does not change then.
        if (node?.inCalendar === true) {
          const pop = (on: boolean) => {
            if (on) poppedCards.add(placeId);
            else poppedCards.delete(placeId);
            setPopped(new Set(poppedCards));
          };
          if (!expanded && node.calendarPopped) return pop(false);
          if (expanded) {
            pop(true);
            if (session.store.get("links", placeId)?.kind === "place" && (session.store.get("links", placeId) as PlaceLink).expanded !== true) runCommand(setPlacementExpanded(session.context, placeId, true));
            return;
          }
          pop(false);
        }
        runCommand(setPlacementExpanded(session.context, placeId, expanded));
      },
      onOpenText: (itemId) => actions.openText(itemId),
      onOutlineList: (outlineId, list) => runCommand(setOutlineList(session.context, outlineId, list)),
      onOutlineWidth: (outlineId, before, after) => runCommand(setOutlineWidth(session.context, outlineId, before - 2 * OUTLINE_PADDING, after - 2 * OUTLINE_PADDING)),
      onOutlineDocument: (outlineId) => onOpenDocument?.(outlineId),
      onRenameGroup: (groupId, name) => runCommand(renameGroup(session.context, groupId, name)),
      onCalendarMonth: (calendarId, month) => setMonths((current) => new Map(current).set(calendarId, month)),
      onCalendarJump: (calendarId, month) => {
        // A month outside the range: the range grows to it.
        const calendar = session.store.get("outlines", calendarId);
        if (calendar === undefined || !/^\d{4}-\d{2}$/.test(month)) return;
        const start = calendar.start ?? month;
        const end = calendar.end ?? start;
        if (!readOnly && (month < start || month > end)) runCommand(setCalendarRange(session.context, calendarId, month < start ? month : start, month > end ? month : end));
        setMonths((current) => new Map(current).set(calendarId, month));
      },
      onSetUrl: (itemId, url) => {
        if (session.store.has("items", itemId)) runCommand(setItemUrl(session.context, itemId, withScheme(url)));
      },
      onOpenUrl: (url) => actions.jumpTo(url),
      onDone: (itemId) => runCommand(completeItems(session.context, [itemId])),
      onReply: (commentId, text) => {
        if (session.store.has("items", commentId)) runCommand(createReply(session.context, commentId, settings.userName, text).command);
      },
      onResolve: (commentId) => {
        if (session.store.has("items", commentId)) runCommand(setResolved(session.context, commentId, true));
      },
    }),
    [readOnly, onOpenRecord, runCommand, session, actions, model, heightOf, onOpenDocument, settings.userName],
  );

  // Zoom: trackpad pinch (WebKit), Cmd/Ctrl + = - 0, and the zoom buttons.
  const pinch = useMemo<PinchHandler>(
    () => ({
      begin: () => flow.getZoom(),
      change: (zoom, clientX, clientY) => {
        const box = wrapper.current?.getBoundingClientRect();
        if (box === undefined) return;
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
        const view = flow.getViewport();
        const px = clientX - box.left;
        const py = clientY - box.top;
        const fx = (px - view.x) / view.zoom;
        const fy = (py - view.y) / view.zoom;
        void flow.setViewport({ x: px - fx * next, y: py - fy * next, zoom: next });
      },
    }),
    [flow],
  );
  usePinchZoom(wrapper, pinch);

  // A board with no saved viewport shows all its cards, centered. Fit one time, after the cards exist.
  const fitted = useRef(savedViewport(boardId) !== undefined);
  useEffect(() => {
    if (fitted.current || nodes.length === 0) return;
    fitted.current = true;
    requestAnimationFrame(() => void flow.fitView({ padding: 0.2, maxZoom: 1 }));
  }, [nodes.length, flow]);

  // Keep the view of this board when it closes (an item opens, back, the 3D view): a return shows the same part.
  // A pinch or a zoom key does not always end with onMoveEnd, so the last view is read here too.
  useEffect(
    () => () => {
      if (fitted.current) saveViewport(boardId, flow.getViewport());
    },
    [boardId, flow],
  );

  useEffect(() => {
    if (apiRef === undefined) return;
    apiRef.current = {
      viewCenter: () => {
        const box = wrapper.current?.getBoundingClientRect();
        if (box === undefined) return { x: 0, y: 0 };
        return flow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, flow]);

  // Copy and paste (⌘C / ⌘V, or Ctrl): small items and pages (core/clipboard.ts). A paste goes under the pointer,
  // or next to the copied cards. The keys and the copy/paste events (Edit menu) both work: one runs, not both.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  useEffect(() => {
    const element = wrapper.current;
    if (element === null) return;
    const move = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    const leave = () => {
      pointer.current = null;
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerleave", leave);
    return () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", leave);
    };
  }, []);
  useEffect(() => {
    if (copyNotice === null) return;
    const timer = window.setTimeout(() => setCopyNotice(null), 2500);
    return () => window.clearTimeout(timer);
  }, [copyNotice]);
  useEffect(() => {
    /** Text is selected or typed: copy and paste are for the text. */
    const forText = (target: EventTarget | null) => isTextTarget(target) || (window.getSelection()?.isCollapsed === false);
    let lastRun = 0;
    const copy = (): string | null => {
      const placeIds = flow.getNodes().filter((node) => node.selected).flatMap((node) => (node.data.node.placeId === null ? [] : [node.data.node.placeId]));
      if (placeIds.length === 0) return null;
      const cards = copyCards(session, placeIds);
      if (cards.length === 0) {
        setCopyNotice("Only small items and pages can be copied for now.");
        return null;
      }
      const text = cards.map((card) => [card.item.name, card.body].filter((part) => part.trim() !== "").join("\n")).join("\n\n");
      copiedCards = { cards, pastes: 0 };
      setCopyNotice(cards.length < placeIds.length ? `Copied ${cards.length} of ${placeIds.length}: only small items and pages can be copied for now.` : cards.length > 1 ? `Copied ${cards.length} items` : "Copied 1 item");
      return text;
    };
    const paste = (): boolean => {
      const clip = copiedCards;
      if (clip === null || readOnly) return false;
      clip.pastes += 1;
      const left = Math.min(...clip.cards.map((card) => card.place.x));
      const top = Math.min(...clip.cards.map((card) => card.place.y));
      const at = pointer.current !== null ? flow.screenToFlowPosition(pointer.current) : { x: left + 24 * clip.pastes, y: top + 24 * clip.pastes };
      const { command, placeIds, webCopies } = pasteCards(session.context, clip.cards, boardId, at);
      pendingSelection.current = new Set(placeIds);
      if (!runCommand(command)) return true;
      // A link object is a full copy (SPEC 1.1): its saved page or PDF and its notes are copied too.
      for (const copy of webCopies) {
        const url = clip.cards.find((card) => card.item.id === copy.from)?.item.url ?? "";
        void copyWebFiles(session, copy.from, copy.to, url).catch((problem: unknown) => console.error(problem));
      }
      return true;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || forText(event.target) || isComposing(event)) return;
      const key = shortcutKey(event);
      if (key === "c") {
        const text = copy();
        if (text === null) return;
        lastRun = Date.now();
        event.preventDefault();
        navigator.clipboard?.writeText(text).catch(() => undefined);
      } else if (key === "v" && paste()) {
        lastRun = Date.now();
        event.preventDefault();
      }
    };
    const onCopy = (event: ClipboardEvent) => {
      if (Date.now() - lastRun < 300 || forText(event.target)) return;
      const text = copy();
      if (text === null) return;
      event.preventDefault();
      event.clipboardData?.setData("text/plain", text);
    };
    const onPaste = (event: ClipboardEvent) => {
      if (Date.now() - lastRun < 300 || forText(event.target)) return;
      if (paste()) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
    };
  }, [flow, session, boardId, readOnly, runCommand]);

  // One selected card. Enter: edit its name (text cards and notes: their text). F2: edit its name.
  // Outline rows: Alt+Up / Alt+Down move the row, Tab / Shift+Tab indent and outdent it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextTarget(event.target) || isComposing(event) || readOnly) return;
      const selected = flow.getNodes().filter((node) => node.selected);
      const node = selected[0];
      if (selected.length !== 1 || node === undefined || node.data.node.kind !== "item") return;
      const { placeId, outlineId } = node.data.node;
      if (outlineId !== null && placeId !== null && !event.metaKey && !event.ctrlKey) {
        if (event.key === "Tab") {
          event.preventDefault();
          runCommand(event.shiftKey ? outdentRow(session.context, placeId) : indentRow(session.context, placeId));
          return;
        }
        if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          event.preventDefault();
          runCommand(moveRow(session.context, placeId, event.key === "ArrowUp" ? -1 : 1));
          return;
        }
      }
      if ((event.key !== "Enter" && event.key !== "F2") || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      const data = node.data.node;
      // A flashcard edits from its right-click menu only.
      if (data.view === "flashcard" && !data.isBoard) return;
      const textCard = (data.view === "text" && !data.isBoard) || isNote(data) || (!data.isBoard && (data.view === "comment" || data.view === "todo"));
      setEditing({ nodeId: node.id, edit: textCard && event.key === "Enter" ? "body" : "title" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flow, readOnly, runCommand, session]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || isTextTarget(event.target)) return;
      const key = shortcutKey(event);
      if (key === "=" || key === "+") {
        event.preventDefault();
        void flow.zoomIn({ duration: 150 });
      } else if (key === "-") {
        event.preventDefault();
        void flow.zoomOut({ duration: 150 });
      } else if (key === "0") {
        event.preventDefault();
        void flow.fitView({ duration: 200, padding: 0.2 });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flow]);

  /**
   * What a drop at a screen point does with the dragged nodes:
   * - "board": a board card. The records move into that board.
   * - "note": a card that is not a board. Dragged scribbles go into it (magnetic drop).
   * - "outline": an outline frame. Dragged cards join the outline.
   * Cards come before frames: a frame is large and lies under its cards.
   */
  const dropTargetAt = useCallback(
    (clientX: number, clientY: number, dragged: readonly FlowNode[]): { node: FlowNode; kind: "board" | "note" | "outline" | "calendar" } | null => {
      const point = flow.screenToFlowPosition({ x: clientX, y: clientY });
      const draggedIds = new Set(dragged.map((node) => node.id));
      const onlyScribbles = dragged.every((node) => node.data.node.kind === "stamp");
      const onlyFreeCards = dragged.every((node) => node.data.node.kind === "item" && node.data.node.outlineId === null);
      const onlyCards = dragged.every((node) => node.data.node.kind === "item" && !node.data.node.pinned);
      // A group card is never dropped into anything: it moves with its cards.
      if (dragged.some((node) => isGroupShape(node.data.node))) return null;
      let frame: FlowNode | null = null;
      for (const node of flow.getNodes()) {
        if (draggedIds.has(node.id) || !isInside(flow.getInternalNode(node.id)?.internals.positionAbsolute ?? node.position, node, point)) continue;
        const data = node.data.node;
        if (data.kind === "outline") {
          if (onlyFreeCards && !dragged.some((other) => other.data.node.outlineId === data.outlineId)) frame = node;
          continue;
        }
        // A calendar takes cards onto the day under the pointer (also its own cards: they move to that day).
        if (data.kind === "calendar") {
          if (onlyCards && dragged.every((other) => other.data.node.outlineId === null || other.data.node.outlineId === data.outlineId)) frame = node;
          continue;
        }
        if (data.kind !== "item" || data.isReference || isGroupShape(data)) continue;
        if (data.isBoard) return { node, kind: "board" };
        if (onlyScribbles) return { node, kind: "note" };
      }
      if (frame === null) return null;
      return { node: frame, kind: frame.data.node.kind === "calendar" ? "calendar" : "outline" };
    },
    [flow],
  );

  const overBench = useRef<0 | 1 | "bench" | null>(null);
  /**
   * A drag of group cards: the cards in their shapes (at the drag start) move with them. `members`: node ID ->
   * its position at the start. `start`: the position of the grabbed node at the start.
   */
  const groupDrag = useRef<{ start: Point; members: Map<string, Point> } | null>(null);
  const onNodeDragStart = useCallback(
    (_event: globalThis.MouseEvent | TouchEvent, grabbed: FlowNode, dragged: FlowNode[]) => {
      groupDrag.current = null;
      const groups = dragged.filter((node) => isGroupShape(node.data.node));
      if (groups.length === 0) return;
      const draggedIds = new Set(dragged.map((node) => node.id));
      // Free nodes only (an outline row moves with its frame; a frame in a group moves its rows).
      const others = flow
        .getNodes()
        // An attached object (pinned) stays at the side of its card: it follows the card, not the group.
        .filter((node) => node.parentId === undefined && node.data.node.kind !== "stub" && !node.data.node.pinned)
        .map((node) => ({ key: node.id, box: { x: node.data.node.x, y: node.data.node.y, w: node.data.node.w, h: node.data.node.h }, group: isGroupShape(node.data.node), node }));
      const members = new Map<string, Point>();
      // A group in a dragged group brings its own cards too.
      const queue = [...groups];
      const seen = new Set(queue.map((node) => node.id));
      while (queue.length > 0) {
        const group = queue.shift()!;
        const data = group.data.node;
        for (const member of membersOf({ key: group.id, box: { x: data.x, y: data.y, w: data.w, h: data.h }, shape: data.shape, shapePath: data.shapePath }, others)) {
          if (draggedIds.has(member.key) || members.has(member.key)) continue;
          members.set(member.key, { ...member.node.position });
          if (member.group && !seen.has(member.key)) {
            seen.add(member.key);
            queue.push(member.node);
          }
        }
      }
      if (members.size > 0) groupDrag.current = { start: { ...grabbed.position }, members };
    },
    [flow],
  );
  // A small item dragged out of a page lands on the board here (SPEC 1.1). Only on the board itself, not on a window.
  useEffect(
    () =>
      registerBoardDrop((clientX, clientY) => {
        const element = document.elementFromPoint(clientX, clientY);
        if (element?.closest(".react-flow") == null || element.closest(".text-page, .react-flow__node") !== null) return null;
        const point = flow.screenToFlowPosition({ x: clientX, y: clientY });
        return { boardId, x: roundBoard(point.x), y: roundBoard(point.y) };
      }),
    [flow, boardId],
  );
  // A picked bench slot: a press on a card here drags a ghost copy of its item to the bench.
  useEffect(
    () =>
      registerBenchSource((element) => {
        const nodeId = element.closest(".react-flow__node")?.getAttribute("data-id");
        const node = nodeId == null ? undefined : flow.getNode(nodeId);
        return node?.data.node.kind === "item" ? node.data.node.recordId : null;
      }),
    [flow],
  );

  const onNodeDrag = useCallback(
    (event: globalThis.MouseEvent | TouchEvent, _node: FlowNode, dragged: FlowNode[]) => {
      const { clientX, clientY } = pointerOf(event);
      // The cards in a dragged group follow it.
      const carry = groupDrag.current;
      if (carry !== null) {
        const dx = _node.position.x - carry.start.x;
        const dy = _node.position.y - carry.start.y;
        setNodes((current) => current.map((node) => {
          const start = carry.members.get(node.id);
          return start === undefined ? node : { ...node, position: { x: start.x + dx, y: start.y + dy } };
        }));
      }
      const target = dropTargetAt(clientX, clientY, dragged);
      setDropTargetId((current) => (current === (target?.node.id ?? null) ? current : (target?.node.id ?? null)));
      // Over the link bench: the bench shows the slot that takes the card.
      const benchSlot = benchSlotAt(clientX, clientY);
      if (benchSlot !== overBench.current) {
        overBench.current = benchSlot;
        hoverBench(benchSlot);
      }
    },
    [dropTargetAt],
  );

  const onNodeDragStop = useCallback(
    (event: globalThis.MouseEvent | TouchEvent, grabbed: FlowNode, dragged: FlowNode[]) => {
      setDropTargetId(null);
      // The cards that a dragged group carries are moved with it (in the last step, one command).
      const carried = groupDrag.current === null ? [] : flow.getNodes().filter((node) => groupDrag.current!.members.has(node.id));
      groupDrag.current = null;
      if (overBench.current !== null) hoverBench(null);
      overBench.current = null;
      const { clientX, clientY } = pointerOf(event);
      // A card dropped on the link bench goes into a slot. The card does not move.
      const benchSlot = benchSlotAt(clientX, clientY);
      if (benchSlot !== null && grabbed.data.node.kind === "item" && session.store.has("items", grabbed.data.node.recordId)) {
        sendToBench({ itemId: grabbed.data.node.recordId }, benchSlot === "bench" ? undefined : benchSlot);
        setLayoutRefresh((count) => count + 1);
        return;
      }
      // A small card dropped on an open page goes inside the page (SPEC 1.1). One undo step.
      const inPage = pagePointAt(clientX, clientY);
      const grabbedNode = grabbed.data.node;
      if (inPage !== null && !readOnly && grabbedNode.kind === "item" && grabbedNode.placeId !== null && !grabbedNode.isBoard && SMALL_KINDS.includes(grabbedNode.view) && inPage.pageId !== grabbedNode.recordId && isPageHome(session.store, session.graph, inPage.pageId)) {
        try {
          runCommand(moveIn(session.context, grabbedNode.placeId, inPage.pageId, inPage.at).command);
        } catch (problem) {
          console.error(problem);
        }
        setLayoutRefresh((count) => count + 1);
        return;
      }
      const target = dropTargetAt(clientX, clientY, dragged);
      const placeIds = [...new Set(dragged.flatMap((node) => (node.data.node.placeId === null ? [] : [node.data.node.placeId])))];
      if (target?.kind === "board") {
        runCommand(moveIntoBoard(session.context, placeIds, target.node.data.node.recordId));
        return;
      }
      // A calendar: the cards go onto the day under the pointer.
      if (target?.kind === "calendar" && target.node.data.node.outlineId !== null) {
        const calendarId = target.node.data.node.outlineId;
        const calendar = session.store.get("outlines", calendarId);
        const day = calendar === undefined ? null : dayAt(calendar, target.node.data.node.month, flow.screenToFlowPosition({ x: clientX, y: clientY }));
        setLayoutRefresh((count) => count + 1);
        // One card dropped on its own day: a new place in the order of the day (before the card under the pointer).
        const own = grabbed.data.node.placeId === null ? undefined : session.store.get("links", grabbed.data.node.placeId);
        if (day !== null && placeIds.length === 1 && own?.kind === "place" && own.outline === calendarId && own.day === day && own.until === undefined) {
          const point = flow.screenToFlowPosition({ x: clientX, y: clientY });
          const sameDay = flow
            .getNodes()
            .filter((node) => node.id !== grabbed.id && node.data.node.inCalendar && node.data.node.placeId !== null && (session.store.get("links", node.data.node.placeId) as PlaceLink | undefined)?.day === day && (session.store.get("links", node.data.node.placeId) as PlaceLink | undefined)?.outline === calendarId)
            .sort((left, right) => left.position.y - right.position.y);
          const before = sameDay.find((node) => node.position.y + (node.data.node.h ?? 0) / 2 > point.y);
          runCommand(reorderInDay(session.context, own.id, before?.data.node.placeId ?? null));
          return;
        }
        // A later week row of a card on more than one day: the card starts that many days before the drop day.
        if (day !== null) runCommand(snapToDay(session.context, placeIds, calendarId, addDays(day, -grabbed.data.node.spanOffset)));
        return;
      }
      // Outline rows: a drop in the frame reorders the row. A drop outside the frame takes the rows out there.
      const members = dragged.filter((node) => node.data.node.frameId !== null);
      if (members.length > 0 && members.length === dragged.length) {
        const frame = flow.getNode(members[0]!.data.node.frameId!);
        const point = flow.screenToFlowPosition({ x: clientX, y: clientY });
        // The rows go to their outline place again (also if the order did not change).
        setLayoutRefresh((count) => count + 1);
        if (frame !== undefined && isInside(frame.position, frame, point)) {
          if (members.length === 1 && grabbed.data.node.placeId !== null) runCommand(reorderCommand(grabbed, point));
          return;
        }
        const positions = new Map<Id, { x: number; y: number }>();
        for (const node of members) {
          const absolute = flow.getInternalNode(node.id)?.internals.positionAbsolute ?? node.position;
          if (node.data.node.placeId !== null) positions.set(node.data.node.placeId, { x: roundBoard(absolute.x), y: roundBoard(absolute.y) });
        }
        runCommand(removeFromOutline(session.context, [...positions.keys()], heightOf, positions));
        return;
      }
      if (target?.kind === "note" && target.node.data.node.placeId !== null) {
        const notePlaceId = target.node.data.node.placeId;
        // Each scribble keeps its place on the screen: the drop position, inside the note bounds.
        const move = moveOfDrag(grabbed);
        const into = dragged.flatMap((node) => {
          const { placeId, x, y } = node.data.node;
          return placeId === null ? [] : [moveIntoNote(session.context, placeId, notePlaceId, { x: x + move.x, y: y + move.y })];
        });
        runCommand(mergeCommands(...into));
        return;
      }
      if (target?.kind === "outline" && target.node.data.node.outlineId !== null) {
        const member = session.graph.membersOf(target.node.data.node.outlineId)[0];
        if (member !== undefined) runCommand(createOutline(session.context, boardId, [member.id, ...placeIds]).command);
        return;
      }
      // One move for the whole group: the move of the grabbed node, rounded one time.
      // Each node gets its saved position plus this move. Thus the distances between
      // the nodes never change (rounding each node by itself could change them).
      const move = moveOfDrag(grabbed);
      if (move.x === 0 && move.y === 0) return;
      const rects = new Map<Id, Partial<Rect>>();
      const commands: Command[] = [];
      for (const node of [...dragged, ...carried]) {
        const { placeId, x, y, kind, outlineId } = node.data.node;
        // An outline frame moves its outline. The cards follow from the outline layout.
        if (kind === "outline" && outlineId !== null) {
          commands.push(moveOutline(session.context, outlineId, cleanNumber(x + OUTLINE_PADDING + move.x), cleanNumber(y + OUTLINE_PADDING + OUTLINE_BAR + move.y)));
        } else if (kind === "calendar" && outlineId !== null) {
          // A calendar frame is its record box: its days and cards follow.
          commands.push(moveOutline(session.context, outlineId, cleanNumber(x + move.x), cleanNumber(y + move.y)));
        } else if (placeId !== null && outlineId === null) {
          rects.set(placeId, { x: cleanNumber(x + move.x), y: cleanNumber(y + move.y) });
        }
      }
      runCommand(mergeCommands(setPlacementRects(session.context, rects), ...commands));
    },
    [runCommand, session, dropTargetAt, boardId, flow, heightOf],
  );

  /** A row dropped at a board point: before or after the nearest other row of its outline. */
  const reorderCommand = (grabbed: FlowNode, point: Point): Command => {
    const placeId = grabbed.data.node.placeId!;
    const outlineId = grabbed.data.node.outlineId!;
    const horizontal = session.store.get("outlines", outlineId)?.direction === "horizontal";
    let best: { node: BoardNode; distance: number } | null = null;
    const heightOfNode = (node: BoardNode): number => {
      const place = node.placeId === null ? undefined : session.store.get("links", node.placeId);
      return place?.kind === "place" ? cardHeight(session.store, session.graph, place) : node.h;
    };
    for (const node of model.nodes) {
      if (node.outlineId !== outlineId || node.frameId === null || node.placeId === placeId) continue;
      const center = { x: node.x + node.w / 2, y: node.y + heightOfNode(node) / 2 };
      const distance = Math.hypot(center.x - point.x, center.y - point.y);
      if (best === null || distance < best.distance) best = { node, distance };
    }
    if (best === null || best.node.placeId === null) return { label: "Move row", ops: [] };
    const target = best.node;
    const place = session.store.get("links", target.placeId!);
    const height = heightOfNode(target);
    // Top rows of a horizontal outline are in a row: left or right. All other rows: above or below.
    const topRow = place?.kind === "place" && place.parent === undefined;
    const side = horizontal && topRow ? (point.x < target.x + target.w / 2 ? "before" : "after") : point.y < target.y + height / 2 ? "before" : "after";
    return moveRowTo(session.context, placeId, target.placeId!, side);
  };

  /** Creates an object or a card at a board point. `on`: the item it is attached to. Then its first field opens for typing. */
  const createAt = useCallback(
    (view: ViewStyle, x: number, y: number, options: { board?: boolean; on?: Id } = {}) => {
      const { command, placeId } = createItemOnBoard(session.context, {
        boardId,
        view,
        x: Math.round(x),
        y: Math.round(y),
        board: options.board === true,
        on: options.on,
        author: view === "comment" ? settings.userName : undefined,
      });
      pendingSelection.current = new Set([placeId]);
      runCommand(command);
      setEditing({ nodeId: placeId, edit: firstEdit(view) });
    },
    [session, boardId, runCommand, settings.userName],
  );

  const onPaneClick = useCallback(
    (event: MouseEvent) => {
      setLinkSourceId(null);
      // A click on the board ends a size edit of a group frame, and a text edit (each change is saved already).
      setEditing((current) => (current?.edit === "shape" || current?.edit === "body" ? null : current));
      if (readOnly) return;
      const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      // A new group: its title opens for typing (like a new board).
      if (tool.createsGroup === "outline") {
        const created = createOutlineWithPage(session.context, boardId, roundBoard(point.x), roundBoard(point.y));
        if (runCommand(created.command) !== false) setEditing({ nodeId: `outline:${created.outlineId}`, edit: "title" });
        afterUse();
        return;
      }
      if (tool.createsGroup === "calendar") {
        const month = monthOf(new Date().toISOString());
        const created = createCalendar(session.context, boardId, roundBoard(point.x), roundBoard(point.y), month, addMonths(month, 2));
        if (runCommand(created.command) !== false) setEditing({ nodeId: `calendar:${created.calendarId}`, edit: "title" });
        afterUse();
        return;
      }
      if (tool.createsView === undefined) return;
      createAt(tool.createsView, point.x, point.y, { board: tool.createsBoard === true });
      afterUse();
    },
    [tool, readOnly, flow, session, boardId, runCommand, createAt, afterUse],
  );

  // Link tool: click the first card, then the second card. The tool stays on for more links.
  useEffect(() => setLinkSourceId(null), [toolId, boardId]);
  useEffect(() => {
    if (linkSourceId === null) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setLinkSourceId(null);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [linkSourceId]);

  // A jump to a card on this board: select it and center it.
  useEffect(() => {
    if (focus == null) return;
    const node = model.nodes.find((candidate) => candidate.recordId === focus.recordId && candidate.kind === "item" && !candidate.isReference);
    if (node === undefined) return;
    pendingSelection.current = new Set([node.id]);
    setNodes((current) => current.map((other) => ({ ...other, selected: other.id === node.id })));
    requestAnimationFrame(() => void flow.setCenter(node.x + node.w / 2, node.y + node.h / 2, { zoom: Math.max(flow.getZoom(), 1), duration: 300 }));
    // Only a new jump centers again. Model changes do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  const onNodeClick = useCallback(
    (_event: MouseEvent, node: FlowNode) => {
      if (onPick !== undefined) {
        const kind = node.data.node.kind;
        if (kind === "item" || kind === "ghost" || kind === "stub") onPick(node.data.node.recordId);
        return;
      }
      // A create tool on a calendar: the new item goes onto the day under the pointer (named by the day).
      if (tool.createsView !== undefined && node.data.node.kind === "calendar" && node.data.node.outlineId !== null && !readOnly) {
        const calendarId = node.data.node.outlineId;
        const calendar = session.store.get("outlines", calendarId);
        const day = calendar === undefined ? null : dayAt(calendar, node.data.node.month, flow.screenToFlowPosition({ x: _event.clientX, y: _event.clientY }));
        const created = day === null ? null : createOnDay(session.context, calendarId, day, tool.createsView, { board: tool.createsBoard === true, author: tool.createsView === "comment" ? settings.userName : undefined });
        if (created !== null) {
          pendingSelection.current = new Set([created.placeId]);
          runCommand(created.command);
          setLayoutRefresh((count) => count + 1);
          afterUse();
        }
        return;
      }
      // The comment and link tools: a click on a card attaches a new object to it.
      if (tool.attaches === true && tool.createsView !== undefined && !readOnly) {
        const data = node.data.node;
        if (data.kind !== "item" || data.pinned || data.attachedTo !== null) return;
        createAt(tool.createsView, data.x + data.w + 18, data.y, { on: data.recordId });
        afterUse();
        return;
      }
      if (!linkMode) return;
      const record = node.data.node.recordId;
      if (session.store.has("stamps", record)) return;
      if (linkSourceId === null) {
        setLinkSourceId(node.id);
        return;
      }
      const from = recordOfNode(model, linkSourceId);
      setLinkSourceId(null);
      if (from === null || from === record) return;
      runCommand(createRelation(session.context, { from, to: record }).command);
    },
    [linkMode, linkSourceId, model, runCommand, session, onPick, tool, readOnly, createAt, afterUse, flow, settings.userName],
  );

  const onBeforeDelete = useCallback(
    async ({ nodes: deletedNodes, edges: deletedEdges }: { nodes: FlowNode[]; edges: Edge[] }) => {
      const placeIds = [...new Set(deletedNodes.flatMap((node) => (node.data.node.placeId === null ? [] : [node.data.node.placeId])))];
      const linkIds = deletedEdges.flatMap((edge) => linkIdOf(edge));
      // Delete on an outline frame takes the cards out of the outline. The cards stay.
      const frameMembers = deletedNodes
        .flatMap((node) => (node.data.node.kind === "outline" && node.data.node.outlineId !== null ? session.graph.membersOf(node.data.node.outlineId) : []))
        .map((place) => place.id)
        .filter((placeId) => !placeIds.includes(placeId));
      // Delete on a calendar frame deletes the calendar. Its cards stay, in a column at its right side.
      const calendars = deletedNodes.filter((node) => node.data.node.kind === "calendar" && node.data.node.outlineId !== null);
      const calendarCommands = calendars.map((node) => {
        const members = session.graph.membersOf(node.data.node.outlineId!).map((place) => place.id);
        return deleteCalendar(session.context, node.data.node.outlineId!, calendarExitPositions(node.data.node, members));
      });
      runCommand(
        mergeCommands(
          ...calendarCommands,
          removeFromOutline(session.context, frameMembers, heightOf),
          removeFromBoard(session.context, placeIds),
          deleteLinks(session.context, [...new Set(linkIds)]),
        ),
      );
      // The store is the source. React Flow must not delete anything itself.
      return false;
    },
    [runCommand, session, heightOf],
  );

  const onSelection = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams<FlowNode, Edge>) => {
      const cards = onePerPlace(selectedNodes.filter((node) => node.data.node.kind !== "outline" && node.data.node.kind !== "calendar"));
      onSelectionChange({
        recordIds: cards.map((node) => node.data.node.recordId),
        placeIds: cards.flatMap((node) => (node.data.node.placeId === null ? [] : [node.data.node.placeId])),
        linkIds: selectedEdges.flatMap((edge) => linkIdOf(edge)),
        outlineIds: selectedNodes.flatMap((node) => ((node.data.node.kind === "outline" || node.data.node.kind === "calendar") && node.data.node.outlineId !== null ? [node.data.node.outlineId] : [])),
      });
    },
    [onSelectionChange],
  );

  const onNodeDoubleClick = useCallback(
    (event: MouseEvent, node: FlowNode) => {
      // A card that is being edited does not open.
      if (editing?.nodeId === node.id) return;
      const data = node.data.node;
      if (data.kind === "stub" || data.kind === "outline") return;
      // A group card: a double-click on its name renames it (the card does it). It never opens as a page.
      if (isGroupShape(data)) return;
      // A calendar is a group, not an item: a double-click asks for a month to show.
      if (data.kind === "calendar") {
        setEditing({ nodeId: node.id, edit: "month" });
        return;
      }
      // A reference opens a quick view of the item. The item stays on its home board.
      if (data.isReference) {
        actions.openText(data.recordId);
        return;
      }
      // A link object opens its web address (or asks for one).
      if (data.kind === "item" && data.view === "weblink" && !hasBoard(data)) {
        if (data.url !== "") actions.jumpTo(data.url, data.recordId);
        else if (!readOnly) setEditing({ nodeId: node.id, edit: "url" });
        return;
      }
      // Notes and text cards edit in place: a note never opens as a page.
      if (isNote(data) || (data.view === "text" && data.kind === "item" && !hasBoard(data))) {
        if (readOnly || data.kind !== "item") return;
        // A double-click on the name edits the name.
        if (event.target instanceof Element && event.target.closest(".card-title") !== null) {
          setEditing({ nodeId: node.id, edit: "title" });
          return;
        }
        // A collapsed note opens first, then its text is ready for typing.
        if (isCollapsed(data) && data.placeId !== null) runCommand(setPlacementExpanded(session.context, data.placeId, true));
        setEditing({ nodeId: node.id, edit: "body" });
        return;
      }
      // A quote edits its text in place, like a note. A folded quote (a bubble) unfolds first. It never opens as a page.
      if (isQuote(data)) {
        if (readOnly) return;
        if (isCollapsed(data) && data.placeId !== null) runCommand(setPlacementExpanded(session.context, data.placeId, true));
        setEditing({ nodeId: node.id, edit: "body" });
        return;
      }
      onOpenRecord(data.recordId);
    },
    [onOpenRecord, editing, actions, readOnly, runCommand, session],
  );

  /** "Export … as a bundle": a folder with the board (or item) as one Markdown file and as board data. */
  const exportEntry = useCallback(
    (itemId: Id, label: string): MenuEntry => ({
      label,
      icon: <FolderDown size={14} />,
      onSelect: () =>
        void session.exportBoardBundle(itemId, t).then(
          (folder) => folder !== null && void actions.askFields({ title: "Bundle saved", submit: "OK", fields: [{ key: "folder", label: "Folder", value: folder, help: "It has one Markdown file, and the board data (it imports again, or opens as a vault)." }] }),
          (problem: unknown) => void actions.askFields({ title: "The bundle could not be saved", submit: "OK", fields: [{ key: "why", label: "Reason", value: String(problem).replace(/^Error: /, "") }] }),
        ),
    }),
    [session, actions],
  );

  /** The right-click menu for the selected cards (or the card under the pointer). */
  /**
   * The link tool after the first item: finds the second item with a search of all boards (names and texts).
   * A hit in a text links to that text (`quote`).
   */
  const searchLinkTarget = useCallback(async () => {
    if (linkSourceId === null) return;
    const from = recordOfNode(model, linkSourceId);
    setLinkSourceId(null);
    const target = await actions.searchLinkTarget();
    if (from === null || target === null || (target.itemId === from && target.quote === undefined)) return;
    runCommand(createRelation(session.context, { from, to: target.itemId, quote: target.quote }).command);
  }, [linkSourceId, model, actions, runCommand, session]);

  /** A right-click while a link waits for its second item: the search, in place of the menu. True if it took the click. */
  const searchOnRightClick = useCallback(
    (event: MouseEvent | globalThis.MouseEvent): boolean => {
      if (linkMode && linkSourceId !== null) {
        event.preventDefault();
        void searchLinkTarget();
        return true;
      }
      if (onPick !== undefined) {
        event.preventDefault();
        actions.searchTextLinkTarget();
        return true;
      }
      return false;
    },
    [linkMode, linkSourceId, searchLinkTarget, onPick, actions],
  );

  const openNodeMenu = useCallback(
    (event: MouseEvent, clicked: FlowNode | null) => {
      event.preventDefault();
      if (searchOnRightClick(event)) return;
      const selected = flow.getNodes().filter((node) => node.selected);
      const targets = clicked !== null && !selected.some((node) => node.id === clicked.id) ? [clicked] : selected;
      const cards = onePerPlace(targets.filter((node) => node.data.node.kind === "item" || node.data.node.kind === "stamp"));
      const placeIds = cards.flatMap((node) => (node.data.node.placeId === null ? [] : [node.data.node.placeId]));
      const single = cards.length === 1 ? cards[0]!.data.node : null;
      const entries: MenuEntry[] = [];
      // The menu of an outline frame.
      const groupFrame = clicked?.data.node.kind === "outline" || clicked?.data.node.kind === "calendar" ? clicked : null;
      if (groupFrame !== null && groupFrame.data.node.outlineId !== null) {
        const groupId = groupFrame.data.node.outlineId;
        const group = session.store.get("outlines", groupId);
        if (group !== undefined) {
          entries.push({
            label: "Export as one document…",
            icon: <FileDown size={14} />,
            onSelect: () => void session.exportText(fileNameOf(groupTitle(group, t), ""), groupDocument(session.store, session.graph, groupId, t)).catch(() => undefined),
          });
          entries.push(exportEntry(boardId, "Export this whole board as a bundle…"));
          if (!readOnly) entries.push({ label: "Rename group", icon: <Pencil size={14} />, onSelect: () => setEditing({ nodeId: groupFrame.id, edit: "title" }) });
        }
        if (isCalendar(group)) {
          if (!readOnly) {
            entries.push(
              {
                label: "Months…",
                icon: <CalendarRange size={14} />,
                onSelect: async () => {
                  const month = /^\d{4}-(0[1-9]|1[0-2])$/;
                  const values = await actions.askFields({
                    title: "Months of the calendar",
                    submit: "Save",
                    fields: [
                      { key: "start", label: "First month", value: group!.start ?? monthOf(new Date().toISOString()), placeholder: "2026-01", pattern: month },
                      { key: "end", label: "Last month", value: group!.end ?? group!.start ?? "", placeholder: "2026-03", pattern: month, help: "Months as YYYY-MM, for example 2026-01 to 2026-03." },
                    ],
                  });
                  if (values !== null) runCommand(setCalendarRange(session.context, groupId, values.start!, values.end!));
                },
              },
              { kind: "separator" },
              {
                label: "New calendar next to this one",
                icon: <CalendarDays size={14} />,
                onSelect: () => {
                  const month = monthOf(new Date().toISOString());
                  runCommand(createCalendar(session.context, boardId, roundBoard(groupFrame.data.node.x + groupFrame.data.node.w + 60), roundBoard(groupFrame.data.node.y), month, addMonths(month, 2)).command);
                },
              },
              {
                label: "Take all cards out of the calendar",
                icon: <Ungroup size={14} />,
                onSelect: () => {
                  const members = session.graph.membersOf(groupId).map((place) => place.id);
                  runCommand(removeFromOutline(session.context, members, heightOf, calendarExitPositions(groupFrame.data.node, members)));
                },
              },
            );
          }
          setMenu({ x: event.clientX, y: event.clientY, entries });
          return;
        }
      }
      const frame = clicked?.data.node.kind === "outline" ? clicked.data.node : null;
      if (frame !== null && frame.outlineId !== null) {
        const outlineId = frame.outlineId;
        const outline = session.store.get("outlines", outlineId);
        const horizontal = outline?.direction === "horizontal";
        entries.push({ kind: "separator" }, { label: "Read as one document", icon: <ScrollText size={14} />, onSelect: () => onOpenDocument?.(outlineId) });
        if (!readOnly) {
          entries.push(
            { label: "Change width", icon: <MoveHorizontal size={14} />, onSelect: () => setEditing({ nodeId: clicked!.id, edit: "shape" }) },
            horizontal
              ? { label: "Make vertical", icon: <Rows3 size={14} />, onSelect: () => runCommand(setOutlineDirection(session.context, outlineId, "vertical")) }
              : { label: "Make horizontal", icon: <Columns3 size={14} />, onSelect: () => runCommand(setOutlineDirection(session.context, outlineId, "horizontal")) },
            { kind: "separator" },
            { label: "No list marks", onSelect: () => runCommand(setOutlineList(session.context, outlineId, null)) },
            { label: "Bullets", onSelect: () => runCommand(setOutlineList(session.context, outlineId, "bullets")) },
            { label: "Numbers", onSelect: () => runCommand(setOutlineList(session.context, outlineId, "numbers")) },
            { kind: "separator" },
            {
              label: "New outline next to this one",
              icon: <ListTree size={14} />,
              onSelect: () => runCommand(createOutlineWithPage(session.context, boardId, roundBoard(frame.x + frame.w + 60), roundBoard(frame.y + OUTLINE_PADDING + OUTLINE_BAR)).command),
            },
            {
              label: "Take all cards out of the outline",
              icon: <Ungroup size={14} />,
              onSelect: () => runCommand(removeFromOutline(session.context, session.graph.membersOf(outlineId).map((place) => place.id), heightOf)),
            },
          );
        }
        setMenu({ x: event.clientX, y: event.clientY, entries });
        return;
      }
      // A row of an outline: reorder and indent.
      if (!readOnly && single?.outlineId != null && single.placeId !== null) {
        const placeId = single.placeId;
        const run = (command: Command) => () => runCommand(command);
        entries.push(
          { label: "Move to front", icon: <ArrowUpToLine size={14} />, onSelect: run(moveRowToEnd(session.context, placeId, "front")) },
          { label: "Move up", icon: <ArrowUp size={14} />, onSelect: run(moveRow(session.context, placeId, -1)) },
          { label: "Move down", icon: <ArrowDown size={14} />, onSelect: run(moveRow(session.context, placeId, 1)) },
          { label: "Move to back", icon: <ArrowDownToLine size={14} />, onSelect: run(moveRowToEnd(session.context, placeId, "back")) },
          { label: "One level deeper (Tab)", icon: <IndentIncrease size={14} />, onSelect: run(indentRow(session.context, placeId)) },
          { label: "One level up (Shift+Tab)", icon: <IndentDecrease size={14} />, onSelect: run(outdentRow(session.context, placeId)) },
          { kind: "separator" },
        );
      }
      if (!readOnly && single?.kind === "item" && single.attachedTo === null && !single.pinned && single.view !== "comment" && single.view !== "weblink") {
        const target = single;
        entries.push(
          { label: "Add comment", icon: <MessageSquarePlus size={14} />, onSelect: () => createAt("comment", target.x + target.w + 18, target.y, { on: target.recordId }) },
          { label: "Attach a web link", icon: <Globe size={14} />, onSelect: () => createAt("weblink", target.x + target.w + 18, target.y, { on: target.recordId }) },
        );
      }
      if (!readOnly && single?.kind === "item" && single.attachedTo !== null && single.placeId !== null) {
        const object = single;
        entries.push({
          label: "Detach",
          icon: <Unlink size={14} />,
          onSelect: () => runCommand(mergeCommands(attachItem(session.context, object.recordId, null), setPlacementRects(session.context, new Map([[object.placeId!, { x: roundBoard(object.x), y: roundBoard(object.y) }]])))),
        });
      }
      if (!readOnly && single?.kind === "item" && single.view === "weblink" && single.placeId !== null) {
        const link = single;
        // A local file: a PDF opens in the reader; another file shows in Finder (it cannot be read aloud).
        const local = isLocalPath(link.url);
        const pdf = isPdfPath(link.url);
        if (link.url !== "") {
          entries.push({ label: !local ? "Open in web browser" : pdf ? "Open PDF" : "Show in Finder", icon: <Globe size={14} />, onSelect: () => (local ? actions.jumpTo(link.url, link.recordId) : actions.openInBrowser(link.url)) });
          if (!local) entries.push({ label: "Download and open website locally", icon: <Download size={14} />, onSelect: () => actions.openUrl(link.url, false, undefined, link.recordId) });
          if (!local || pdf) entries.push({ label: "Read aloud", icon: <AudioLines size={14} />, onSelect: () => actions.openUrl(link.url, true, undefined, link.recordId) });
        }
        entries.push({ label: "Edit name and link", icon: <Pencil size={14} />, onSelect: () => setEditing({ nodeId: link.id, edit: "title" }) });
      }
      // A card in a calendar: more than one day (no time), or a time (one day).
      if (!readOnly && single?.kind === "item" && single.inCalendar && single.placeId !== null) {
        const place = session.store.get("links", single.placeId);
        if (place?.kind === "place" && place.day !== undefined) {
          const placeId = single.placeId;
          entries.push({
            label: place.until !== undefined ? `Days: ${place.day} – ${place.until}…` : place.time !== undefined ? `Time: ${place.time}…` : "Days and time…",
            icon: <CalendarRange size={14} />,
            onSelect: () => setScheduleFor(placeId),
          });
          entries.push({ kind: "separator" });
        }
      }
      // Notes: yellow (the default) or gray ("Gray out").
      const notes = cards.filter((node) => node.data.node.kind === "item" && isNote(node.data.node) && node.data.node.placeId !== null);
      if (!readOnly && notes.length > 0) {
        const notePlaces = notes.map((node) => node.data.node.placeId!);
        const gray = notes.every((node) => node.data.node.color === NOTE_GRAY);
        entries.push(
          gray
            ? { label: notes.length > 1 ? `Yellow notes (${notes.length})` : "Yellow note", icon: <StickyNote size={14} color="#ffd60a" />, onSelect: () => runCommand(setCardColor(session.context, notePlaces, null)) }
            : { label: notes.length > 1 ? `Gray out (${notes.length})` : "Gray out", icon: <StickyNote size={14} color={NOTE_GRAY} />, onSelect: () => runCommand(setCardColor(session.context, notePlaces, NOTE_GRAY)) },
        );
      }
      // Scribbles: the ink color (the theme ink, or a pen color).
      const scribbles = cards.filter((node) => node.data.node.kind === "stamp" && node.data.node.placeId !== null);
      if (!readOnly && scribbles.length > 0) {
        const scribblePlaces = scribbles.map((node) => node.data.node.placeId!);
        entries.push({
          kind: "choices",
          label: "Scribble color",
          choices: [{ id: "ink", text: "Ink", tip: "Black or white, as the theme" }, ...SCRIBBLE_COLORS.map((entry) => ({ id: entry.color, text: "●", tip: entry.label, color: entry.color }))],
          current: scribbles.every((node) => node.data.node.color === scribbles[0]!.data.node.color) ? (scribbles[0]!.data.node.color ?? "ink") : "",
          onSelect: (id: string) => runCommand(setCardColor(session.context, scribblePlaces, id === "ink" ? null : id)),
        });
        entries.push({ kind: "separator" });
      }
      const todos = cards.filter((node) => node.data.node.kind === "item" && node.data.node.view === "todo");
      if (!readOnly && todos.length > 0) {
        entries.push({ label: todos.length > 1 ? `Done (${todos.length})` : "Done", icon: <Check size={14} />, onSelect: () => runCommand(completeItems(session.context, todos.map((node) => node.data.node.recordId))) });
        entries.push({
          kind: "colors",
          colors: [...TODO_COLORS],
          onSelect: (color: string) => runCommand(setCardColor(session.context, todos.flatMap((node) => (node.data.node.placeId === null ? [] : [node.data.node.placeId])), color)),
        });
        entries.push({ kind: "separator" });
      }
      if (single?.kind === "item" && single.isBoard && !single.isReference) {
        entries.push({ label: "Open board", icon: <Maximize2 size={14} />, onSelect: () => onOpenRecord(single.recordId) });
      }
      if (single?.kind === "item") entries.push(exportEntry(single.recordId, single.isBoard ? "Export this board as a bundle…" : "Export as a bundle…"));
      // A flashcard edits in place, from this menu only: its front (name) or its back (text).
      if (single?.kind === "item" && single.view === "flashcard" && !single.isBoard) {
        if (!readOnly) {
          const nodeId = cards[0]!.id;
          entries.push(
            { label: "Edit front", icon: <PenLine size={14} />, onSelect: () => setEditing({ nodeId, edit: "title" }) },
            { label: "Edit back", icon: <PenLine size={14} />, onSelect: () => setEditing({ nodeId, edit: "body" }) },
          );
        }
      } else if (single?.kind === "item" && isQuote(single)) {
        // A quote card: its text and its source edit in place. Its marks are one line of choices.
        if (!readOnly) {
          const nodeId = cards[0]!.id;
          const placeId = single.placeId;
          entries.push(
            { label: "Edit text", icon: <PenLine size={14} />, onSelect: () => setEditing({ nodeId, edit: "body" }) },
            { label: "Edit source", icon: <PenLine size={14} />, onSelect: () => setEditing({ nodeId, edit: "title" }) },
          );
          if (placeId !== null) {
            entries.push({
              kind: "choices",
              label: "Marks",
              choices: QUOTE_MARKS.map((id) => ({ id, text: id === "none" ? "none" : QUOTE_GLYPHS[id].open + QUOTE_GLYPHS[id].close, tip: QUOTE_GLYPHS[id].tip })),
              current: single.marks,
              onSelect: (id) => runCommand(setQuoteMarks(session.context, placeId, id as QuoteMarks)),
            });
            entries.push(
              isCollapsed(single)
                ? { label: "Unfold the quote", icon: <Maximize2 size={14} />, onSelect: () => runCommand(setPlacementExpanded(session.context, placeId, true)) }
                : { label: "Fold into a bubble", icon: <Minimize2 size={14} />, onSelect: () => runCommand(setPlacementExpanded(session.context, placeId, false)) },
            );
          }
        }
      } else if (single?.kind === "item" && isGroupShape(single)) {
        // A group card: its name, and its look (only the outline, or filled with its color).
        if (!readOnly) {
          const nodeId = cards[0]!.id;
          const placeId = single.placeId;
          entries.push({ label: "Rename", icon: <PenLine size={14} />, onSelect: () => setEditing({ nodeId, edit: "title" }) });
          if (placeId !== null) {
            entries.push({
              kind: "choices",
              label: "Look",
              choices: [
                { id: "outline", text: "Outline only", tip: "Only the outline of the group shows" },
                { id: "filled", text: "Filled", tip: "The color of the group fills its area" },
              ],
              current: single.filled ? "filled" : "outline",
              onSelect: (id) => runCommand(setGroupFilled(session.context, placeId, id === "filled")),
            });
          }
        }
      } else if (single?.kind === "item" && !isNote(single) && !single.isBoard) {
        entries.push({ label: "Edit text", icon: <PenLine size={14} />, onSelect: () => actions.openText(single.recordId) });
      }
      // The links of the card: "→ name" goes to a linked item (at its passage), "← name" to an item that links here.
      // Also for items on other boards (no line on this board).
      if (single?.kind === "item") {
        const { outgoing, incoming } = linksOf(session.store, session.graph, session.rootId, single.recordId);
        const LIMIT = 6;
        if (outgoing.length + incoming.length > 0) entries.push({ kind: "separator" });
        for (const end of outgoing.slice(0, LIMIT)) {
          entries.push({ label: `→ ${end.title}`, icon: <ArrowRight size={14} />, onSelect: () => (end.linkId !== null ? actions.followLink(end.linkId) : actions.openAt(end.itemId)) });
        }
        for (const end of incoming.slice(0, LIMIT)) {
          entries.push({ label: `← ${end.title}`, icon: <ArrowLeft size={14} />, onSelect: () => actions.openAt(end.itemId, end.excerpt !== "" ? { quote: end.excerpt } : {}) });
        }
        if (outgoing.length > LIMIT || incoming.length > LIMIT) {
          entries.push({ label: "All links: open the page", icon: <Link2 size={14} />, onSelect: () => actions.openText(single.recordId) });
        }
      }
      if (single?.isReference === true) {
        const home = session.graph.homeOf(single.recordId);
        entries.push({ label: "Open home board", icon: <Home size={14} />, disabled: home === undefined, onSelect: () => home !== undefined && actions.openBoard(home.from, single.recordId) });
      }
      if (single !== null && single.kind === "item" && session.store.has("items", single.recordId)) {
        entries.push({ label: "Send to link bench", icon: <Link2 size={14} />, onSelect: () => sendToBench({ itemId: single.recordId }) });
      }
      if (!readOnly && placeIds.length > 0) {
        entries.push({
          label: placeIds.length > 1 ? `Move ${placeIds.length} to board…` : "Move to board…",
          icon: <FolderInput size={14} />,
          onSelect: async () => {
            const target = await actions.pickItem({ title: "Move to board…", allowCreate: true });
            if (target !== null) runCommand(moveIntoBoard(session.context, placeIds, target));
          },
        });
        const items = cards.filter((node) => node.data.node.kind === "item" && node.data.node.outlineId === null);
        if (items.length > 0 && cards.every((node) => node.data.node.kind === "item")) {
          entries.push({ label: items.length === cards.length ? "Make outline" : "Add to outline", icon: <ListTree size={14} />, onSelect: () => runCommand(createOutline(session.context, boardId, placeIds).command) });
        }
        const members = placeIds.filter((placeId) => cards.some((node) => node.data.node.placeId === placeId && node.data.node.outlineId !== null));
        if (members.length > 0) {
          entries.push({ label: "Take out of outline", icon: <Ungroup size={14} />, onSelect: () => runCommand(removeFromOutline(session.context, members, heightOf)) });
        }
        if (single?.placeId != null && single.innerStamps.length > 0) {
          const notePlaceId = single.placeId;
          entries.push({ label: "Take scribbles out", icon: <LogOut size={14} />, onSelect: () => runCommand(releaseFromNote(session.context, notePlaceId)) });
        }
      }
      if (entries.length > 0) setMenu({ x: event.clientX, y: event.clientY, entries });
    },
    [flow, actions, session, readOnly, runCommand, boardId, onOpenRecord, heightOf, onOpenDocument, createAt, exportEntry, searchOnRightClick],
  );

  /** The right-click menu of the empty canvas: the board background. */
  const openPaneMenu = useCallback(
    (event: MouseEvent | globalThis.MouseEvent) => {
      event.preventDefault();
      if (searchOnRightClick(event)) return;
      if (readOnly) return;
      const image = (scope: "board" | "all") => () => void chooseBackgroundImage(session, runCommand, scope, boardId);
      const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const entries: MenuEntry[] = [
        { label: "New outline here", icon: <ListTree size={14} />, onSelect: () => runCommand(createOutlineWithPage(session.context, boardId, roundBoard(point.x), roundBoard(point.y)).command) },
        {
          label: "New calendar here",
          icon: <CalendarDays size={14} />,
          onSelect: () => {
            const month = monthOf(new Date().toISOString());
            runCommand(createCalendar(session.context, boardId, roundBoard(point.x), roundBoard(point.y), month, addMonths(month, 2)).command);
          },
        },
        { kind: "separator" },
        exportEntry(boardId, "Export this board as a bundle…"),
        {
          label: "Import a board bundle here…",
          icon: <FolderUp size={14} />,
          onSelect: () =>
            void session.importBoardBundle(boardId, roundBoard(point.x), roundBoard(point.y)).then(
              (result) => {
                if (result === null) return;
                if ("problem" in result) void actions.askFields({ title: "The bundle could not be imported", submit: "OK", fields: [{ key: "why", label: "Reason", value: result.problem }] });
                else runCommand(result.command);
              },
              (problem: unknown) => void actions.askFields({ title: "The bundle could not be imported", submit: "OK", fields: [{ key: "why", label: "Reason", value: String(problem).replace(/^Error: /, "") }] }),
            ),
        },
        { kind: "separator" },
        { label: "Background image for this board…", icon: <ImagePlus size={14} />, onSelect: image("board") },
        { label: "Background image for all boards…", icon: <ImagePlus size={14} />, onSelect: image("all") },
      ];
      if (ownBackground !== null) entries.push({ label: "Remove the background of this board", icon: <ImageMinus size={14} />, onSelect: () => void applyBackground(session, runCommand, "board", boardId, null) });
      if (settings.defaultBackground !== null) entries.push({ label: "Remove the default background", icon: <ImageMinus size={14} />, onSelect: () => void applyBackground(session, runCommand, "all", boardId, null) });
      setMenu({ x: event.clientX, y: event.clientY, entries });
    },
    [readOnly, session, runCommand, boardId, ownBackground, settings.defaultBackground, flow, background, actions, exportEntry, searchOnRightClick],
  );

  const toBoard = useCallback((screen: Point) => flow.screenToFlowPosition(screen), [flow]);

  const onDrawDone = useCallback(
    (points: Point[]) => {
      if (tool.overlay === "lasso") {
        const inside = new Set(
          nodes
            .filter((node) => node.data.node.kind !== "stub")
            .filter((node) => pointInPolygon(centerOf(node), points))
            .map((node) => node.id),
        );
        setNodes((current) => current.map((node) => ({ ...node, selected: inside.has(node.id) })));
        if (!sticky) onToolChange("select");
        return;
      }
      if (readOnly) return;
      // Group tools: a rectangle or an ellipse from corner to corner, or a free shape. A click (no drag) makes a
      // rectangle or ellipse of the default size there.
      if (tool.createsShape !== undefined) {
        const shape = tool.createsShape;
        const blob = shape === "blob" ? blobFromPoints(points) : null;
        if (shape === "blob" && blob === null) return;
        const start = points[0];
        if (start === undefined) return;
        const box = blob?.box ?? boxFromDrag(points) ?? { x: Math.round(start.x), y: Math.round(start.y), w: DEFAULT_SIZE.group.w, h: DEFAULT_SIZE.group.h };
        const { command, placeId } = createGroupShape(session.context, { boardId, box, shape, shapePath: blob?.path });
        if (runCommand(command)) {
          pendingSelection.current = new Set([placeId]);
          // A new group opens its name for typing.
          setEditing({ nodeId: placeId, edit: "title" });
        }
        if (!sticky) onToolChange("select");
        return;
      }
      if (tool.overlay === "scribble") {
        const board = strokeToStamp(points);
        if (board === null) return;
        // A stroke that starts and ends in a card that is not a board goes into that card (a note holds it).
        const host = model.nodes.find((node) => node.kind === "item" && !node.isBoard && !node.isReference && !isGroupShape(node) && containsPoint(node, points[0]!) && containsPoint(node, points.at(-1)!));
        const holder = host === undefined ? boardId : host.recordId;
        const shape = host === undefined ? board : { ...board, x: cleanNumber(board.x - host.x), y: cleanNumber(board.y - host.y) };
        // All strokes of one scribble session (in the same holder) go into one scribble.
        const target = scribbleTarget.current;
        const targetPlace = target === null ? undefined : session.store.get("links", target);
        const ink = settings.scribbleColor;
        // A new pen color starts a new scribble (one scribble has one color).
        if (targetPlace?.kind === "place" && targetPlace.from === holder && (targetPlace.color ?? null) === ink) {
          const stroke = strokeOnBoard(shape);
          if (stroke !== null) runCommand(joinStamps(session.context, [targetPlace.id], stroke));
          return;
        }
        const { command, placeId } = createStampOnBoard(session.context, { boardId: holder, ...shape, color: ink });
        if (runCommand(command)) scribbleTarget.current = placeId;
        return;
      }
      if (tool.overlay === "erase") {
        const radius = ERASER_RADIUS_PX / flow.getZoom();
        const hits = new Map<Id, Set<number>>();
        // Scribbles on the board, and scribbles inside cards (in card coordinates).
        const holders: { id: Id; dx: number; dy: number }[] = [
          { id: boardId, dx: 0, dy: 0 },
          ...model.nodes.filter((node) => node.innerStamps.length > 0).map((node) => ({ id: node.recordId, dx: node.x, dy: node.y })),
        ];
        for (const holder of holders) {
          const local = points.map((point) => ({ x: point.x - holder.dx, y: point.y - holder.dy }));
          for (const place of session.graph.childrenOf(holder.id)) {
            if (!session.store.has("stamps", place.to)) continue;
            // A stamp that the app cannot read is not erased. It stays as it is.
            (readStrokesOfPlacement(session.context, place) ?? []).forEach((stroke, index) => {
              if (!strokeHit(stroke, local, radius)) return;
              const set = hits.get(place.id) ?? new Set<number>();
              set.add(index);
              hits.set(place.id, set);
            });
          }
        }
        if (hits.size > 0) runCommand(eraseStrokes(session.context, hits));
      }
    },
    [tool, nodes, onToolChange, readOnly, runCommand, session, boardId, flow, model, sticky, settings.scribbleColor],
  );

  return (
    <BoardCallbacksContext.Provider value={callbacks}>
      <div ref={wrapper} className="board-wrapper">
        <ReactFlow<FlowNode, Edge>
          className={`board tool-${toolId}`}
          style={backgroundStyle ?? undefined}
          onPaneContextMenu={openPaneMenu}
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={(changes) => setNodes((current) => applyNodeChanges(withSpanParts(changes, current), current))}
          onEdgesChange={(changes) => setEdges((current) => applyEdgeChanges(changes, current))}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onNodeDoubleClick={onNodeDoubleClick}
          // Double-click a link line: go to its target (at its text location, if it has one).
          onEdgeDoubleClick={(_event, edge) => {
            const linkId = linkIdOf(edge)[0];
            if (linkId !== undefined) actions.followLink(linkId);
          }}
          onPaneClick={onPaneClick}
          onNodeClick={onNodeClick}
          onNodeContextMenu={(event, node) => openNodeMenu(event, node)}
          onSelectionContextMenu={(event) => openNodeMenu(event, null)}
          onBeforeDelete={onBeforeDelete}
          onSelectionChange={onSelection}
          onMoveEnd={(_, viewport) => saveViewport(boardId, viewport)}
          defaultViewport={savedViewport(boardId) ?? { x: 80, y: 80, zoom: 1 }}
          connectionMode={ConnectionMode.Loose}
          nodesDraggable={!readOnly && toolId === "select"}
          nodesConnectable={false}
          elementsSelectable={toolId === "select"}
          // A mouse drag pans. Ctrl or Cmd + drag selects with a box. The right button stays free.
          panOnDrag={[0, 1]}
          selectionOnDrag={false}
          selectionKeyCode={["Control", "Meta"]}
          panOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
          multiSelectionKeyCode={["Shift", "Meta", "Control"]}
        >
          {background?.kind !== "image" && <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--border)" />}
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
        {tool.overlay !== undefined && <DrawOverlay mode={tool.overlay} toBoard={toBoard} onDone={onDrawDone} />}
        {menu !== null && <ContextMenu request={menu} onClose={() => setMenu(null)} />}
        {scheduleFor !== null && session.store.get("links", scheduleFor)?.kind === "place" && (
          <ScheduleDialog
            place={session.store.get("links", scheduleFor) as PlaceLink}
            onDone={(schedule) => {
              const placeId = scheduleFor;
              setScheduleFor(null);
              if (schedule !== null) runCommand(setCardSchedule(session.context, placeId, schedule));
            }}
          />
        )}
        {copyNotice !== null && !linkMode && <div className="board-hint">{copyNotice}</div>}
        {linkMode && (
          <div className="board-hint">
            {linkSourceId === null
              ? "Link: click the first item."
              : `Link from “${titleOf(session.store, recordOfNode(model, linkSourceId) ?? "")}”: click the second item, or right-click to search all boards. Esc cancels.`}
            {linkSourceId !== null && (
              <button
                className="board-hint-button"
                onClick={() => void searchLinkTarget()}
              >
                Search…
              </button>
            )}
          </div>
        )}
      </div>
    </BoardCallbacksContext.Provider>
  );
}

/** The copied cards (⌘C), for ⌘V on any board. In memory only, while the app is open. */
let copiedCards: { cards: CopiedCard[]; pastes: number } | null = null;

/** The node ID of the first week row of a calendar card ("<place ID>~<n>" → "<place ID>"). */
function spanBase(nodeId: string): string {
  const mark = nodeId.indexOf("~");
  return mark === -1 ? nodeId : nodeId.slice(0, mark);
}

/** One node for each place: the week rows of a calendar card on more than one day count one time. */
function onePerPlace(nodes: readonly FlowNode[]): FlowNode[] {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    const key = node.data.node.placeId ?? node.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A card on more than one day has one node for each week row. Selecting one row selects all its rows. */
function withSpanParts(changes: NodeChange<FlowNode>[], nodes: readonly FlowNode[]): NodeChange<FlowNode>[] {
  if (!nodes.some((node) => node.id.includes("~"))) return changes;
  const rows = new Map<string, string[]>();
  for (const node of nodes) rows.set(spanBase(node.id), [...(rows.get(spanBase(node.id)) ?? []), node.id]);
  const result: NodeChange<FlowNode>[] = [];
  const done = new Set<string>();
  for (const change of changes) {
    if (change.type !== "select") {
      result.push(change);
      continue;
    }
    for (const id of rows.get(spanBase(change.id)) ?? [change.id]) {
      if (done.has(id)) continue;
      done.add(id);
      result.push({ ...change, id });
    }
  }
  return result;
}

/**
 * A note is never larger than a sticky note (DEFAULT_SIZE.note). A larger saved size shows at that size; the data stays.
 * A flashcard always has the sticky note size. A calendar gives its cards their size.
 */
function noteCap(node: BoardNode): { w: number; h: number } {
  if (node.inCalendar) return { w: node.w, h: node.h };
  if (node.kind === "item" && node.view === "flashcard" && !node.isBoard) return { ...DEFAULT_SIZE.note };
  if (!isNote(node)) return { w: node.w, h: node.h };
  return { w: Math.min(node.w, DEFAULT_SIZE.note.w), h: Math.min(node.h, DEFAULT_SIZE.note.h) };
}

function toFlowNodes(
  model: BoardModel,
  selected: Set<string>,
  link: { linkMode: boolean; linkSourceId: string | null },
  readOnly: boolean,
  editing: { nodeId: string; edit: InlineEdit } | null,
  dropTargetId: string | null,
): FlowNode[] {
  const frames = new Map(model.nodes.filter((node) => node.kind === "outline" || node.kind === "calendar").map((node) => [node.id, node]));
  return model.nodes.map((node) => {
    // A card in an outline is a child node of the frame: React Flow moves it with the frame.
    const frame = node.frameId === null ? undefined : frames.get(node.frameId);
    return {
    id: node.id,
    type: node.kind === "stamp" ? "stamp" : node.kind === "stub" ? "stub" : node.kind === "outline" ? "outline" : node.kind === "calendar" ? "calendar" : "card",
    position: frame === undefined ? { x: node.x, y: node.y } : { x: node.x - frame.x, y: node.y - frame.y },
    ...(frame === undefined ? {} : { parentId: frame.id }),
    // A collapsed card has no fixed width: it fits its name. React Flow measures it.
    // In an outline or a calendar, it keeps its width: the rows line up.
    width: isCollapsed(node) && !node.inCalendar && node.outlineId === null ? undefined : noteCap(node).w,
    // A link object shows its full name: its height follows the lines of the name.
    // A quote card: its height grows with the text (its saved height is the least height).
    height: isFullLink(node) || (isQuote(node) && !isCollapsed(node)) ? undefined : isCollapsed(node) && !node.inCalendar ? COLLAPSED_HEIGHT : noteCap(node).h,
    selected: selected.has(node.id),
    // Drag the frame to move the outline. Drag a row to reorder it, or out of the frame to take it out.
    // An attached object (comment, link) stays at the side of its card: "Detach" frees it.
    draggable: node.kind !== "stub" && !node.pinned && !readOnly && editing?.nodeId !== node.id,
    selectable: node.kind !== "stub",
    // An opened card in a full calendar day lies over its neighbors.
    // A group card (a loose area) lies behind all: behind outline and calendar frames too.
    zIndex: isGroupShape(node) ? -2 : node.kind === "outline" || node.kind === "calendar" ? -1 : node.calendarPopped ? 20 : undefined,
    // "nopan": a mouse press on a stub must not start a board pan. Then the click reaches the stub.
    // A card that is being edited does not pan either: a drag in it selects text.
    // A group card takes the pointer only at its edge and name (the node box lets clicks through to the board).
    className: [node.kind === "stub" || editing?.nodeId === node.id ? "nopan" : "", isGroupShape(node) ? "group-shape-node" : ""].filter(Boolean).join(" ") || undefined,
    data: {
      node,
      linkMode: link.linkMode,
      linkSource: link.linkSourceId === node.id,
      dropTarget: dropTargetId === node.id,
      editing: editing?.nodeId === node.id ? editing.edit : null,
    },
  };
  });
}

function toFlowEdges(model: BoardModel, selected: Set<string>): Edge[] {
  return model.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    selected: selected.has(edge.id),
    selectable: edge.kind === "relation",
    deletable: edge.kind === "relation",
    type: "center",
    className: `edge-${edge.kind}`,
    style: edgeStyle(edge),
    data: {
      linkId: edge.linkId,
      color: edge.group !== undefined ? groupColor(edge.group) : edge.kind === "attach" ? "#ff2bd6" : edge.kind !== "relation" ? "var(--accent)" : undefined,
      start: edge.start,
      end: edge.end,
      offset: edge.offset,
    },
  }));
}

function edgeStyle(edge: BoardEdge): { stroke?: string } {
  return edge.group === undefined ? {} : { stroke: groupColor(edge.group) };
}

function linkIdOf(edge: Edge): Id[] {
  const linkId = (edge.data as { linkId?: Id | null } | undefined)?.linkId;
  return linkId === null || linkId === undefined ? [] : [linkId];
}

function recordOfNode(model: BoardModel, nodeId: string): Id | null {
  return model.nodes.find((node) => node.id === nodeId)?.recordId ?? null;
}

function pointerOf(event: globalThis.MouseEvent | TouchEvent): { clientX: number; clientY: number } {
  if ("clientX" in event) return { clientX: event.clientX, clientY: event.clientY };
  const touch = event.changedTouches[0] ?? event.touches[0];
  return { clientX: touch?.clientX ?? 0, clientY: touch?.clientY ?? 0 };
}

/** The move of a dragged node from its saved position, rounded to the board precision. */
export function moveOfDrag(node: { position: Point; data: { node: { x: number; y: number } } }): Point {
  return {
    x: roundBoard(node.position.x - node.data.node.x),
    y: roundBoard(node.position.y - node.data.node.y),
  };
}

function centerOf(node: FlowNode): Point {
  const w = node.measured?.width ?? node.width ?? node.data.node.w;
  const h = node.measured?.height ?? node.height ?? node.data.node.h;
  return { x: node.position.x + w / 2, y: node.position.y + h / 2 };
}

/** True if a board point is inside a node box (absolute position). */
function isInside(position: Point, node: FlowNode, point: Point): boolean {
  const width = node.measured?.width ?? node.width ?? 0;
  const height = node.measured?.height ?? node.height ?? 0;
  return point.x >= position.x && point.x <= position.x + width && point.y >= position.y && point.y <= position.y + height;
}

/** True if a board point is inside a card of the model. */
function containsPoint(node: BoardNode, point: Point): boolean {
  return point.x >= node.x && point.x <= node.x + node.w && point.y >= node.y && point.y <= node.y + node.h;
}

function mergeCommands(...commands: Command[]): Command {
  const ops = commands.flatMap((command) => command.ops);
  const labels = commands.filter((command) => command.ops.length > 0).map((command) => command.label);
  return { label: labels.join(" + ") || "Delete", ops };
}

/** The field that a new card opens for typing. */
function firstEdit(view: ViewStyle): InlineEdit {
  if (view === "text" || view === "comment" || view === "todo" || view === "quote") return "body";
  if (view === "weblink") return "url";
  return "title";
}


/** Where the cards of a calendar go when they leave it: in a column at its right side. */
function calendarExitPositions(frame: BoardNode, placeIds: readonly Id[]): Map<Id, { x: number; y: number }> {
  return new Map(placeIds.map((placeId, index) => [placeId, { x: roundBoard(frame.x + frame.w + 40), y: roundBoard(frame.y + index * (COLLAPSED_HEIGHT + 12)) }]));
}

/** True for a group card (a loose area of the board, view "group"). */
export function isGroupShape(node: BoardNode): boolean {
  return node.kind === "item" && node.view === "group" && !node.isBoard;
}
