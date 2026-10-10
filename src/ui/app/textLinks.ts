// Links between items, for the views: in a text (hover card), on a page (the Links list), on a board (menu).
// See docs/SPEC.md section 7.5.
// - A text link "[label](link:<id>)" is a relation link record: it can have a location in its target (`quote`).
// - A text link "[label](item:<id>)" points to an item directly.

import type { GraphIndex } from "../../core/graph";
import type { Store } from "../../core/store";
import type { Id } from "../../core/types";
import { titleOf } from "../board/boardModel";

/** A link at one end: the item at the other end, where it lives, and how to go there. */
export type LinkEnd = {
  key: string;
  /** The item to show. */
  itemId: Id;
  title: string;
  /** The boards to the item, as names ("Home / Reading"). */
  path: string;
  /** Outgoing: the linked passage in the target. Incoming: the linked words in the source text. */
  excerpt: string;
  /** Outgoing: the relation link to follow (with its location), or null for an item link. */
  linkId: Id | null;
};

function pathOf(store: Store, graph: GraphIndex, rootId: Id, itemId: Id): string {
  return graph
    .homePath(rootId, itemId)
    .slice(0, -1)
    .map((id) => titleOf(store, id))
    .join(" / ");
}

/** The item of a text link target: a relation link (its target) or an item. Null if it is gone. */
export function describeTarget(store: Store, graph: GraphIndex, rootId: Id, target: { kind: "item" | "link"; id: Id }): LinkEnd | null {
  if (target.kind === "link") {
    const link = store.get("links", target.id);
    if (link?.kind !== "link" || !store.has("items", link.to)) return null;
    return { key: link.id, itemId: link.to, title: titleOf(store, link.to), path: pathOf(store, graph, rootId, link.to), excerpt: link.quote ?? "", linkId: link.id };
  }
  if (!store.has("items", target.id)) return null;
  return { key: `item:${target.id}`, itemId: target.id, title: titleOf(store, target.id), path: pathOf(store, graph, rootId, target.id), excerpt: "", linkId: null };
}

/** The words of a text link in a source text: the label of "[label](link:<id>)" or "[label](item:<id>)". */
function labelIn(body: string, target: string): string {
  const at = body.indexOf(`](${target})`);
  if (at === -1) return "";
  const start = body.lastIndexOf("[", at);
  return start === -1 ? "" : body.slice(start + 1, at);
}

/** The links of an item: to other items (outgoing) and from other items (incoming). Text links and board links. */
export function linksOf(store: Store, graph: GraphIndex, rootId: Id, itemId: Id): { outgoing: LinkEnd[]; incoming: LinkEnd[] } {
  const outgoing: LinkEnd[] = [];
  const incoming: LinkEnd[] = [];
  const seen = new Set<string>();
  for (const link of graph.relationsFrom(itemId)) {
    const end = describeTarget(store, graph, rootId, { kind: "link", id: link.id });
    if (end !== null && !seen.has(end.key)) {
      seen.add(end.key);
      outgoing.push(end);
    }
  }
  for (const ref of graph.refsFrom(itemId)) {
    const end = describeTarget(store, graph, rootId, { kind: "item", id: ref.to });
    if (end !== null && !seen.has(end.key)) {
      seen.add(end.key);
      outgoing.push({ ...end, excerpt: ref.label });
    }
  }
  for (const link of graph.relationsTo(itemId)) {
    if (!store.has("items", link.from)) continue;
    const body = store.get("texts", link.from)?.body ?? "";
    incoming.push({ key: `in:${link.id}`, itemId: link.from, title: titleOf(store, link.from), path: pathOf(store, graph, rootId, link.from), excerpt: labelIn(body, `link:${link.id}`) || (link.fromQuote ?? ""), linkId: null });
  }
  for (const ref of graph.refsTo(itemId)) {
    if (!store.has("items", ref.from) || incoming.some((end) => end.itemId === ref.from)) continue;
    incoming.push({ key: `in:item:${ref.from}`, itemId: ref.from, title: titleOf(store, ref.from), path: pathOf(store, graph, rootId, ref.from), excerpt: ref.label, linkId: null });
  }
  return { outgoing, incoming };
}
