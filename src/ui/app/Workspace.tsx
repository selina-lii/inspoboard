// Workspace: the main window for one open vault. See docs/SPEC.md section 7.
// Layout: top bar, tool bar, then the board (2D), the galaxy (3D), or the full text page.
// Item text opens in floating windows above the view.

import { ArrowLeft, ArrowRight, Box, Maximize2, Check, Columns2, Dot, Minimize2, ScrollText, ListChecks, LoaderCircle, Lock, Plus, Redo2, Settings, Square, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isComposing } from "./keys";
import { collapseAll, createItemOnBoard, createRelation, DEFAULT_SIZE, placeRecord, renameItem, writeText } from "../../core/actions";
import type { Command } from "../../core/commands";
import { withTextLink } from "../../core/refs";
import { boardOrder } from "../../core/outline";
import type { SearchHit } from "../../core/search";
import type { Id } from "../../core/types";
import { BoardView, type BoardApi, type BoardSelection } from "../board/BoardView";
import { forgetViewport } from "../board/viewports";
import { titleOf } from "../board/boardModel";
import { ItemPicker, type PickResult } from "../dialogs/ItemPicker";
import { SearchDialog } from "../dialogs/SearchDialog";
import { SettingsDialog } from "../dialogs/SettingsDialog";
import { GalaxyView } from "../galaxy/GalaxyView";
import { PluginMenu } from "../plugins/PluginMenu";
import { PluginsProvider } from "../plugins/pluginsContext";
import { SpeechProvider } from "../plugins/speech";
import { SpeechBar } from "../plugins/SpeechBar";
import { SelectionTranslate } from "../plugins/SelectionTranslate";
import { ReaderToolSlot, WebButton, WebOpener, WebPagesProvider, WebReaderLayer, WhenNoPage } from "../web/WebPages";
import { FieldsDialog, type FieldsRequest } from "../dialogs/FieldsDialog";
import { ActionItemsDialog } from "../dialogs/ActionItemsDialog";
import { TrashDialog } from "../dialogs/TrashDialog";
import { TOOL_MENUS, TOOLBAR_GROUPS, TOOLS, toolById, type ToolId } from "../tools/registry";
import { ToolChoice } from "../tools/ToolChoice";
import { EditorWindows, type EditorWindowState } from "../windows/EditorWindows";
import { DocumentView } from "../windows/DocumentView";
import { TextPage } from "../windows/TextPage";
import { PageToolSlotContext } from "./pageToolSlot";
import { Banners } from "./Banners";
import { ColorManager } from "./ColorManager";
import { BackupButton } from "./BackupButton";
import { ContextBar } from "./ContextBar";
import { ErrorBoundary } from "./ErrorBoundary";
import { CommitField } from "./fields";
import { useHistoryState, useRunCommand, useSession, useSessionState, useStoreRevision } from "./sessionContext";
import { useNavigation, type Navigation, type View, type ViewMode } from "./navigation";
import { useShortcuts } from "./shortcuts";
import { JumpProvider, WorkspaceActionsProvider, type JumpRange, type JumpRequest, type WorkspaceActions } from "./workspaceActions";
import { applyUiLanguage } from "../i18n/domTranslate";
import { setBackendWords } from "../../io/backend";
import { ThemeButton, useApplyTheme } from "./theme";
import { isUiLanguage, translate } from "../i18n/i18n";
import "../tools/tools.css";

const EMPTY_SELECTION: BoardSelection = { recordIds: [], placeIds: [], linkIds: [], outlineIds: [] };
const WINDOW_SIZE = { w: 440, h: 380 };

type PickerRequest = { title: string; initialQuery?: string; allowCreate?: boolean; resolve(id: Id | null): void };

/** "Create link to an existing item": the source text, and the view to come back to. */
type LinkPick = { sourceId: Id; label: string; from: number; to: number; returnTo: View };

/** The longest quote of a target location. */
const MAX_QUOTE = 160;

export function Workspace({ zenRequest = 0 }: { zenRequest?: number }) {
  const session = useSession();
  const state = useSessionState();
  const runCommand = useRunCommand();
  useStoreRevision();
  const navigation = useNavigation(session.rootId);
  const { path, mode: viewMode } = navigation.view;
  const goTo = navigation.go;
  const setPath = useCallback((update: (current: Id[]) => Id[]) => goTo((view) => ({ ...view, path: update(view.path) })), [goTo]);
  const setViewMode = useCallback((mode: ViewMode) => goTo((view) => ({ ...view, mode })), [goTo]);
  const [tool, setTool] = useState<ToolId>("select");
  /** A double-click on a tool keeps it on after each use (for example, to make many pages). Esc or a new tool ends it. */
  const [stickyTool, setStickyTool] = useState(false);
  /** The tool bar place for the tools of an open text page. */
  const [pageToolSlot, setPageToolSlot] = useState<HTMLElement | null>(null);
  const chooseTool = useCallback((update: ToolId | ((current: ToolId) => ToolId), keep = false) => {
    setStickyTool(keep);
    setTool(update);
  }, []);
  useEffect(() => {
    if (tool === "select") setStickyTool(false);
  }, [tool]);
  const [selection, setSelection] = useState<BoardSelection>(EMPTY_SELECTION);
  const [showBoardFor, setShowBoardFor] = useState<Id | null>(null);
  /** The outline that shows as one continuous document, or null. */
  const [documentOf, setDocumentOf] = useState<Id | null>(null);
  const [windows, setWindows] = useState<EditorWindowState[]>([]);
  const [picker, setPicker] = useState<PickerRequest | null>(null);
  const [actionItemsOpen, setActionItemsOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [fieldsRequest, setFieldsRequest] = useState<(FieldsRequest & { resolve(values: Record<string, string> | null): void }) | null>(null);
  /** Web pages: the provider is inside this component, so it gives its open function by a ref. */
  const openUrlRef = useRef<(url: string, read?: boolean, find?: string) => void>(() => undefined);
  const jumpRef = useRef<(url: string) => void>(() => undefined);
  const browserRef = useRef<(url: string) => void>(() => undefined);
  const [searchOpen, setSearchOpen] = useState(false);
  /** A search for a link target (link tool: right-click or "Search…"). It resolves with the chosen hit. */
  const [targetSearch, setTargetSearch] = useState<{ resolve(result: { itemId: Id; quote?: string } | null): void } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Zen mode: only the buttons in the setting "zenButtons" show, in a small floating bar. View > Zen Mode turns it on, Esc turns it off. */
  const [zen, setZen] = useState(false);
  const lastZenRequest = useRef(zenRequest);
  useEffect(() => {
    if (zenRequest === lastZenRequest.current) return;
    lastZenRequest.current = zenRequest;
    setZen((current) => !current);
  }, [zenRequest]);
  const shown = (id: string) => !zen || state.settings.zenButtons.includes(id);
  useApplyTheme();
  const uiLanguage = state.settings.uiLanguage;
  useEffect(() => {
    applyUiLanguage(isUiLanguage(uiLanguage) ? uiLanguage : "en");
    // The menu bar too. Outside the app (tests, a browser) there is no menu: no error.
    session.translateMenu(translate).catch(() => undefined);
    setBackendWords(translate);
  }, [uiLanguage, session]);
  const [jump, setJump] = useState<JumpRequest | null>(null);
  const [focus, setFocus] = useState<{ recordId: Id; quote: string | null; nonce: number } | null>(null);
  const [linkPick, setLinkPick] = useState<LinkPick | null>(null);
  const nonce = useRef(0);
  const boardId = path.at(-1)!;
  const boardIdRef = useRef(boardId);
  boardIdRef.current = boardId;
  const boardApi = useRef<BoardApi | null>(null);

  const openRecord = useCallback(
    (recordId: Id) => {
      if (session.store.has("stamps", recordId)) return;
      // Open a board centered on its contents. A board of the path (a return) keeps its view.
      if (!path.includes(recordId)) forgetViewport(recordId);
      session.markOpened(recordId);
      setPath((current) => {
        const index = current.indexOf(recordId);
        return index === -1 ? [...current, recordId] : current.slice(0, index + 1);
      });
      setSelection(EMPTY_SELECTION);
      setTool("select");
    },
    [session, setPath, path],
  );

  /** Opens a board by its home path: root, ..., board. Used for references and links. */
  const openBoard = useCallback(
    (targetBoardId: Id) => {
      forgetViewport(targetBoardId);
      session.markOpened(targetBoardId);
      setPath(() => session.graph.homePath(session.rootId, targetBoardId));
      setSelection(EMPTY_SELECTION);
      setTool("select");
    },
    [session, setPath],
  );

  /** Goes to a different chapter of the same board (previous or next page). */
  const openSibling = useCallback(
    (itemId: Id) => {
      session.markOpened(itemId);
      setPath((current) => [...current.slice(0, -1), itemId]);
    },
    [session, setPath],
  );

  const openText = useCallback((itemId: Id) => {
    session.markOpened(itemId);
    setWindows((current) => {
      const top = Math.max(0, ...current.map((window) => window.z)) + 1;
      if (current.some((window) => window.itemId === itemId)) {
        return current.map((window) => (window.itemId === itemId ? { ...window, z: top } : window));
      }
      const offset = (current.length % 8) * 28;
      return [...current, { itemId, x: 80 + offset, y: 24 + offset, ...WINDOW_SIZE, z: top }];
    });
  }, [session]);

  /** Creates an item on the current board, to the right of the existing cards. */
  const createOnBoard = useCallback(
    (name: string): Id | null => {
      const board = boardIdRef.current;
      const children = session.graph.childrenOf(board);
      const right = children.length === 0 ? 0 : Math.max(...children.map((place) => place.x + place.w)) + 40;
      const top = children.length === 0 ? 0 : Math.min(...children.map((place) => place.y));
      const { command, itemId } = createItemOnBoard(session.context, { boardId: board, view: "note", x: right, y: top, name });
      return runCommand(command) ? itemId : null;
    },
    [session, runCommand],
  );

  /**
   * Shows an item at a text location. A note shows on its home board, centered and marked.
   * A page or a text opens in a window over its home board, with the range marked in yellow.
   */
  const openAt = useCallback(
    (itemId: Id, target: JumpRange = {}) => {
      const body = session.store.get("texts", itemId)?.body ?? "";
      // A link object (a saved web page or PDF): the reader opens it, and finds the passage. A passage of its own
      // text (its notes) shows in the text, as for other items.
      const url = session.store.get("items", itemId)?.url;
      const inPage = target.quote !== undefined ? !body.includes(target.quote) : target.from === undefined;
      if (url !== undefined && url !== "" && inPage && !session.graph.isBoardItem(itemId)) {
        openUrlRef.current(url, false, target.quote);
        return;
      }
      const range = rangeOf(body, target);
      const home = session.graph.homeOf(itemId);
      nonce.current += 1;
      if (session.graph.isBoardItem(itemId)) {
        openBoard(itemId);
        return;
      }
      if (home !== undefined) openBoard(home.from);
      if (home?.view === "note") {
        setFocus({ recordId: itemId, quote: range === null ? null : body.slice(range.from, range.to), nonce: nonce.current });
        return;
      }
      setFocus({ recordId: itemId, quote: null, nonce: nonce.current });
      openText(itemId);
      if (range !== null) setJump({ itemId, ...range, nonce: nonce.current });
    },
    [session, openBoard, openText],
  );

  const followLink = useCallback(
    (linkId: Id) => {
      const link = session.store.get("links", linkId);
      if (link?.kind !== "link") return;
      openAt(link.to, link.quote === undefined ? {} : { quote: link.quote });
    },
    [session, openAt],
  );

  /** Puts [label](link:<id>) in the source text, if the selected text is still there. */
  const wrapSource = useCallback(
    (sourceId: Id, label: string, from: number, to: number, linkId: Id) => {
      const body = session.store.get("texts", sourceId)?.body ?? "";
      const next = withTextLink(body, from, to, label, linkId);
      if (next !== null && !session.getState().readOnly) writeText(session.store, sourceId, next);
    },
    [session],
  );

  const createTextLink = useCallback<WorkspaceActions["createTextLink"]>(
    (input) => {
      if (input.mode === "existing") {
        // Pick the target on a board (or with search). Floating windows hide meanwhile.
        setLinkPick({ ...input, returnTo: navigation.view });
        goTo((view) => ({ mode: "2d", path: view.path.at(-1) === input.sourceId && view.path.length > 1 ? view.path.slice(0, -1) : view.path }));
        return;
      }
      // A new page on the board of the source, to the right of its cards.
      const board = session.graph.homeOf(input.sourceId)?.from ?? boardIdRef.current;
      const children = session.graph.childrenOf(board);
      const x = children.length === 0 ? 0 : Math.max(...children.map((place) => place.x + place.w)) + 40;
      const y = children.length === 0 ? 0 : Math.min(...children.map((place) => place.y));
      const created = createItemOnBoard(session.context, { boardId: board, view: "page", x, y, name: input.label });
      const relation = createRelation(session.context, { from: input.sourceId, to: created.itemId });
      const command: Command = { label: "Create link to new page", ops: [...created.command.ops, ...relation.command.ops] };
      if (runCommand(command)) wrapSource(input.sourceId, input.label, input.from, input.to, relation.linkId);
    },
    [session, runCommand, wrapSource, navigation.view, goTo],
  );

  /** Ends "pick the link target": makes the link and goes back to the source view. */
  const finishLinkPick = useCallback(
    (targetId: Id | null, quote?: string) => {
      const pick = linkPick;
      setLinkPick(null);
      if (pick === null) return;
      goTo(() => pick.returnTo);
      if (targetId === null || (targetId === pick.sourceId && quote === undefined)) return;
      const relation = createRelation(session.context, { from: pick.sourceId, to: targetId, quote });
      if (runCommand({ ...relation.command, label: "Create link from text" })) wrapSource(pick.sourceId, pick.label, pick.from, pick.to, relation.linkId);
    },
    [linkPick, goTo, session, runCommand, wrapSource],
  );

  useEffect(() => {
    if (linkPick === null) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && finishLinkPick(null);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [linkPick, finishLinkPick]);

  // Esc ends zen mode, when Esc has no other use: no text input has the focus, no menu or dialog is open, no tool is on.
  useEffect(() => {
    if (!zen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || isComposing(event)) return;
      if (linkPick !== null || tool !== "select" || stickyTool) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target !== null && (target.isContentEditable || target.closest("input, textarea, select, .cm-editor") !== null)) return;
      if (document.querySelector('[role="dialog"], [role="menu"], .context-menu') !== null) return;
      setZen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zen, linkPick, tool, stickyTool]);

  const actions = useMemo<WorkspaceActions>(
    () => ({
      openRecord,
      openBoard,
      openText,
      nameOf: (recordId) => titleOf(session.store, recordId),
      pickItem: (options) => new Promise((resolve) => setPicker({ ...options, resolve })),
      searchLinkTarget: () => new Promise((resolve) => setTargetSearch({ resolve })),
      searchTextLinkTarget: () => setSearchOpen(true),
      askFields: (request) => new Promise((resolve) => setFieldsRequest({ ...request, resolve })),
      openUrl: (url, read, find) => openUrlRef.current(url, read, find),
      jumpTo: (url) => jumpRef.current(url),
      openInBrowser: (url) => browserRef.current(url),
      createTextLink,
      followLink,
      openAt,
    }),
    [openRecord, openBoard, openText, session, createTextLink, followLink, openAt],
  );

  const finishPick = (result: PickResult | null) => {
    if (picker === null) return;
    setPicker(null);
    if (result === null) picker.resolve(null);
    else if (result.kind === "existing") picker.resolve(result.id);
    else picker.resolve(createOnBoard(result.name));
  };

  /** "+": put an existing item (or a new one) on the current board, at the center of the view. */
  const addItem = async () => {
    if (!canAddItem) return;
    const board = boardIdRef.current;
    const itemId = await actions.pickItem({ title: "Add an item to this board", allowCreate: true });
    if (itemId === null || itemId === board) return;
    // A new item from the picker is on the board already.
    if (session.graph.childrenOf(board).some((place) => place.to === itemId)) return;
    const center = boardApi.current?.viewCenter() ?? { x: 0, y: 0 };
    const size = DEFAULT_SIZE.note;
    runCommand(
      placeRecord(session.context, {
        boardId: board,
        recordId: itemId,
        view: "note",
        x: Math.round(center.x - size.w / 2),
        y: Math.round(center.y - size.h / 2),
        ...size,
      }).command,
    );
  };

  const openSearchHit = (hit: SearchHit, query: string) => {
    setSearchOpen(false);
    // A hit in a saved web page: the page opens, and finds the text.
    const pageUrl = hit.field === "page" ? session.store.get("items", hit.recordId)?.url : undefined;
    if (pageUrl !== undefined && linkPick === null) {
      openUrlRef.current(pageUrl, false, query);
      return;
    }
    const link = session.store.get("links", hit.recordId);
    const itemId = link?.kind === "link" ? link.to : hit.recordId;
    // Picking a link target: a text hit makes a link to that exact text.
    if (linkPick !== null) {
      const body = session.store.get("texts", itemId)?.body ?? "";
      finishLinkPick(itemId, hit.field === "body" ? uniqueQuote(body, hit.start, hit.end) : undefined);
      return;
    }
    if (!session.store.has("items", itemId)) {
      setPath((current) => [...current, ...hit.path.slice(1)]);
      return;
    }
    // A text hit opens the item at exactly that text, marked in yellow.
    openAt(itemId, hit.field === "body" && hit.recordId === itemId ? { from: hit.start, to: hit.end } : {});
  };

  useEffect(() => setShowBoardFor(null), [boardId]);
  // An item with no children shows only its text. The root always shows its board.
  const textOnly = boardId !== session.rootId && !session.graph.isBoardItem(boardId) && showBoardFor !== boardId;
  // A document view belongs to the view where it opened. A new board closes it.
  useEffect(() => setDocumentOf(null), [path]);
  /** The outline that holds the open page on its parent board, if any. */
  const pageOutline = textOnly
    ? (session.graph.childrenOf(path.at(-2) ?? "").find((place) => place.to === boardId && place.outline !== undefined)?.outline ?? null)
    : null;
  const canAddItem = !textOnly && viewMode === "2d" && !state.readOnly;

  // Shortcuts get stable functions. The ref always calls the newest version.
  const addItemRef = useRef(addItem);
  addItemRef.current = addItem;
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const addItemStable = useCallback(() => void addItemRef.current(), []);
  const collapseAllCards = useCallback(() => {
    runCommand(collapseAll(session.context, boardIdRef.current));
  }, [runCommand, session]);
  useShortcuts({ setTool: chooseTool, openSearch, addItem: addItemStable, collapseAll: collapseAllCards, back: navigation.back, forward: navigation.forward });

  // Items for plugins: the selection (or the open page), and the items of this board.
  const pluginSelection = textOnly
    ? [boardId]
    : viewMode === "2d"
      ? selection.recordIds.filter((id) => session.store.has("items", id))
      : [];
  const boardItemIds = (): Id[] => {
    if (textOnly) return [boardId];
    const ids = boardOrder(session.store, session.graph, boardId).map(({ place }) => place.to);
    return [...new Set(ids)].filter((id) => session.store.has("items", id));
  };

  return (
    <WorkspaceActionsProvider value={actions}>
     <JumpProvider value={jump}>
     <PluginsProvider>
      <SpeechProvider onShowItem={(itemId) => (textOnly && itemId === boardId ? undefined : openText(itemId))}>
      <WebPagesProvider>
      <div className={`workspace${zen ? " zen" : ""}`}>
        <div className="bars">
        {zen && (
          <button className="icon-button" data-tip="End zen mode (Esc)" data-tip-start onClick={() => setZen(false)}>
            <Minimize2 size={16} />
          </button>
        )}
        <TopBar
          shown={shown}
          navigation={navigation}
          path={path}
          onNavigate={(index) => setPath((current) => current.slice(0, index + 1))}
          onSearch={() => setSearchOpen(true)}
          onActionItems={() => setActionItemsOpen(true)}
          onTrash={() => setTrashOpen(true)}
          onZen={() => setZen(true)}
          onSettings={() => setSettingsOpen(true)}
        />
        <nav className="toolbar" aria-label="Tools">
          <ReaderToolSlot />
          <WhenNoPage>
          {/* An open text page: its tools (highlight, pen, eraser, comments, notes, link) in place of the board tools. */}
          {textOnly && documentOf === null && <span className="page-tool-slot" ref={setPageToolSlot} />}
          {!(textOnly && documentOf === null) && TOOLBAR_GROUPS.map((group, groupIndex) => (
            <span key={groupIndex} style={{ display: "contents" }}>
              {groupIndex > 0 && <span className="divider" />}
              {group.map((entry) => {
                if (!shown(typeof entry === "string" ? entry : entry.menu)) return null;
                if (typeof entry !== "string") {
                  const menu = TOOL_MENUS.find((candidate) => candidate.id === entry.menu)!;
                  return (
                    <ToolChoice
                      key={menu.id}
                      label={menu.key !== undefined && toolById(menu.key).shortcut !== undefined ? `${menu.label} (${toolById(menu.key).shortcut!.toUpperCase()})` : menu.label}
                      tools={TOOLS.filter((item) => item.menu === menu.id)}
                      active={viewMode === "2d" ? tool : "select"}
                      sticky={stickyTool}
                      disabled={textOnly || viewMode !== "2d" || state.readOnly}
                      onChoose={(id, keep) => chooseTool(id, keep)}
                    />
                  );
                }
                const item = toolById(entry);
                return (
                  <button
                    key={item.id}
                    className={`icon-button${tool === item.id && viewMode === "2d" ? " active" : ""}${tool === item.id && stickyTool ? " sticky" : ""}`}
                    data-tip={`${item.label}${item.shortcut !== undefined ? ` (${item.shortcut.toUpperCase()})` : ""}${item.oneShot === true ? " · double-click: stays on" : ""}`}
                    disabled={textOnly || viewMode !== "2d" || (state.readOnly && item.id !== "select" && item.id !== "lasso")}
                    // A click on the active tool turns it off: the select tool comes back.
                    onClick={() => chooseTool((current) => (current === item.id ? "select" : item.id))}
                    // A double-click keeps the tool on after each use, until Esc.
                    onDoubleClick={() => chooseTool(item.id, true)}
                  >
                    <item.icon size={18} strokeWidth={1.75} />
                  </button>
                );
              })}
            </span>
          ))}
          <span className="divider" />
          {shown("add") && <button
            className="icon-button"
            data-tip="Show an item here (A). An item from a different board shows as a reference."
            disabled={!canAddItem}
            onClick={() => void addItem()}
          >
            <Plus size={18} strokeWidth={1.75} />
          </button>}
          {shown("color") && !textOnly && viewMode === "2d" && <ColorManager boardId={boardId} placeIds={selection.placeIds} />}
          <span className="divider" />
          {!shown("view") ? null : textOnly ? (
            <>
              <button className="icon-button" data-tip="Show the board of this item" onClick={() => setShowBoardFor(boardId)}>
                <Columns2 size={16} />
              </button>
            </>
          ) : (
            <button
              className="view-toggle"
              data-tip={viewMode === "2d" ? "Board (2D). Click for the galaxy (3D)." : "Galaxy (3D). Click for the board (2D)."}
              onClick={() => setViewMode(viewMode === "2d" ? "3d" : "2d")}
            >
              {viewMode === "2d" ? <Square size={14} /> : <Box size={14} />}
              {viewMode === "2d" ? "2D" : "3D"}
            </button>
          )}
          {(pageOutline !== null || documentOf !== null) && (
            <button
              className={`view-toggle${documentOf !== null ? " active" : ""}`}
              data-tip={documentOf !== null ? "Close the document view" : "Show the whole outline as one document"}
              onClick={() => setDocumentOf((current) => (current === null ? pageOutline : null))}
            >
              <ScrollText size={14} />
              Document
            </button>
          )}
            <span className="divider" />
          </WhenNoPage>
          {shown("web") && <WebButton />}
          {shown("plugins") && <PluginMenu selectedIds={pluginSelection} boardItemIds={boardItemIds} scope={{ kind: textOnly ? "page" : "board", name: titleOf(session.store, boardId) }} />}
          <WhenNoPage>{shown("selection") && viewMode === "2d" && !textOnly && <ContextBar selection={selection} />}</WhenNoPage>
        </nav>
        </div>
        <main className="board-area">
          <ErrorBoundary resetKey={`${boardId}:${viewMode}:${textOnly}:${documentOf}`}>
            {documentOf !== null ? (
              <DocumentView outlineId={documentOf} focusItemId={textOnly ? boardId : null} />
            ) : textOnly ? (
              <PageToolSlotContext.Provider value={pageToolSlot}>
                <TextPage itemId={boardId} parentId={path.at(-2) ?? null} onOpenSibling={openSibling} />
              </PageToolSlotContext.Provider>
            ) : viewMode === "3d" ? (
              <GalaxyView boardId={boardId} />
            ) : (
              <BoardView
                boardId={boardId}
                apiRef={boardApi}
                tool={tool}
                sticky={stickyTool}
                onToolChange={chooseTool}
                onOpenRecord={openRecord}
                onSelectionChange={setSelection}
                focus={focus}
                onPick={linkPick === null ? undefined : (recordId) => finishLinkPick(recordId)}
                onOpenDocument={setDocumentOf}
              />
            )}
          </ErrorBoundary>
          {linkPick !== null && (
            <div className="pick-banner">
              <span>
                {`Link “${linkPick.label}”: click the item to link to, or search (⌘F) for a text in it.`}
              </span>
              <button onClick={() => finishLinkPick(null)}>Cancel</button>
            </div>
          )}
          <div style={{ display: linkPick === null ? "contents" : "none" }}>
          <EditorWindows
            windows={windows}
            onChange={(itemId, changes) =>
              setWindows((current) => current.map((window) => (window.itemId === itemId ? { ...window, ...changes } : window)))
            }
            onFocus={(itemId) =>
              setWindows((current) => {
                const top = Math.max(0, ...current.map((window) => window.z));
                const target = current.find((window) => window.itemId === itemId);
                if (target === undefined || target.z === top) return current;
                return current.map((window) => (window.itemId === itemId ? { ...window, z: top + 1 } : window));
              })
            }
            onClose={(itemId) => setWindows((current) => current.filter((window) => window.itemId !== itemId))}
          />
          </div>
          <WebReaderLayer />
          <SpeechBar />
          <SelectionTranslate />
          <Banners />
        </main>
      </div>
      {picker !== null && (
        <ItemPicker title={picker.title} initialQuery={picker.initialQuery} allowCreate={picker.allowCreate} onDone={finishPick} />
      )}
      {fieldsRequest !== null && (
        <FieldsDialog
          {...fieldsRequest}
          onDone={(values) => {
            fieldsRequest.resolve(values);
            setFieldsRequest(null);
          }}
        />
      )}
      <WebOpener openRef={openUrlRef} jumpRef={jumpRef} browserRef={browserRef} />
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {actionItemsOpen && (
        <ActionItemsDialog
          onOpen={(board, itemId) => {
            setActionItemsOpen(false);
            actions.openBoard(board, itemId);
          }}
          onClose={() => setActionItemsOpen(false)}
        />
      )}
      {trashOpen && (
        <TrashDialog
          boardId={boardId}
          onOpen={(board, itemId) => {
            setTrashOpen(false);
            actions.openBoard(board, itemId);
          }}
          onClose={() => setTrashOpen(false)}
        />
      )}
      {searchOpen && (
        <SearchDialog
          // A link target can be on any board: the search covers all boards.
          boardId={linkPick !== null ? session.rootId : boardId}
          title={linkPick !== null ? "Link to… (search all boards)" : undefined}
          onOpen={openSearchHit}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {targetSearch !== null && (
        <SearchDialog
          boardId={session.rootId}
          title="Link to… (search all boards)"
          onOpen={(hit) => {
            const link = session.store.get("links", hit.recordId);
            const itemId = link?.kind === "link" ? link.to : hit.recordId;
            if (!session.store.has("items", itemId)) return;
            const body = session.store.get("texts", itemId)?.body ?? "";
            targetSearch.resolve({ itemId, quote: hit.field === "body" ? uniqueQuote(body, hit.start, hit.end) : undefined });
            setTargetSearch(null);
          }}
          onClose={() => {
            targetSearch.resolve(null);
            setTargetSearch(null);
          }}
        />
      )}
      </WebPagesProvider>
      </SpeechProvider>
     </PluginsProvider>
     </JumpProvider>
    </WorkspaceActionsProvider>
  );
}

type TopBarProps = { shown(id: string): boolean; navigation: Navigation; path: Id[]; onNavigate(index: number): void; onSearch(): void; onActionItems(): void; onTrash(): void; onZen(): void; onSettings(): void };

function TopBar({ shown, navigation, path, onNavigate, onSearch, onActionItems, onTrash, onZen, onSettings }: TopBarProps) {
  const session = useSession();
  const state = useSessionState();
  const runCommand = useRunCommand();
  const historyState = useHistoryState();
  const [renaming, setRenaming] = useState(false);
  const currentId = path.at(-1)!;
  const status = state.readOnly
    ? { icon: Lock, tip: `Read-only. ${state.readOnlyReason ?? ""}`, className: "error" }
    : {
        saved: { icon: Check, tip: "Saved", className: "" },
        pending: { icon: Dot, tip: "Unsaved changes. They save in a moment.", className: "" },
        saving: { icon: LoaderCircle, tip: "Saving…", className: "spin" },
        error: { icon: TriangleAlert, tip: `Save failed: ${state.saveError ?? ""}`, className: "error" },
      }[state.saveStatus];
  return (
    <header className="topbar">
      {shown("back") && (
      <button className="icon-button" data-tip="Back (⌘[)" data-tip-start disabled={!navigation.canBack} onClick={navigation.back}>
        <ArrowLeft size={16} />
      </button>)}
      {shown("forward") && (
      <button className="icon-button" data-tip="Forward (⌘])" disabled={!navigation.canForward} onClick={navigation.forward}>
        <ArrowRight size={16} />
      </button>)}
      {shown("actionItems") && (
      <button className="icon-button" data-tip="Action items: all open ones" onClick={onActionItems}>
        <ListChecks size={16} />
      </button>)}
      {shown("trash") && (
      <button className="icon-button" data-tip="Trash: items deleted from all boards" onClick={onTrash}>
        <Trash2 size={16} />
      </button>)}
      {shown("undo") && (
      <button
        className="icon-button"
        data-tip={historyState.undoLabel ? `Undo ${historyState.undoLabel} (⌘Z)` : "Undo (⌘Z)"}
        disabled={!historyState.canUndo}
        onClick={() => session.history.undo()}
      >
        <Undo2 size={16} />
      </button>)}
      {shown("redo") && (
      <button
        className="icon-button"
        data-tip={historyState.redoLabel ? `Redo ${historyState.redoLabel} (⇧⌘Z)` : "Redo (⇧⌘Z)"}
        disabled={!historyState.canRedo}
        onClick={() => session.history.redo()}
      >
        <Redo2 size={16} />
      </button>)}
      {shown("save") && (
      <span className={`save-status icon-button ${status.className}`} data-tip={status.tip}>
        <status.icon size={15} />
      </span>)}
      {shown("backup") && <BackupButton />}
      {shown("theme") && <ThemeButton />}
      {/* Zen mode: only the buttons chosen in Settings show. Esc (or the button in the small bar) ends it. */}
      {shown("zenOn") && (
      <button className="icon-button" data-tip="Zen mode: hide the bars (⌃⌘Z · Esc ends it)" onClick={onZen}>
        <Maximize2 size={16} />
      </button>)}
      {shown("settings") && (
      <button className="icon-button" data-tip="Settings" onClick={onSettings}>
        <Settings size={16} />
      </button>)}
      <span className="divider" />
      {shown("path") && <div className="breadcrumb">
        {path.map((id, index) => {
          const current = index === path.length - 1;
          return (
            <span key={`${id}-${index}`} style={{ display: "contents" }}>
              {index > 0 && <span className="separator">/</span>}
              {current && renaming ? (
                <CommitField
                  className="breadcrumb-input"
                  value={session.store.get("items", id)?.name ?? ""}
                  placeholder="Untitled"
                  autoFocus
                  onCommit={(name) => runCommand(renameItem(session.context, id, name.trim()))}
                  onDone={() => setRenaming(false)}
                />
              ) : (
                <button
                  className={`${current ? "current" : ""}${session.store.get("items", id)?.codeName === true ? " code-name" : ""}`}
                  data-tip={current ? "Double-click to rename" : "Go to this board"}
                  onClick={() => onNavigate(index)}
                  onDoubleClick={() => current && !state.readOnly && session.store.has("items", currentId) && setRenaming(true)}
                >
                  {titleOf(session.store, id)}
                </button>
              )}
            </span>
          );
        })}
      </div>}
    </header>
  );
}

/** The range of a jump target in a text: the given range, or the first place of the quote. */
function rangeOf(body: string, target: JumpRange): { from: number; to: number } | null {
  if (target.from !== undefined && target.to !== undefined) return { from: target.from, to: target.to };
  if (target.quote === undefined || target.quote === "") return null;
  const from = body.indexOf(target.quote);
  return from === -1 ? null : { from, to: from + target.quote.length };
}

/** A quote that starts at `start` and is found only one time in the text (longer if necessary). */
function uniqueQuote(body: string, start: number, end: number): string {
  let to = end;
  while (to < body.length && to - start < MAX_QUOTE && body.indexOf(body.slice(start, to)) !== start) to += 1;
  return body.slice(start, to);
}
