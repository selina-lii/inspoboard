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
  useViewport,
  type Edge,
  type OnSelectionChangeParams,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { FolderDown } from "lucide-react";
import { applyFoundMedia, createMediaItem, needsPicture, setMedia } from "../../core/media";
import { MEDIA_KINDS } from "../../core/types";
import { usePlugins } from "../plugins/pluginsContext";
import { pastedImageName } from "../editor/images";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type MutableRefObject } from "react";
import {
  completeItems,
  createReply,
  setResolved,
  setItemUrl,
  createItemOnBoard,
  createOutlineWithPage,
  createRelation,
  deleteLinks,
  setItemSubtitle,
  removeFromBoard,
  renameItem,
  setPlacementExpanded,
  setPlacementRects,
  writeText,
  backgroundBox,
  DEFAULT_SIZE,
} from "../../core/actions";
import {
  indentRow,
  moveRow,
  outdentRow,
  removeFromOutline,
  setOutlineList,
  setOutlineWidth,
} from "../../core/outline";
import { type Id, type PlaceLink, type ViewStyle } from "../../core/types";
import { ScheduleDialog } from "../dialogs/ScheduleFields";
import { addMonths, calendarPointAt, clockOf, createCalendar, createOnDay, setCalendarView, setCardSchedule, deleteCalendar, monthOf, renameGroup, setCalendarRange } from "../../core/groups";
import { fileNameOfPath, withScheme } from "../web/savedPages";
import { FILE_DROP, type FileDrop } from "../app/fileDrop";
import { ContextMenu, type MenuEntry, type MenuRequest } from "../app/ContextMenu";
import { useBoardBackground } from "../app/vaultImages";
import { isTextTarget } from "../app/dom";
import { isComposing, shortcutKey } from "../app/keys";
import { usePinchZoom, type PinchHandler } from "../app/gestures";
import { useRunCommand, useSession, useSessionState, useStoreRevision } from "../app/sessionContext";
import { useWorkspaceActions } from "../app/workspaceActions";
import { DrawOverlay } from "../tools/DrawOverlay";
import { toolById, type ToolId } from "../tools/registry";
import { type Point } from "../tools/stroke";
import { buildBoardModel, cardHeight, OUTLINE_PADDING, titleOf } from "./boardModel";
import { EDGE_TYPES } from "./edges";
import { openNodeMenuOf, openPaneMenuOf, type BoardMenuEnv } from "./boardMenus";
import { BoardCallbacksContext, hasBoard, isCollapsed, isNote, isQuote, NODE_TYPES, type BoardCallbacks, type FlowNode, type InlineEdit } from "./nodes";
import { roundBoard } from "../../core/stamps";
import { savedViewport, saveViewport } from "./viewports";
import { t } from "../i18n/i18n";
import "./board.css";
import { useCardDrag } from "./useCardDrag";
import { itemToEdit } from "../plugins/tray/autoCopies";
import { deleteOnMap, isSortingMap } from "../plugins/tray/tray";
import { useShownCheck } from "./useShownCheck";
import { createRadial, deleteRadial } from "../../core/radial";
import { useBoardClipboard } from "./useBoardClipboard";
import { useDrawDone } from "./useDrawDone";
import { onePerPlace, withSpanParts, toFlowNodes, toFlowEdges, linkIdOf, recordOfNode, mergeCommands, firstEdit, calendarExitPositions, isGroupFrame, isGroupShape } from "./flowAdapter";

export type BoardSelection = { recordIds: Id[]; placeIds: Id[]; linkIds: Id[]; outlineIds: Id[] };

/** Functions that the workspace can call on the board. */
export type BoardApi = {
  boardId: Id;
  /** The board point at the center of the visible area. */
  viewCenter(): { x: number; y: number };
  /** The part of the board that shows (pan and zoom), to give it again later (view history). */
  viewport(): Viewport;
  setViewport(viewport: Viewport): void;
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
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;



/** A background image that lies on the board (`backgroundOnBoard`): it moves and zooms with the cards, behind them. */
function BoardSheet({ url, box }: { url: string; box: { x: number; y: number; w: number; h: number } }) {
  const { x, y, zoom } = useViewport();
  return (
    <div className="board-sheet" aria-hidden>
      <img src={url} alt="" draggable={false} style={{ left: x + box.x * zoom, top: y + box.y * zoom, width: box.w * zoom, height: box.h * zoom }} />
    </div>
  );
}

export function BoardView(props: Props) {
  return (
    <ReactFlowProvider key={props.boardId}>
      <Board {...props} />
    </ReactFlowProvider>
  );
}

/** The shown day of each calendar (its view shows that week, month, or year), for the app session (not saved). */
const shownDays = new Map<Id, string>();
/** Calendar cards in a full day that the user opened. View state for the app session (not saved). */
const poppedCards = new Set<Id>();

function Board({ boardId, apiRef, tool: toolId, onToolChange, onOpenRecord: openRecordOf, onSelectionChange, focus, onPick, onOpenDocument, sticky = false }: Props) {
  const session = useSession();
  const revision = useStoreRevision();
  const { readOnly, settings } = useSessionState();
  // On a board of a processing map, changes of reference cards change copies (SPEC 7.16), and so does opening one.
  // (The scope of the board area does the changes: Workspace, useMapScope.)
  const runCommand = useRunCommand();
  const workspaceActions = useWorkspaceActions();
  const editTarget = useCallback(
    (itemId: Id) => {
      const place = session.graph.childrenOf(boardId).find((candidate) => candidate.to === itemId && candidate.ref === true);
      return place === undefined ? itemId : (itemToEdit(session, runCommand, place.id) ?? itemId);
    },
    [session, boardId, runCommand],
  );
  const actions = useMemo(() => ({ ...workspaceActions, openText: (itemId: Id) => workspaceActions.openText(editTarget(itemId)) }), [workspaceActions, editTarget]);
  const onOpenRecord = useCallback((recordId: Id) => openRecordOf(editTarget(recordId)), [openRecordOf, editTarget]);
  const flow = useReactFlow<FlowNode, Edge>();
  // The board background: its own, or the default of the vault.
  const ownBackground = session.store.get("items", boardId)?.background ?? null;
  const background = useBoardBackground(session, ownBackground ?? settings.defaultBackground);
  // A background image fills the view behind the cards (it stays still), or (`backgroundOnBoard`, the board's own image)
  // lies on the board like a cork board: BoardSheet. ("backgroundFixed" is from an older mode: kept, not used.)
  const onBoard = background?.kind === "image" && ownBackground !== null && session.store.get("items", boardId)?.backgroundOnBoard === true;
  const backgroundStyle =
    background?.kind === "color"
      ? { background: background.color }
      : background?.kind === "image" && !onBoard
        ? { backgroundImage: `url("${background.url}")`, backgroundSize: "cover", backgroundPosition: "center" }
        : null;
  const wrapper = useRef<HTMLDivElement>(null);
  const tool = toolById(toolId);
  const linkMode = tool.connects === true && !readOnly;

  /** The month that each calendar shows. View state: not saved. */
  // The month that each calendar shows. It stays for the app session: back from an item, the calendar shows the same month.
  const [days, setDayState] = useState<ReadonlyMap<Id, string>>(() => new Map(shownDays));
  const setDays = useCallback((update: (current: ReadonlyMap<Id, string>) => ReadonlyMap<Id, string>) => {
    setDayState((current) => {
      const next = update(current);
      for (const [calendarId, day] of next) shownDays.set(calendarId, day);
      return next;
    });
  }, []);
  const [popped, setPopped] = useState<ReadonlySet<Id>>(() => new Set(poppedCards));
  const model = useMemo(
    () => buildBoardModel(session.store, session.graph, boardId, { days, popped }),
    // The revision changes after each store write. It is a dependency on purpose.
    [session, boardId, revision, days, popped],
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
      // Keep the measured size of each card. Without it, React Flow hides a card with no fixed size (a collapsed
      // card, a link object) until it measures it again. A rebuild at the moment of that measure lost it, and the
      // card stayed hidden until the board opened again. The size observer still sees each later size change.
      const measured = new Map(previous.map((node) => [node.id, node.measured]));
      return toFlowNodes(model, selected, { linkMode, linkSourceId }, readOnly, editing, dropTargetId).map((node) => {
        const size = measured.get(node.id);
        return size === undefined ? node : { ...node, measured: size };
      });
    });
    setEdges((previous) => {
      const selected = new Set(previous.filter((edge) => edge.selected).map((edge) => edge.id));
      return toFlowEdges(model, selected);
    });
  }, [model, linkMode, linkSourceId, readOnly, editing, dropTargetId, layoutRefresh]);

  // Each card of the model must show: a missing one is measured again, and the session log says which (IDs only).
  useShownCheck(flow, model, boardId);

  // Files dropped from the system (Finder): a link card for each file, with its full path (SPEC 2.2, weblink).
  useEffect(() => {
    const element = wrapper.current;
    if (element === null || readOnly) return;
    const onFileDrop = (event: Event) => {
      const { paths, x, y } = (event as CustomEvent<FileDrop>).detail;
      const at = flow.screenToFlowPosition({ x, y });
      const created = paths.map((path, index) =>
        createItemOnBoard(session.context, { boardId, view: "weblink", x: roundBoard(at.x), y: roundBoard(at.y + index * (DEFAULT_SIZE.weblink.h + 12)), name: fileNameOfPath(path), url: path }),
      );
      pendingSelection.current = new Set(created.map((entry) => entry.placeId));
      runCommand({ label: "Add files as links", ops: created.flatMap((entry) => entry.command.ops) });
    };
    element.addEventListener(FILE_DROP, onFileDrop);
    return () => element.removeEventListener(FILE_DROP, onFileDrop);
  }, [session, boardId, flow, readOnly, runCommand]);

  // Multimedia items (SPEC 7.14): a "media-info" plugin reads the title, the artist, and the cover of a link.
  // Only on a click (network): the core itself makes no request.
  const plugins = usePlugins();
  const pluginsRef = useRef(plugins);
  pluginsRef.current = plugins;
  const mediaPlugin = plugins.plugins.find((plugin) => plugin.details !== null && plugin.capabilities.includes("media-info"))?.name ?? null;
  const comparePlugin = plugins.plugins.some((plugin) => plugin.details !== null && plugin.capabilities.includes("compare-text"));
  const fetchMedia = useCallback(
    async (itemId: Id) => {
      const url = session.store.get("items", itemId)?.media?.url;
      if (mediaPlugin === null || url === undefined) return;
      const result = (await pluginsRef.current.callWithProgress(mediaPlugin, "media_info", { url })) as Record<string, unknown> | undefined;
      if (result === undefined || result === null) return;
      const text = (key: string) => (typeof result[key] === "string" ? (result[key] as string) : undefined);
      let cover: string | undefined;
      const name = pastedImageName({ name: "cover", type: text("coverType") ?? "" });
      if (name !== null && text("cover") !== undefined) {
        try {
          cover = await session.saveImageBytes(name, Uint8Array.from(atob(text("cover")!), (ch) => ch.charCodeAt(0)));
        } catch (problem) {
          pluginsRef.current.setError(`The cover could not be saved: ${String(problem).replace(/^Error: /, "")}`);
        }
      }
      const kind = MEDIA_KINDS.find((value) => value === text("kind"));
      const duration = typeof result.duration === "number" && Number.isFinite(result.duration) ? result.duration : undefined;
      runCommand(applyFoundMedia(session.context, itemId, { title: text("title"), artist: text("artist"), kind, duration, cover }));
    },
    [session, mediaPlugin, runCommand],
  );

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
      onSetSubtitle: (itemId, subtitle) => {
        if (session.store.has("items", itemId)) runCommand(setItemSubtitle(session.context, itemId, subtitle));
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
      onCalendarDay: (calendarId, day) => setDays((current) => new Map(current).set(calendarId, day)),
      onCalendarJump: (calendarId, day) => {
        // A month outside the range: the range grows to it.
        const calendar = session.store.get("outlines", calendarId);
        if (calendar === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
        const month = monthOf(day);
        const start = calendar.start ?? month;
        const end = calendar.end ?? start;
        if (!readOnly && (month < start || month > end)) runCommand(setCalendarRange(session.context, calendarId, month < start ? month : start, month > end ? month : end));
        setDays((current) => new Map(current).set(calendarId, day));
      },
      onCalendarView: (calendarId, view, day) => {
        if (!readOnly) runCommand(setCalendarView(session.context, calendarId, view));
        if (day !== undefined) setDays((current) => new Map(current).set(calendarId, day));
      },
      onSetUrl: (itemId, url) => {
        if (session.store.has("items", itemId)) runCommand(setItemUrl(session.context, itemId, withScheme(url)));
      },
      onSetMedia: (itemId, media) => {
        if (!session.store.has("items", itemId)) return;
        const url = media?.url?.trim();
        runCommand(setMedia(session.context, itemId, media === null ? null : { ...media, url: url ? withScheme(url) : undefined }));
      },
      onOpenUrl: (url) => actions.openInBrowser(url),
      onChooseCover: (itemId) =>
        void session.importImage().then((path) => {
          const media = session.store.get("items", itemId)?.media;
          if (path === null || media === undefined) return;
          // A picture without its file: the chosen picture is the item. Else it is the cover.
          const next = needsPicture(media) ? { ...media, file: path } : { ...media, cover: path };
          runCommand(setMedia(session.context, itemId, next, "Choose cover"));
        }),
      onFetchMedia: mediaPlugin === null ? null : (itemId) => void fetchMedia(itemId),
      onDone: (itemId) => runCommand(completeItems(session.context, [itemId])),
      onReply: (commentId, text) => {
        if (session.store.has("items", commentId)) runCommand(createReply(session.context, commentId, settings.userName, text).command);
      },
      onResolve: (commentId) => {
        if (session.store.has("items", commentId)) runCommand(setResolved(session.context, commentId, true));
      },
    }),
    [readOnly, onOpenRecord, runCommand, session, actions, model, heightOf, onOpenDocument, settings.userName, mediaPlugin, fetchMedia],
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
      boardId,
      viewport: () => flow.getViewport(),
      setViewport: (viewport) => {
        fitted.current = true;
        void flow.setViewport(viewport);
      },
      viewCenter: () => {
        const box = wrapper.current?.getBoundingClientRect();
        if (box === undefined) return { x: 0, y: 0 };
        return flow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, flow, boardId]);

  const copyNotice = useBoardClipboard({ wrapper, flow, session, boardId, readOnly, runCommand, pendingSelection, mediaSources: settings.mediaSources });

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

  const { onNodeDragStart, onNodeDrag, onNodeDragStop } = useCardDrag({ session, runCommand, readOnly, flow, boardId, model, heightOf, comparePlugin, setNodes, setDropTargetId, setLayoutRefresh });

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
      // A click on the board ends a text edit (each change is saved already).
      setEditing((current) => (current?.edit === "body" ? null : current));
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
      if (tool.createsGroup === "radial") {
        const created = createRadial(session.context, boardId, roundBoard(point.x), roundBoard(point.y));
        if (runCommand(created.command) !== false) setEditing({ nodeId: `radial:${created.radialId}`, edit: "title" });
        afterUse();
        return;
      }
      if (tool.createsMedia === true) {
        const { command, placeId } = createMediaItem(session.context, { boardId, x: roundBoard(point.x), y: roundBoard(point.y), kind: "audio" });
        pendingSelection.current = new Set([placeId]);
        if (runCommand(command) !== false) setEditing({ nodeId: placeId, edit: "title" });
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

  // A jump to a card on this board: select it and center it. A card that does not show yet: a calendar card of a
  // period that is not shown makes the calendar go to its day (then the card shows, and the jump ends). Any other card
  // that the board does not show (for example a note that its page holds) opens in a window: a jump never ends on an
  // empty board.
  const waitingFocus = useRef<number | null>(null);
  useEffect(() => {
    if (focus == null) return;
    const node = model.nodes.find((candidate) => candidate.recordId === focus.recordId && candidate.kind === "item" && !candidate.isReference);
    if (node === undefined) {
      if (waitingFocus.current === focus.nonce) return;
      waitingFocus.current = focus.nonce;
      const place = session.graph.childrenOf(boardId).find((candidate) => candidate.to === focus.recordId && candidate.outline !== undefined && candidate.day !== undefined);
      if (place !== undefined) callbacks.onCalendarJump(place.outline!, place.day!);
      else actions.openText(focus.recordId);
      return;
    }
    waitingFocus.current = null;
    // The jump decides the view: the first "fit all cards" of a board that just opened must not move it away.
    fitted.current = true;
    pendingSelection.current = new Set([node.id]);
    setNodes((current) => current.map((other) => ({ ...other, selected: other.id === node.id })));
    requestAnimationFrame(() => {
      void flow.setCenter(node.x + node.w / 2, node.y + node.h / 2, { zoom: Math.max(flow.getZoom(), 1), duration: 300 });
      // Then a yellow box flashes twice around the card: the eye finds it at once.
      window.setTimeout(() => {
        const element = wrapper.current?.querySelector(`.react-flow__node[data-id="${CSS.escape(node.id)}"]`);
        if (element == null) return;
        element.classList.remove("locate-flash");
        void (element as HTMLElement).offsetWidth;
        element.classList.add("locate-flash");
        window.setTimeout(() => element.classList.remove("locate-flash"), 1400);
      }, 320);
    });
    // A new jump centers again. A model change only ends a jump that waits for its calendar day.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce, waitingFocus.current !== null ? model : null]);

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
        const frame = node.data.node;
        const place = calendar === undefined ? null : calendarPointAt(calendar, frame.calendarView, frame.calendarDay, flow.screenToFlowPosition({ x: _event.clientX, y: _event.clientY }), frame.calendarLanes);
        // In the hour grid of the week view: the new item has that time (one hour).
        const time = place?.minutes == null ? undefined : `${clockOf(place.minutes)}–${clockOf(Math.min(24 * 60 - 1, place.minutes + 60))}`;
        const created = place == null ? null : createOnDay(session.context, calendarId, place.day, tool.createsView, { board: tool.createsBoard === true, author: tool.createsView === "comment" ? settings.userName : undefined, time });
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
      // Delete on a radial core deletes the radial. Its cards stay where they show.
      const radialCommands = deletedNodes
        .filter((node) => node.data.node.kind === "radial" && node.data.node.outlineId !== null)
        .map((node) => {
          const positions = new Map<Id, { x: number; y: number }>();
          for (const member of flow.getNodes()) {
            if (member.data.node.frameId !== node.id || member.data.node.placeId === null) continue;
            const absolute = flow.getInternalNode(member.id)?.internals.positionAbsolute ?? member.position;
            positions.set(member.data.node.placeId, { x: roundBoard(absolute.x), y: roundBoard(absolute.y) });
          }
          return deleteRadial(session.context, node.data.node.outlineId!, positions);
        });
      runCommand(
        mergeCommands(
          ...calendarCommands,
          ...radialCommands,
          removeFromOutline(session.context, frameMembers, heightOf),
          // A sorting map: Delete throws the cards away (the tray plugin, SPEC 7.16).
          settings.tray && isSortingMap(session, boardId) ? deleteOnMap(session.context, boardId, placeIds) : removeFromBoard(session.context, placeIds),
          deleteLinks(session.context, [...new Set(linkIds)]),
        ),
      );
      // The store is the source. React Flow must not delete anything itself.
      return false;
    },
    [runCommand, session, heightOf, flow, settings.tray, boardId],
  );

  const onSelection = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams<FlowNode, Edge>) => {
      const cards = onePerPlace(selectedNodes.filter((node) => !isGroupFrame(node.data.node)));
      onSelectionChange({
        recordIds: cards.map((node) => node.data.node.recordId),
        placeIds: cards.flatMap((node) => (node.data.node.placeId === null ? [] : [node.data.node.placeId])),
        linkIds: selectedEdges.flatMap((edge) => linkIdOf(edge)),
        outlineIds: selectedNodes.flatMap((node) => (isGroupFrame(node.data.node) && node.data.node.outlineId !== null ? [node.data.node.outlineId] : [])),
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
      // A radial core: a double-click writes its text.
      if (data.kind === "radial") {
        if (!readOnly) setEditing({ nodeId: node.id, edit: "title" });
        return;
      }
      // A reference opens a quick view of the item. The item stays on its home board.
      if (data.isReference) {
        // A card on a processing map opens a copy for editing (SPEC 7.16: actions.openText); others open the item.
        actions.openText(data.recordId);
        return;
      }
      // A media item opens its link in the web browser (or asks for the fields).
      if (data.kind === "item" && data.media !== null && !hasBoard(data)) {
        if (data.media.url !== undefined) actions.openInBrowser(data.media.url);
        else if (!readOnly) setEditing({ nodeId: node.id, edit: "title" });
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

  // The board state of the right-click menus (boardMenus.tsx). Read when a menu opens.
  const menuEnv = (): BoardMenuEnv => ({ session, settings, readOnly, runCommand, actions, flow, boardId, ownBackground, comparePlugin, pendingSelection, heightOf, createAt, exportEntry, searchOnRightClick, onOpenRecord, onOpenDocument, setMenu, setEditing, setScheduleFor });
  const openNodeMenu = useCallback(
    (event: MouseEvent, clicked: FlowNode | null) => openNodeMenuOf(menuEnv(), event, clicked),
    [flow, actions, session, readOnly, runCommand, boardId, onOpenRecord, heightOf, onOpenDocument, createAt, exportEntry, searchOnRightClick, comparePlugin],
  );

  /** The right-click menu of the empty canvas: the board background. */
  const openPaneMenu = useCallback(
    (event: MouseEvent | globalThis.MouseEvent) => openPaneMenuOf(menuEnv(), event),
    [readOnly, session, runCommand, boardId, ownBackground, settings.defaultBackground, flow, background, actions, exportEntry, searchOnRightClick],
  );

  const toBoard = useCallback((screen: Point) => flow.screenToFlowPosition(screen), [flow]);

  const onDrawDone = useDrawDone({ tool, nodes, setNodes, onToolChange, sticky, readOnly, runCommand, session, boardId, flow, model, scribbleColor: settings.scribbleColor, pendingSelection, setEditing, scribbleTarget });

  return (
    <BoardCallbacksContext.Provider value={callbacks}>
      <div ref={wrapper} className="board-wrapper">
        <ReactFlow<FlowNode, Edge>
          className={`board tool-${toolId}${onBoard ? " on-sheet" : ""}`}
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
          {onBoard && background?.kind === "image" && <BoardSheet url={background.url} box={backgroundBox(session, boardId, background.aspect)} />}
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

