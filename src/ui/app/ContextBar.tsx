// Controls for the current selection. They show in the tool bar, at the right.

import { OBJECT_VIEWS } from "../../core/types";
import { Combine, FileText, FolderInput, LayoutGrid, Link2, Maximize2, Minimize2, PenLine, Split, StickyNote, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  createRelation,
  joinStamps,
  moveIntoBoard,
  reduceBoard,
  setCardState,
  type CardState,
  setStampAlt,
  splitStamp,
  readStrokesOfPlacement,
  updateRelation,
} from "../../core/actions";
import { DEFAULT_END_CAP, DEFAULT_START_CAP, LINK_CAPS, type Id, type LinkCap, type ViewStyle } from "../../core/types";
import type { BoardSelection } from "../board/BoardView";
import { titleOf } from "../board/boardModel";
import { CommitField } from "./fields";
import { useRunCommand, useSession, useSessionState, useStoreRevision } from "./sessionContext";
import { useWorkspaceActions } from "./workspaceActions";


export function ContextBar({ selection }: { selection: BoardSelection }) {
  const session = useSession();
  const runCommand = useRunCommand();
  const actions = useWorkspaceActions();
  const { readOnly } = useSessionState();
  useStoreRevision();

  const count = selection.recordIds.length + selection.linkIds.length;
  if (count === 0) return null;

  /** "Move into…": select any item as the target board. The selected records move there. */
  const moveButton =
    selection.placeIds.length === 0 ? null : (
      <button
        className="icon-button"
        data-tip="Move into a board…"
        disabled={readOnly}
        onClick={async () => {
          const target = await actions.pickItem({ title: "Move into…", allowCreate: true });
          if (target !== null) runCommand(moveIntoBoard(session.context, selection.placeIds, target));
        }}
      >
        <FolderInput size={16} />
      </button>
    );

  // Buttons go at the left, after the tools. Text fields go at the right end of the tool bar.
  const layout = (buttons: ReactNode, fields: ReactNode = null) => (
    <>
      <div className="context-bar">{buttons}</div>
      <span className="spacer" />
      <div className="context-bar">{fields}</div>
    </>
  );

  if (count > 1) {
    const allScribbles =
      selection.linkIds.length === 0 &&
      selection.placeIds.length === selection.recordIds.length &&
      selection.recordIds.every((id) => session.store.has("stamps", id));
    return layout(
      <>
        {allScribbles && (
          <button
            className="icon-button"
            data-tip={`Combine ${count} scribbles into one`}
            disabled={readOnly}
            onClick={() => runCommand(joinStamps(session.context, selection.placeIds))}
          >
            <Combine size={16} />
          </button>
        )}
        {moveButton}
      </>,
    );
  }

  const linkId = selection.linkIds[0];
  if (linkId !== undefined) {
    const link = session.store.get("links", linkId);
    if (link === undefined || link.kind !== "link") return null;
    return layout(
      <>
        <CapSelect
          side="start"
          value={link.start ?? DEFAULT_START_CAP}
          disabled={readOnly}
          onChange={(start) => runCommand(updateRelation(session.context, linkId, { start }))}
        />
        <CapSelect
          side="end"
          value={link.end ?? DEFAULT_END_CAP}
          disabled={readOnly}
          onChange={(end) => runCommand(updateRelation(session.context, linkId, { end }))}
        />
      </>,
      <>
        <CommitField
          className="context-field"
          value={link.label ?? ""}
          placeholder="Label"
          disabled={readOnly}
          onCommit={(label) => runCommand(updateRelation(session.context, linkId, { label: label.trim() }))}
        />
      </>,
    );
  }

  const recordId = selection.recordIds[0]!;
  const stamp = session.store.get("stamps", recordId);
  if (stamp !== undefined) {
    const stampPlaceId = selection.placeIds[0];
    const stampPlace = stampPlaceId === undefined ? undefined : session.store.get("links", stampPlaceId);
    const strokeCount = stampPlace?.kind === "place" ? (readStrokesOfPlacement(session.context, stampPlace)?.length ?? 0) : 0;
    return layout(
      <>
        {strokeCount > 1 && stampPlaceId !== undefined && (
          <button
            className="icon-button"
            data-tip={`Split into ${strokeCount} scribbles, one for each stroke`}
            disabled={readOnly}
            onClick={() => runCommand(splitStamp(session.context, stampPlaceId).command)}
          >
            <Split size={16} />
          </button>
        )}
        {moveButton}
      </>,
      <CommitField
        className="context-field"
        value={stamp.alt}
        placeholder="Alt text (required)"
        disabled={readOnly}
        onCommit={(alt) => alt.trim() !== "" && runCommand(setStampAlt(session.context, recordId, alt.trim()))}
      />,
    );
  }

  const placeId = selection.placeIds[0];
  const place = placeId === undefined ? undefined : session.store.get("links", placeId);
  return layout(
    <>
      {/* Small objects (comment, link, action item, flashcard) and groups keep their type: no note/page/board button. */}
      {place !== undefined && place.kind === "place" && session.store.has("items", recordId) && !OBJECT_VIEWS.includes(place.view) && place.view !== "group" && (
        <StateButton placeId={place.id} itemId={recordId} view={place.view} disabled={readOnly} />
      )}
      {session.store.has("items", recordId) && (
        <button className="icon-button" data-tip="Edit text" onClick={() => actions.openText(recordId)}>
          <PenLine size={16} />
        </button>
      )}
      <button
        className="icon-button"
        data-tip="Link to any item…"
        disabled={readOnly}
        onClick={async () => {
          const target = await actions.pickItem({ title: `Link “${titleOf(session.store, recordId)}” to…`, allowCreate: true });
          if (target !== null && target !== recordId) runCommand(createRelation(session.context, { from: recordId, to: target }).command);
        }}
      >
        <Link2 size={16} />
      </button>
      {moveButton}
      <button className="icon-button" data-tip="Zoom into this item" onClick={() => actions.openRecord(recordId)}>
        <Maximize2 size={16} />
      </button>
    </>,
  );
}

const CAP_NAMES: Record<LinkCap, string> = {
  none: "None",
  arrow: "Arrow",
  "open-arrow": "Open arrow",
  circle: "Circle",
  "filled-circle": "Filled circle",
  square: "Square",
  "filled-square": "Filled square",
  diamond: "Diamond",
  "filled-diamond": "Filled diamond",
};

/** A line with the cap at one end. The start icon has the cap at the left, the end icon at the right. */
function CapIcon({ cap, side }: { cap: LinkCap; side: "start" | "end" }) {
  const filled = { fill: "currentColor", stroke: "currentColor", strokeWidth: 1 };
  const open = { fill: "none", stroke: "currentColor", strokeWidth: 1.5 };
  const shape = (() => {
    switch (cap) {
      case "none":
        return null;
      case "arrow":
        return <path d="M18,9L12,5.5L12,12.5Z" {...filled} />;
      case "open-arrow":
        return <path d="M12,5L18,9L12,13" {...open} />;
      case "circle":
      case "filled-circle":
        return <circle cx={15} cy={9} r={3} {...(cap === "circle" ? open : filled)} />;
      case "square":
      case "filled-square":
        return <rect x={12} y={6} width={6} height={6} {...(cap === "square" ? open : filled)} />;
      case "diamond":
      case "filled-diamond":
        return <path d="M18,9L15,5.5L12,9L15,12.5Z" {...(cap === "diamond" ? open : filled)} />;
    }
  })();
  const lineEnd = cap === "none" || cap === "open-arrow" ? 18 : 12;
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden style={side === "start" ? { transform: "scaleX(-1)" } : undefined}>
      <line x1={1} y1={9} x2={lineEnd} y2={9} stroke="currentColor" strokeWidth={1.5} />
      {shape}
    </svg>
  );
}

/** The shape at one end of a link. A tool bar button that opens a grid of icons. */
function CapSelect({ side, value, disabled, onChange }: { side: "start" | "end"; value: LinkCap; disabled: boolean; onChange(cap: LinkCap): void }) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !host.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  const label = side === "start" ? "Line start" : "Line end";
  return (
    <div className="cap-select" ref={host}>
      <button className={`icon-button${open ? " active" : ""}`} data-tip={`${label}: ${CAP_NAMES[value]}`} disabled={disabled} onClick={() => setOpen((current) => !current)}>
        <CapIcon cap={value} side={side} />
      </button>
      {open && (
        <div className="cap-menu" role="menu" aria-label={label}>
          {LINK_CAPS.map((cap) => (
            <button
              key={cap}
              role="menuitem"
              className={`icon-button${cap === value ? " active" : ""}`}
              data-tip={CAP_NAMES[cap]}
              onClick={() => {
                setOpen(false);
                if (cap !== value) onChange(cap);
              }}
            >
              <CapIcon cap={cap} side={side} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const STATE_ICONS: Record<CardState | "stub", { icon: LucideIcon; label: string }> = {
  note: { icon: StickyNote, label: "Note" },
  page: { icon: FileText, label: "Page" },
  board: { icon: LayoutGrid, label: "Board" },
  stub: { icon: Minimize2, label: "Stub: move the one item out and make this a normal item" },
};
const STATE_CYCLE: CardState[] = ["note", "page", "board"];

/**
 * One button for the state of a card.
 * - Not a board, or an empty board: note -> page -> board -> note.
 * - A board with one item: board <-> stub. "Stub" moves the item out and makes this a normal item.
 * - A board with more items: it stays a board. The button only shows the state.
 */
function StateButton({ placeId, itemId, view, disabled }: { placeId: Id; itemId: Id; view: ViewStyle; disabled: boolean }) {
  const session = useSession();
  const runCommand = useRunCommand();
  const children = session.graph.childrenOf(itemId).length;
  const current: CardState = session.graph.isBoardItem(itemId) ? "board" : view === "page" ? "page" : "note";

  if (children >= 2) {
    const { icon: Icon } = STATE_ICONS.board;
    return (
      <button className="icon-button active" data-tip={`Board with ${children} items. It stays a board.`} disabled>
        <Icon size={16} />
      </button>
    );
  }
  if (children === 1) {
    const { icon: Icon } = STATE_ICONS.board;
    return (
      <button className="icon-button active" data-tip={`Board · click: ${STATE_ICONS.stub.label}`} disabled={disabled} onClick={() => runCommand(reduceBoard(session.context, placeId))}>
        <Icon size={16} />
      </button>
    );
  }
  const next = STATE_CYCLE[(STATE_CYCLE.indexOf(current) + 1) % STATE_CYCLE.length]!;
  const { icon: Icon, label } = STATE_ICONS[current];
  return (
    <button className="icon-button active" data-tip={`${label} · click: ${STATE_ICONS[next].label}`} disabled={disabled} onClick={() => runCommand(setCardState(session.context, placeId, next))}>
      <Icon size={16} />
    </button>
  );
}
