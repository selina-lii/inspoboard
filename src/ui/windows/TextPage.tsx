// Full-page text view for an item with no children, like Typora. See docs/SPEC.md section 7.1.

import { createPortal } from "react-dom";
import { usePageToolSlot } from "../app/pageToolSlot";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Link2 } from "lucide-react";
import { linksOf, type LinkEnd } from "../app/textLinks";
import { useWorkspaceActions } from "../app/workspaceActions";
import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { PAGE_WIDTH_RANGE } from "../../io/settings";
import { renameItem } from "../../core/actions";
import { neighbors } from "../../core/outline";
import type { Id } from "../../core/types";
import { CommitField } from "../app/fields";
import { useRunCommand, useSession, useSessionState, useStoreRevision } from "../app/sessionContext";
import type { TextEditorApi } from "../editor/TextEditor";
import { useHiddenOverlay, useOverlay } from "../plugins/pluginsContext";
import { HiddenTransformChip, TransformedChip } from "../plugins/TransformedText";
import { ItemBody } from "./ItemBody";
import { CommentButtons, CommentColumn, useCommentColumn } from "./CommentColumn";
import { MarksProvider, MarkTools, PageScribbleLayer } from "./marks";
import { DuplicateWarning } from "./DuplicateWarning";
import { ItemInfo } from "./ItemInfo";
import "./windows.css";

type Props = {
  itemId: Id;
  /** The board that the user came from. Its chapter order gives the previous and next page. */
  parentId: Id | null;
  onOpenSibling(itemId: Id): void;
};

export function TextPage({ itemId, parentId, onOpenSibling }: Props) {
  const session = useSession();
  const { readOnly, settings } = useSessionState();
  const runCommand = useRunCommand();
  useStoreRevision();
  const editor = useRef<TextEditorApi | null>(null);
  const overlay = useOverlay(itemId);
  const hiddenOverlay = useHiddenOverlay(itemId);
  const item = session.store.get("items", itemId);
  const comments = useCommentColumn(itemId);
  const toolSlot = usePageToolSlot();
  // The scribbles use the whole width of the page. Their points start at the text area of the editor.
  const [pageElement, setPageElement] = useState<HTMLDivElement | null>(null);
  const textArea = useCallback(() => editor.current?.view()?.scrollDOM ?? null, []);
  // The width of the text: the setting, or the width during a drag of an edge.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const pageWidth = dragWidth ?? settings.pageWidth;
  /** A drag on an edge of the text. The text is centered: it grows at both sides, so the width changes two times the drag. */
  const onResize = (side: -1 | 1) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const start = handle.parentElement?.getBoundingClientRect().width ?? pageWidth;
    const widthAt = (clientX: number) => Math.round(Math.min(PAGE_WIDTH_RANGE.max, Math.max(PAGE_WIDTH_RANGE.min, start + 2 * side * (clientX - startX))));
    const move = (next: PointerEvent) => setDragWidth(widthAt(next.clientX));
    const up = (next: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      const width = widthAt(next.clientX);
      void session.updateSettings({ pageWidth: width }).finally(() => setDragWidth(null));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  if (item === undefined) {
    return <div className="text-page muted">This item does not exist. It is a ghost: its links stay in the graph.</div>;
  }
  // Side by side: the text stays (and can be edited) at the left.
  const side = overlay !== undefined && settings.transformLayout === "side";
  const tools = (
    <span className="page-tools">
      {(overlay === undefined || side) && <MarkTools onHighlightSelection={() => editor.current?.highlightSelection() ?? false} />}
      <span className="divider" />
      <CommentButtons itemId={itemId} column={comments} />
      <button className="icon-button" data-tip="Link selected text (⌘K)" data-tip-end disabled={readOnly || (overlay !== undefined && !side)} onClick={() => editor.current?.linkSelection()}>
        <Link2 size={16} />
      </button>
    </span>
  );
  return (
    <MarksProvider itemId={itemId} pageLayer={!side}>
    <div ref={setPageElement} className={`text-page${side ? " wide" : ""}${comments.shown ? " with-comments" : ""}`} style={{ "--page-width": `${pageWidth}px` } as CSSProperties}>
      {!side && pageElement !== null && <PageScribbleLayer page={pageElement} textArea={textArea} />}
      <div className="text-page-head">
        <PageNavigation itemId={itemId} parentId={parentId} onOpenSibling={onOpenSibling} />
        {settings.showItemTitle && overlay !== undefined && !side ? (
          <span className="text-page-title" dir="auto">{overlay.title ?? item.name}</span>
        ) : settings.showItemTitle ? (
          <CommitField
          className={`text-page-title${item.codeName === true ? " code-name" : ""}`}
          wrap
          value={item.name}
          placeholder="Untitled"
          disabled={readOnly}
          onCommit={(name) => runCommand(renameItem(session.context, itemId, name.trim()))}
          />
        ) : (
          <span className="text-page-title" />
        )}
        {overlay !== undefined && <TransformedChip itemId={itemId} overlay={overlay} />}
        {hiddenOverlay !== undefined && <HiddenTransformChip itemId={itemId} overlay={hiddenOverlay} />}
        {/* The tools of the page are in the main tool bar: the title has the width of the head. */}
        {toolSlot === null ? tools : createPortal(tools, toolSlot)}
      </div>
      <DuplicateWarning itemId={itemId} />
      {settings.showItemDates && (
        <div className="text-page-info">
          <ItemInfo itemId={itemId} />
        </div>
      )}
      <div className="text-page-body">
        {!side && (
          <>
            <div className="page-resize left" data-tip="Drag to change the page width" data-tip-start onPointerDown={onResize(-1)} onDoubleClick={() => void session.updateSettings({ pageWidth: 760 })} />
            <div className="page-resize right" data-tip="Drag to change the page width" data-tip-end onPointerDown={onResize(1)} onDoubleClick={() => void session.updateSettings({ pageWidth: 760 })} />
          </>
        )}
        <ItemBody itemId={itemId} readOnly={readOnly} editorRef={editor} />
        <PageLinks itemId={itemId} />
        {/* The comments sit right at the edge of the text, and scroll with it. */}
        {comments.shown && <CommentColumn itemId={itemId} />}
      </div>
    </div>
    </MarksProvider>
  );
}

/**
 * The links of the page, under its text: the items it links to (a click follows the link, to its passage) and
 * the items that link to it (a click opens that item at the linked words).
 */
function PageLinks({ itemId }: { itemId: Id }) {
  const session = useSession();
  const actions = useWorkspaceActions();
  useStoreRevision();
  const { outgoing, incoming } = linksOf(session.store, session.graph, session.rootId, itemId);
  if (outgoing.length === 0 && incoming.length === 0) return null;
  const row = (end: LinkEnd, direction: "out" | "in") => (
    <button
      key={end.key}
      className="page-link"
      onClick={() => {
        if (direction === "out" && end.linkId !== null) actions.followLink(end.linkId);
        else actions.openAt(end.itemId, end.excerpt !== "" && direction === "in" ? { quote: end.excerpt } : {});
      }}
    >
      {direction === "out" ? <ArrowRight size={13} /> : <ArrowLeft size={13} />}
      <span className="page-link-title" dir="auto" translate="no">
        {end.title}
      </span>
      {(end.excerpt !== "" || end.path !== "") && (
        <span className="page-link-meta" dir="auto" translate="no">
          {end.excerpt !== "" ? `“${end.excerpt.length > 120 ? `${end.excerpt.slice(0, 120)}…` : end.excerpt}”` : ""}
          {end.excerpt !== "" && end.path !== "" ? " · " : ""}
          {end.path}
        </span>
      )}
    </button>
  );
  return (
    <div className="page-links">
      {outgoing.length > 0 && (
        <div className="page-links-group">
          <span className="page-links-head">Links to</span>
          {outgoing.map((end) => row(end, "out"))}
        </div>
      )}
      {incoming.length > 0 && (
        <div className="page-links-group">
          <span className="page-links-head">Linked from</span>
          {incoming.map((end) => row(end, "in"))}
        </div>
      )}
    </div>
  );
}

/** Previous and next chapter, for a page on a board with bullets or numbers. */
function PageNavigation({ itemId, parentId, onOpenSibling }: Props) {
  const session = useSession();
  if (parentId === null) return null;
  const { previous, next } = neighbors(session.store, session.graph, parentId, itemId);
  if (previous === null && next === null) return null;
  const nameOf = (id: Id) => session.store.get("items", id)?.name ?? "";
  return (
    <span className="page-navigation">
      <button className="icon-button" data-tip={previous === null ? "First page" : `Previous: ${nameOf(previous)}`} data-tip-start disabled={previous === null} onClick={() => previous !== null && onOpenSibling(previous)}>
        <ChevronLeft size={18} />
      </button>
      <button className="icon-button" data-tip={next === null ? "Last page" : `Next: ${nameOf(next)}`} disabled={next === null} onClick={() => next !== null && onOpenSibling(next)}>
        <ChevronRight size={18} />
      </button>
    </span>
  );
}
