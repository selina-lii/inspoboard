// A link between two ends, from anywhere: an item, or a passage in an item (its text, or its saved web page or PDF).
// The link bench (src/ui/app/LinkBench.tsx) makes these links. See docs/SPEC.md section 7.11.
// - The first end is the source, the second end is the target (`quote`: the target passage).
// - A source passage in a note or page text becomes "[passage](link:<id>)" in that text, in the same command.
//   If the text changed and the passage is not there one time exactly, the passage has more than one line or a
//   bracket, or the passage is in a web page or PDF, the link keeps it in `fromQuote` (the text does not change).

import { makeOp, type Command, type Op } from "./commands";
import { emptyCommand, type ActionContext } from "./actions";
import { withTextLink } from "./refs";
import type { GraphIndex } from "./graph";
import type { Store } from "./store";
import type { Id, InsideLink, RelationLink } from "./types";

/** One end of a link: an item, or a passage in it. `range`: where the passage is in the item text, if it is there. */
export type PassageEnd = { itemId: Id; quote?: string; range?: { from: number; to: number } };

/** The place of a passage in a text: the given range if it still holds the passage, else its only place. */
export function passageRange(body: string, end: PassageEnd): { from: number; to: number } | null {
  const quote = end.quote;
  if (quote === undefined || quote === "") return null;
  if (end.range !== undefined && body.slice(end.range.from, end.range.to) === quote) return end.range;
  const first = body.indexOf(quote);
  if (first === -1 || body.indexOf(quote, first + 1) !== -1) return null;
  return { from: first, to: first + quote.length };
}

/** True if the two ends are the same item and passage (a link to itself). */
export function sameEnd(a: PassageEnd, b: PassageEnd): boolean {
  return a.itemId === b.itemId && (a.quote ?? "") === (b.quote ?? "");
}

/** Links the ends: one command (the link, and the source text). Throws if an item is gone. */
export function linkEnds(context: ActionContext, source: PassageEnd, target: PassageEnd): { command: Command; linkId: Id } {
  for (const end of [source, target]) {
    if (!context.store.has("items", end.itemId)) throw new Error(`Item "${end.itemId}" is gone.`);
  }
  const linkId = context.newId();
  const link: RelationLink = { id: linkId, kind: "link", from: source.itemId, to: target.itemId, end: "none" };
  if (target.quote !== undefined && target.quote !== "") link.quote = target.quote;
  const ops: Op[] = [];
  if (source.quote !== undefined && source.quote !== "") {
    const text = context.store.get("texts", source.itemId);
    const range = text === undefined ? null : passageRange(text.body, source);
    // A Markdown link holds one line with no brackets. Else the link keeps the passage in fromQuote.
    const wrappable = !/[\n[\]]/.test(source.quote);
    const wrapped = text === undefined || range === null || !wrappable ? null : withTextLink(text.body, range.from, range.to, source.quote, linkId);
    if (text !== undefined && wrapped !== null) {
      const item = context.store.get("items", source.itemId)!;
      ops.push(makeOp("texts", source.itemId, text, { id: source.itemId, body: wrapped }));
      ops.push(makeOp("items", source.itemId, item, { ...item, modified: context.now() }));
    } else {
      link.fromQuote = source.quote;
    }
  }
  ops.unshift(makeOp("links", linkId, null, link));
  return { command: { label: "Form link", ops }, linkId };
}

/** The words of a text link "[words](link:<id>)" in a text, or null. */
export function textLinkLabel(body: string, linkId: Id): string | null {
  const at = body.indexOf(`](link:${linkId})`);
  if (at === -1) return null;
  const start = body.lastIndexOf("[", at);
  return start === -1 ? null : body.slice(start + 1, at);
}

/**
 * True if a link was made from text: a passage at one end or both (`quote`, `fromQuote`, or a text link in the
 * source). Such a link shows in its items (a gray passage and a shadow of the other item), not on boards (SPEC 7.11).
 */
export function isPassageLink(store: Store, link: RelationLink): boolean {
  if ((link.quote ?? "") !== "" || (link.fromQuote ?? "") !== "") return true;
  return textLinkLabel(store.get("texts", link.from)?.body ?? "", link.id) !== null;
}

/** True if a link shows only in its items (a passage link that the user did not put on boards). */
export function onlyInItems(store: Store, link: RelationLink): boolean {
  return link.onBoard !== true && isPassageLink(store, link);
}

/** A linked passage of an item: its words here, the other item, and the passage there (if the link has one). */
export type LinkedPassage = { linkId: Id; quote: string; otherId: Id; otherQuote: string | null; outgoing: boolean };

/** The linked passages of an item (links from it with a passage here, links to it with a passage here). */
export function linkedPassagesOf(store: Store, graph: GraphIndex, itemId: Id): LinkedPassage[] {
  const out: LinkedPassage[] = [];
  const body = store.get("texts", itemId)?.body ?? "";
  for (const link of graph.relationsFrom(itemId)) {
    const quote = textLinkLabel(body, link.id) ?? link.fromQuote ?? null;
    if (quote !== null && quote !== "") out.push({ linkId: link.id, quote, otherId: link.to, otherQuote: link.quote ?? null, outgoing: true });
  }
  for (const link of graph.relationsTo(itemId)) {
    if ((link.quote ?? "") === "" || link.from === itemId) continue;
    const other = textLinkLabel(store.get("texts", link.from)?.body ?? "", link.id) ?? link.fromQuote ?? null;
    out.push({ linkId: link.id, quote: link.quote!, otherId: link.from, otherQuote: other, outgoing: false });
  }
  return out;
}

/** Removes a link; a text link "[words](link:<id>)" in the source becomes its words. One command. */
export function unlinkPassage(context: ActionContext, linkId: Id): Command {
  const link = context.store.get("links", linkId);
  if (link === undefined) return emptyCommand("Delete link");
  const ops: Op[] = [makeOp("links", linkId, link, null)];
  if (link.kind === "link") {
    const text = context.store.get("texts", link.from);
    const label = text === undefined ? null : textLinkLabel(text.body, linkId);
    if (text !== undefined && label !== null) {
      ops.push(makeOp("texts", link.from, text, { ...text, body: text.body.replace(`[${label}](link:${linkId})`, label) }));
    }
  }
  return { label: "Delete link", ops };
}

/** The place of a linked passage in the text of its item (a text link: its words), or null if it is not there. */
export function linkedPassageRange(body: string, passage: LinkedPassage): { from: number; to: number } | null {
  const markup = `[${passage.quote}](link:${passage.linkId})`;
  const at = body.indexOf(markup);
  if (at !== -1) return { from: at + 1, to: at + 1 + passage.quote.length };
  const first = body.indexOf(passage.quote);
  return first === -1 ? null : { from: first, to: first + passage.quote.length };
}

/**
 * A linked passage in the editor of an item, with the link end that it belongs to:
 * - `to:<link id>`: the target passage of a link (`quote`);
 * - `from:<link id>`: the source passage of a link (`fromQuote`; a text link "[words](link:<id>)" moves with the text);
 * - `inside:<link id>`: the text that a small item points to (`quote` and `at`).
 */
export type PassageAnchor = { id: string; from: number; to: number };

/**
 * Edits in the text moved or changed linked passages: the link ends follow them (SPEC 7.11). The editor gives the
 * new places of the passages in `body`, the new text. This writes the links, as the editor writes the text (an undo
 * of the edit moves the passages back, and the links follow again). An empty passage (all of it deleted) keeps its
 * link as it is: if the passage comes back (cut and paste), the link finds it by its words.
 */
export function movePassageEnds(store: Store, body: string, anchors: readonly PassageAnchor[]): boolean {
  const writes = passageEndWrites(store, body, anchors);
  if (writes.length > 0) store.write(writes);
  return writes.length > 0;
}

/** The link records that `movePassageEnds` changes, to write together with the text. */
export function passageEndWrites(store: Store, body: string, anchors: readonly PassageAnchor[]): { table: "links"; id: Id; after: RelationLink | InsideLink }[] {
  const changed = new Map<Id, RelationLink | InsideLink>();
  for (const anchor of anchors) {
    const words = body.slice(anchor.from, anchor.to);
    if (words.trim() === "") continue;
    const [side, linkId] = splitAnchor(anchor.id);
    const link = changed.get(linkId) ?? store.get("links", linkId);
    if (link === undefined) continue;
    if (side === "to" && link.kind === "link" && link.quote !== undefined && link.quote !== words) changed.set(linkId, { ...link, quote: words });
    else if (side === "from" && link.kind === "link" && link.fromQuote !== undefined && link.fromQuote !== words) changed.set(linkId, { ...link, fromQuote: words });
    else if (side === "inside" && link.kind === "inside" && link.quote !== undefined && (link.quote !== words || link.at !== anchor.from)) {
      changed.set(linkId, { ...link, quote: words, at: anchor.from });
    }
  }
  return [...changed].map(([id, after]) => ({ table: "links" as const, id, after }));
}

function splitAnchor(id: string): [string, Id] {
  const at = id.indexOf(":");
  return [id.slice(0, at), id.slice(at + 1)];
}
