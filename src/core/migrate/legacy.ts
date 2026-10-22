// The older form of page comments and notes (vault format 1), for the migration only (insideLinks.ts). The app does
// not read this form: it opens a format-1 vault read-only and asks for the migration (core/format.ts).
//
// Format 1: a comment or a note of a page is an item with `on` = the page, a card on the board of the page (its
// kind), `pageAt` (its place in the page), and `quote` (its passage).

import { makeOp, type Op } from "../commands";
import type { ActionContext } from "../actions";
import { outlineCleanupOps } from "../outline";
import type { GraphIndex } from "../graph";
import type { Store } from "../store";
import { SMALL_VIEWS, type InsideLink, type ItemRecord } from "../types";

/** True if an item is a page: its home card shows it as a page. */
function isPage(store: Store, graph: GraphIndex, itemId: string): boolean {
  return graph.homeOf(itemId)?.view === "page" && !graph.isBoardItem(itemId) && store.has("items", itemId);
}

/** An old entry: a comment or a note of a page in the older form (`on` = a page, no inside link). */
export function isLegacyInside(store: Store, graph: GraphIndex, item: ItemRecord): boolean {
  if (item.on === undefined || graph.insideHomeOf(item.id) !== undefined) return false;
  return isPage(store, graph, item.on);
}

/**
 * The ops that change an old entry to an inside link. The cards of the item go (it shows only in its page).
 * `on`, `pageAt`, and `quote` leave the item: they go into the inside link.
 */
export function upgradeLegacy(context: ActionContext, item: ItemRecord): Op[] {
  const place = context.graph.parentsOf(item.id).find((link) => link.kind === "place") ?? null;
  const view = place !== null && SMALL_VIEWS.includes(place.view) ? place.view : item.author !== undefined ? "comment" : "note";
  const link: InsideLink = { id: context.newId(), kind: "inside", from: item.on!, to: item.id, view };
  if (item.pageAt !== undefined) [link.x, link.y] = item.pageAt;
  if (place?.color !== undefined) link.color = place.color;
  if (place?.expanded !== undefined) link.expanded = place.expanded;
  if (item.quote !== undefined) link.quote = item.quote;
  const after: ItemRecord = { ...item };
  delete after.on;
  delete after.pageAt;
  delete after.quote;
  const ops: Op[] = [makeOp("items", item.id, item, after), makeOp("links", link.id, null, link)];
  for (const card of context.graph.parentsOf(item.id)) ops.push(makeOp("links", card.id, card, null));
  ops.push(...outlineCleanupOps(context, context.graph.parentsOf(item.id)));
  return ops;
}
