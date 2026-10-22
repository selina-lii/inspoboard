// Small items on the reader canvas (vault items inside the link object, SPEC 1.1): the item view and the faint
// dashed curves to the text that they point to.

import { INK, type Box, type ReaderMode } from "./readerBasics";
import { Globe } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDismiss } from "../app/useDismiss";
import { useRunCommand, useSession } from "../app/sessionContext";
import { renameItem, writeText } from "../../core/actions";
import { shortTime, smallColorStyle, SmallFace, SmallHead } from "../app/smallFace";
import { colorInside, resizeInside, type InsideEntry } from "../../core/inside";
import { useSizeGrip } from "../app/sizeGrip";
import type { Id } from "../../core/types";
import { type NoteColor } from "./savedPages";

/** Note backgrounds of older versions. A small item now shows its color as a stripe (as in a page): such a color shows as its ink. */
const PAPER: Record<NoteColor, string> = { yellow: "#fff3b0", green: "#d4f5dc", pink: "#ffd9e2", blue: "#d6e9ff" };
const stripeOf = (color: string): string => INK[(Object.keys(PAPER) as NoteColor[]).find((name) => PAPER[name] === color) ?? ("" as NoteColor)] ?? color;

/** The default width of a small item on the canvas (page units). */
export const insideWidth = (entry: InsideEntry) => entry.w ?? (entry.view === "comment" ? 200 : 170);

/** Faint dashed curves (page units) from small items to the text that they point to. */
export function InsideCurves({ entries, margin, anchorBox }: { entries: InsideEntry[]; margin: number; anchorBox?: (quote: string, at: number | null) => Box | null }) {
  const [hot, setHot] = useState<Id | null>(null);
  useEffect(() => {
    const onOver = (event: PointerEvent) => setHot((event.target as Element).closest?.(".reader-item[data-item-id]")?.getAttribute("data-item-id") ?? null);
    window.addEventListener("pointerover", onOver);
    return () => window.removeEventListener("pointerover", onOver);
  }, []);
  if (anchorBox === undefined) return null;
  const curves = entries.flatMap((entry) => {
    if (entry.quote === null || entry.at === null) return [];
    const box = anchorBox(entry.quote, entry.quoteAt);
    if (box === null) return [];
    const tx = margin + box.left + box.width;
    const ty = box.top + box.height / 2;
    const left = margin + entry.at[0];
    const right = left + insideWidth(entry);
    const sx = Math.abs(left - tx) < Math.abs(right - tx) ? left : right;
    const sy = entry.at[1] + 14;
    const bend = Math.max(30, Math.abs(sx - tx) / 2) * (sx > tx ? -1 : 1);
    return [{ id: entry.item.id, d: `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`, end: [tx, ty] as const }];
  });
  if (curves.length === 0) return null;
  return (
    <svg className="anchor-curves reader-curves" aria-hidden="true">
      {curves.map((curve) => (
        <g key={curve.id} className={curve.id === hot ? "hot" : undefined}>
          <path d={curve.d} />
          <circle cx={curve.end[0]} cy={curve.end[1]} r={2.5} />
        </g>
      ))}
    </svg>
  );
}

type InsideItemProps = {
  entry: InsideEntry;
  margin: number;
  zoom: number;
  mode: ReaderMode;
  readOnly: boolean;
  editing: boolean;
  onEdit(on: boolean): void;
  onMove(x: number, y: number): void;
  onRemove(): void;
  /** Ends the pointing to text (only for an item that points to text). */
  onUnpoint?: () => void;
  /** An action item: "Done" removes it. */
  onDone?: () => void;
  /** A web link: opens its address. */
  onOpenUrl?: (url: string) => void;
  onTyping?(): void;
};

/**
 * A small item on the canvas (a vault item inside the link object). Drag its head to move it. Its text saves while it
 * is typed. An item stays also when it is empty (only Delete or the eraser removes it). Each kind has its icon and
 * its buttons: an action item has "Done", a web link opens its address.
 */
export function InsideItemView({ entry, margin, zoom, mode, readOnly, editing, onEdit, onMove, onRemove, onUnpoint, onDone, onOpenUrl, onTyping }: InsideItemProps) {
  const session = useSession();
  const runCommand = useRunCommand();
  const { live, grip } = useSizeGrip({ scale: zoom, onEnd: ({ w, h }) => runCommand(resizeInside(session.context, entry, w, h)) });
  const height = live?.h ?? entry.h ?? null;
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const body = session.store.get("texts", entry.item.id)?.body ?? "";
  const finish = () => onEdit(false);
  useDismiss(editing, frame, finish, { capture: true, blur: true });
  useEffect(() => {
    if (editing) area.current?.focus();
  }, [editing]);
  const at = entry.at ?? [0, 0];
  const comment = entry.view === "comment";
  const write = (text: string) => {
    onTyping?.();
    if (session.store.has("items", entry.item.id)) writeText(session.store, entry.item.id, text);
  };
  return (
    <div
      ref={frame}
      data-item-id={entry.item.id}
      className={`reader-item small-item ${comment ? "comment" : entry.view === "note" ? "note" : "small"} kind-${entry.view}${entry.color !== null ? " custom-color" : ""}${height !== null ? " sized" : ""}`}
      style={{ left: margin + at[0] + (offset?.x ?? 0), top: at[1] + (offset?.y ?? 0), width: live?.w ?? insideWidth(entry), ...(height !== null ? { height } : {}), ...smallColorStyle(entry.color, entry.color === null ? null : stripeOf(entry.color)) }}
      onPointerDown={(event) => {
        if (mode === "erase" && !readOnly) {
          event.stopPropagation();
          onRemove();
        }
      }}
    >
      <div
        className="reader-item-head"
        onPointerDown={(event) => {
          if (readOnly || mode === "erase" || event.button !== 0 || (event.target as Element).closest("button") !== null) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY };
          setOffset({ x: 0, y: 0 });
        }}
        onPointerMove={(event) => {
          if (drag.current === null) return;
          setOffset({ x: (event.clientX - drag.current.x) / zoom, y: (event.clientY - drag.current.y) / zoom });
        }}
        onPointerUp={() => {
          if (drag.current !== null && offset !== null && (offset.x !== 0 || offset.y !== 0)) onMove(at[0] + offset.x, at[1] + offset.y);
          drag.current = null;
          setOffset(null);
        }}
      >
        <SmallHead
          view={entry.view}
          item={entry.item}
          readOnly={readOnly}
          onDelete={onRemove}
          onDone={onDone}
          onUnpoint={onUnpoint}
          color={entry.color}
          onColor={(color) => runCommand(colorInside(session.context, entry, color))}
          label={
            comment ? (
              <>
                <span className="comment-author">{entry.item.author ?? "Comment"}</span>
                <span className="comment-time">{shortTime(entry.item.created)}</span>
              </>
            ) : undefined
          }
        >
          {entry.view === "weblink" && entry.item.url !== undefined && entry.item.url !== "" && (
            <button className="icon-button small" data-tip={entry.item.url} onClick={() => onOpenUrl?.(entry.item.url!)}>
              <Globe size={12} />
            </button>
          )}
        </SmallHead>
      </div>
      {comment ? (
        editing ? (
          <textarea
            ref={area}
            className="reader-item-input"
            defaultValue={body}
            placeholder="Write a comment…"
            onChange={(event) => write(event.target.value)}
            onBlur={finish}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") finish();
            }}
          />
        ) : (
          <div className="reader-item-text" dir="auto" onDoubleClick={() => !readOnly && onEdit(true)}>
            {body !== "" ? body : <span className="untitled">Double-click to write</span>}
          </div>
        )
      ) : (
        <SmallFace
          view={entry.view}
          item={entry.item}
          body={body}
          editing={editing}
          readOnly={readOnly}
          onEdit={onEdit}
          onWrite={write}
          onRename={(name) => runCommand(renameItem(session.context, entry.item.id, name, { allowEmpty: true }))}
          textClass="reader-item-text"
          inputClass="reader-item-input"
        />
      )}
      {!readOnly && mode !== "erase" && grip}
    </div>
  );
}
