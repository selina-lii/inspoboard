// Links in a saved web page or PDF, as on a text page. See docs/SPEC.md section 7.11.
// - The link object of the page (the copy is its own, SPEC 1.1): its links count for the page.
// - A linked passage of the page (`fromQuote` of a link from it, `quote` of a link to it) has a dotted mark.
//   ⌘-click on the passage goes to the other end.
// - The Links button in the reader tools lists the links: "Links to" and "Linked from", as on a page.

import { Link2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Id } from "../../core/types";
import { useSession, useStoreRevision } from "../app/sessionContext";
import { linksOf, type LinkEnd } from "../app/textLinks";
import { useWorkspaceActions } from "../app/workspaceActions";
import type { Box, Mark } from "./readerShared";
import { findQuote } from "./savedPages";

/** A linked passage of the page: its place in the page text, and how to go to the other end. */
type LinkedPassage = { key: string; start: number; end: number; go(): void };

/**
 * The linked passages of a page, their marks, and a function for a ⌘-click at a text offset.
 * `itemId`: the link object of the open copy (SPEC 1.1: its passages are places in its own copy).
 */
export function useLinkMarks(itemId: Id, text: string, boxes: (start: number, end: number) => Box[], layoutKey: unknown) {
  const session = useSession();
  const actions = useWorkspaceActions();
  const revision = useStoreRevision();
  const passages = useMemo<LinkedPassage[]>(() => {
    if (text === "") return [];
    const ids = new Set([itemId]);
    const out: LinkedPassage[] = [];
    const place = (quote: string | undefined) => {
      if (quote === undefined || quote === "") return null;
      return findQuote(text, quote);
    };
    for (const link of session.store.all("links")) {
      if (link.kind !== "link") continue;
      if (ids.has(link.from)) {
        const at = place(link.fromQuote);
        if (at !== null) out.push({ key: `from:${link.id}`, ...at, go: () => actions.followLink(link.id) });
      }
      if (ids.has(link.to)) {
        const at = place(link.quote);
        if (at !== null) out.push({ key: `to:${link.id}`, ...at, go: () => actions.openAt(link.from, link.fromQuote !== undefined ? { quote: link.fromQuote } : {}) });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, itemId, text, revision, actions]);
  const marks = useMemo<Mark[]>(
    () => passages.map((passage) => ({ id: passage.key, color: "link" as const, boxes: boxes(passage.start, passage.end) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [passages, boxes, layoutKey],
  );
  /** Goes along the link of the passage at this offset. False if no linked passage is there. */
  const follow = (offset: number): boolean => {
    const hit = passages.find((passage) => offset >= passage.start && offset < passage.end);
    hit?.go();
    return hit !== undefined;
  };
  return { marks, follow };
}

/** The Links button of the reader tools: the links of the page, both ways. */
export function ReaderLinks({ itemId }: { itemId: Id }) {
  const session = useSession();
  const actions = useWorkspaceActions();
  useStoreRevision();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => !box.current?.contains(event.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
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

