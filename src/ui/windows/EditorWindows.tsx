// Floating editor windows. See docs/SPEC.md section 7.5.
// Each open item has one window above the board. Each window has its own undo stack.
// Window positions are view state. They are not saved.

import { Link2, LocateFixed, Maximize2, X } from "lucide-react";
import { useRef, type PointerEvent } from "react";
import { renameItem } from "../../core/actions";
import type { Id } from "../../core/types";
import { CommitField } from "../app/fields";
import { useRunCommand, useSession, useSessionState, useStoreRevision } from "../app/sessionContext";
import { useWorkspaceActions } from "../app/workspaceActions";
import type { TextEditorApi } from "../editor/TextEditor";
import { useHiddenOverlay, useOverlay } from "../plugins/pluginsContext";
import { HiddenTransformChip, TransformedChip } from "../plugins/TransformedText";
import { ItemBody } from "./ItemBody";
import { MarksProvider, MarkTools } from "./marks";
import { DuplicateWarning } from "./DuplicateWarning";
import { FrozenBar } from "../plugins/tray/FrozenBar";
import { ItemInfo } from "./ItemInfo";
import "./windows.css";

export type EditorWindowState = { itemId: Id; x: number; y: number; w: number; h: number; z: number };

type Props = {
  windows: EditorWindowState[];
  onChange(itemId: Id, changes: Partial<EditorWindowState>): void;
  onFocus(itemId: Id): void;
  onClose(itemId: Id): void;
};

export function EditorWindows({ windows, onChange, onFocus, onClose }: Props) {
  return (
    <>
      {windows.map((window) => (
        <EditorWindow
          key={window.itemId}
          state={window}
          onChange={(changes) => onChange(window.itemId, changes)}
          onFocus={() => onFocus(window.itemId)}
          onClose={() => onClose(window.itemId)}
        />
      ))}
    </>
  );
}

type WindowProps = {
  state: EditorWindowState;
  onChange(changes: Partial<EditorWindowState>): void;
  onFocus(): void;
  onClose(): void;
};

function EditorWindow({ state, onChange, onFocus, onClose }: WindowProps) {
  const session = useSession();
  const { readOnly, settings } = useSessionState();
  const showItemDates = settings.showItemDates;
  const runCommand = useRunCommand();
  const actions = useWorkspaceActions();
  useStoreRevision();
  const editor = useRef<TextEditorApi | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const overlay = useOverlay(state.itemId);
  const hiddenOverlay = useHiddenOverlay(state.itemId);
  const item = session.store.get("items", state.itemId);
  const side = overlay !== undefined && settings.transformLayout === "side";

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("input, button") !== null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { dx: event.clientX - state.x, dy: event.clientY - state.y };
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current === null) return;
    onChange({ x: Math.max(0, event.clientX - drag.current.dx), y: Math.max(0, event.clientY - drag.current.dy) });
  };
  const endDrag = () => {
    drag.current = null;
  };
  // The CSS "resize" handle changes the element size. Keep the state in step.
  const syncSize = () => {
    const element = frame.current;
    if (element !== null && (element.offsetWidth !== state.w || element.offsetHeight !== state.h)) {
      onChange({ w: element.offsetWidth, h: element.offsetHeight });
    }
  };

  return (
    <MarksProvider itemId={state.itemId}>
    <div
      ref={frame}
      className="editor-window"
      data-window-item={state.itemId}
      style={{ left: state.x, top: state.y, width: state.w, height: state.h, zIndex: 20 + state.z }}
      onPointerDownCapture={onFocus}
      onPointerUp={syncSize}
    >
      <div
        className="editor-window-bar"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        // A double-click on the bar (not on the title or a button): the item opens as its full page, in place of the window.
        onDoubleClick={(event) => {
          if (event.target instanceof Element && event.target.closest("input, textarea, button") !== null) return;
          onClose();
          actions.openRecord(state.itemId);
        }}
      >
        {!settings.showItemTitle ? (
          <span className="editor-window-title" />
        ) : item !== undefined && overlay !== undefined && !side ? (
          <span className="editor-window-title" dir="auto">{overlay.title ?? item.name}</span>
        ) : item !== undefined ? (
          <CommitField
            className={`editor-window-title${item.codeName === true ? " code-name" : ""}`}
            value={item.name}
            placeholder="Untitled"
            disabled={readOnly}
            onCommit={(name) => runCommand(renameItem(session.context, state.itemId, name.trim()))}
          />
        ) : (
          <span className="editor-window-title muted">Missing item</span>
        )}
        {overlay !== undefined && <TransformedChip itemId={state.itemId} overlay={overlay} />}
        {hiddenOverlay !== undefined && <HiddenTransformChip itemId={state.itemId} overlay={hiddenOverlay} />}
        {(overlay === undefined || side) && <MarkTools compact onHighlightSelection={() => editor.current?.highlightSelection() ?? false} />}
        <button className="icon-button small" data-tip="Link selected text (⌘K)" disabled={readOnly || (overlay !== undefined && !side)} onClick={() => editor.current?.linkSelection()}>
          <Link2 size={14} />
        </button>
        <button
          className="icon-button small"
          data-tip="Show file location"
          disabled={session.graph.homeOf(state.itemId) === undefined}
          onClick={() => {
            onClose();
            actions.showLocation(state.itemId);
          }}
        >
          <LocateFixed size={14} />
        </button>
        {/* The full page takes the place of the window (as a double-click on the bar). */}
        <button
          className="icon-button small"
          data-tip="Zoom into this item"
          onClick={() => {
            onClose();
            actions.openRecord(state.itemId);
          }}
        >
          <Maximize2 size={14} />
        </button>
        <button className="icon-button small" data-tip="Close" data-tip-end onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      {item !== undefined && <DuplicateWarning itemId={state.itemId} />}
      {item !== undefined && <FrozenBar itemId={state.itemId} />}
      {showItemDates && item !== undefined && <ItemInfo itemId={state.itemId} />}
      <div className="editor-window-body">
        {item !== undefined && <ItemBody itemId={state.itemId} readOnly={readOnly} editorRef={editor} autoFocus />}
      </div>
    </div>
    </MarksProvider>
  );
}
