// Links in a saved web page or PDF, as on a text page. See docs/SPEC.md section 7.11.
// - The link object of the page (the copy is its own, SPEC 1.1): its links count for the page.
// - The text that a small item in the page points to is gray too (no shadow: the item has its own curve).
// - A linked passage of the page (`fromQuote` of a link from it, `quote` of a link to it) is gray, and a shadow of
//   the other item is in a margin with an arrow to the passage. A click on the shadow (or ⌘-click on the passage)
//   goes to the other end at its passage.
// - The Links button in the reader tools lists the links: "Links to" and "Linked from", as on a page.

import { Link2 } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { insideEntries } from "../../core/inside";
import { linkedPassagesOf, type LinkedPassage } from "../../core/linkEnds";
import { LinkShadow } from "../app/linkShadow";
import type { Id } from "../../core/types";
import { useSession, useStoreRevision } from "../app/sessionContext";
import { linksOf, type LinkEnd } from "../app/textLinks";
import { useWorkspaceActions } from "../app/workspaceActions";
import type { Box, Mark } from "./readerShared";
import { findQuote } from "./savedPages";
import { useDismiss } from "../app/useDismiss";

/** A linked passage of the page: the link, its place in the page text, and how to go to the other end. */
type PlacedPassage = { key: string; passage: LinkedPassage; start: number; end: number; go(): void };

/**
 * The linked passages of a page (SPEC 7.11): gray marks, their boxes (for the shadows), and a function for a ⌘-click
 * at a text offset. `itemId`: the link object of the open copy (SPEC 1.1: its passages are places in its own copy).
 */
export function useLinkMarks(itemId: Id, text: string, boxes: (start: number, end: number) => Box[], layoutKey: unknown) {
  const session = useSession();
  const actions = useWorkspaceActions();
  const revision = useStoreRevision();
  const passages = useMemo<PlacedPassage[]>(() => {
    if (text === "" || !session.store.has("items", itemId)) return [];
    return linkedPassagesOf(session.store, session.graph, itemId).flatMap((passage) => {
      const at = findQuote(text, passage.quote);
      if (at === null) return [];
      const go = () => actions.openAt(passage.otherId, passage.otherQuote !== null ? { quote: passage.otherQuote } : {});
      return [{ key: `${passage.outgoing ? "from" : "to"}:${passage.linkId}`, passage, ...at, go }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, itemId, text, revision, actions]);
  const placed = useMemo(
    () => passages.map((passage) => ({ ...passage, boxes: boxes(passage.start, passage.end) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [passages, boxes, layoutKey],
  );
  // The text that a small item points to (SPEC 1.1) has the same faint gray, with no link to follow.
  const pointed = useMemo(() => {
    if (text === "" || !session.store.has("items", itemId)) return [];
    return insideEntries(session.store, session.graph, itemId).flatMap((entry) => {
      const at = entry.quote === null ? null : findQuote(text, entry.quote, entry.quoteAt ?? 0);
      return at === null ? [] : [{ key: `point:${entry.item.id}`, ...at }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, itemId, text, revision]);
  const marks = useMemo<Mark[]>(
    () => [
      ...placed.map((passage) => ({ id: passage.key, color: "link" as const, boxes: passage.boxes })),
      ...pointed.map((range) => ({ id: range.key, color: "link" as const, boxes: boxes(range.start, range.end) })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [placed, pointed, boxes, layoutKey],
  );
  /** Goes along the link of the passage at this offset. False if no linked passage is there. */
  const follow = (offset: number): boolean => {
    const hit = passages.find((passage) => offset >= passage.start && offset < passage.end);
    hit?.go();
    return hit !== undefined;
  };
  return { marks, follow, placed };
}

/** The gap between the page and the shadows, the width of a shadow, and the space between two (page units). */
const SHADOW = { gap: 28, width: 240, space: 6 };

/**
 * The shadows of the linked items (SPEC 7.11), in a margin of the canvas (page units, x from the left of the canvas),
 * level with their passage, with a curve to it. `side`: "right" (the right margin) or "left" (while the translation
 * column takes the right side).
 */
export function ReaderLinkShadows({ placed, margin, pageWidth, side }: { placed: ReturnType<typeof useLinkMarks>["placed"]; margin: number; pageWidth: number; side: "left" | "right" }) {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const [tops, setTops] = useState<number[]>([]);
  const rows = placed
    .filter((passage) => passage.boxes.length > 0)
    .map((passage) => ({ passage, top: Math.min(...passage.boxes.map((box) => box.top)), last: passage.boxes[passage.boxes.length - 1]! }))
    .sort((a, b) => a.top - b.top);
  const width = Math.max(120, Math.min(SHADOW.width, margin - 2 * SHADOW.gap));
  const left = side === "right" ? margin + pageWidth + SHADOW.gap : margin - SHADOW.gap - width;
  const key = rows.map((row) => `${row.passage.key}:${Math.round(row.top)}`).join("|");
  useLayoutEffect(() => {
    let bottom = -Infinity;
    const next = rows.map((row, index) => {
      const top = Math.max(row.top, bottom + SHADOW.space);
      bottom = top + (refs.current[index]?.offsetHeight ?? 0);
      return top;
    });
    setTops((before) => (before.length === next.length && before.every((value, index) => Math.abs(value - next[index]!) < 0.5) ? before : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, width]);
  if (margin < 100 || rows.length === 0) return null;
  return (
    <>
      <svg className="reader-link-curves" aria-hidden="true">
        <defs>
          <marker id="link-shadow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" />
          </marker>
        </defs>
        {rows.map((row, index) => {
          const top = tops[index] ?? row.top;
          // From the side of the shadow that faces the page to the end (right) or start (left) of the passage.
          const sx = side === "right" ? left : left + width;
          const sy = top + 12;
          const target = side === "right" ? row.last : row.passage.boxes[0]!;
          const tx = margin + (side === "right" ? target.left + target.width : target.left);
          const ty = target.top + target.height / 2;
          const bend = Math.max(30, Math.abs(sx - tx) / 2) * (sx > tx ? -1 : 1);
          return <path key={row.passage.key} d={`M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`} markerEnd="url(#link-shadow-arrow)" />;
        })}
      </svg>
      {rows.map((row, index) => (
        <div key={row.passage.key} ref={(element) => void (refs.current[index] = element)} className="reader-link-shadow" style={{ left, top: tops[index] ?? row.top, width }}>
          <LinkShadow passage={row.passage.passage} />
        </div>
      ))}
    </>
  );
}

/** The Links button of the reader tools: the links of the page, both ways. */
export function ReaderLinks({ itemId }: { itemId: Id }) {
  const session = useSession();
  const actions = useWorkspaceActions();
  useStoreRevision();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useDismiss(open, box, () => setOpen(false));
  const ids = session.store.has("items", itemId) ? [itemId] : [];
  const outgoing: LinkEnd[] = [];
  const incoming: LinkEnd[] = [];
  for (const id of ids) {
    const links = linksOf(session.store, session.graph, session.rootId, id);
    outgoing.push(...links.outgoing);
    incoming.push(...links.incoming);
  }
  const count = outgoing.length + incoming.length;
  if (ids.length === 0) return null;
  const row = (end: LinkEnd, incomingEnd: boolean) => (
    <button
      key={end.key}
      className="reader-links-row"
      onClick={() => {
        setOpen(false);
        if (!incomingEnd && end.linkId !== null) actions.followLink(end.linkId);
        else actions.openAt(end.itemId, end.excerpt !== "" ? { quote: end.excerpt } : {});
      }}
    >
      <span className="reader-links-title" translate="no" dir="auto">
        {incomingEnd ? "← " : "→ "}
        {end.title}
      </span>
      {end.excerpt !== "" && (
        <span className="reader-links-excerpt" translate="no" dir="auto">
          {end.excerpt.length > 120 ? `${end.excerpt.slice(0, 120)}…` : end.excerpt}
        </span>
      )}
    </button>
  );
  return (
    <span className="reader-links" ref={box}>
      <button className={`icon-button${open ? " active" : ""}`} data-tip={count === 0 ? "Links: none yet" : `Links (${count})`} onClick={() => setOpen((current) => !current)}>
        <Link2 size={16} />
        {count > 0 && <span className="reader-links-count">{count}</span>}
      </button>
      {open && (
        <div className="reader-links-menu" role="menu">
          {count === 0 && <div className="reader-links-empty">No links yet. Use the link bench to link a passage of this page.</div>}
          {outgoing.length > 0 && <div className="reader-links-head">Links to</div>}
          {outgoing.map((end) => row(end, false))}
          {incoming.length > 0 && <div className="reader-links-head">Linked from</div>}
          {incoming.map((end) => row(end, true))}
          <div className="reader-links-hint">⌘-click a passage with a dotted line: go to its link.</div>
        </div>
      )}
    </span>
  );
}

