// "Items by type" (SPEC 7.4): the items of one type in the vault, each with the card to go to.

import type { GraphIndex } from "./graph";
import type { Store } from "./store";
import type { Id, ItemRecord, ViewStyle } from "./types";

/** A card kind, or "media" (items with media info, on any card). */
export type ItemKind = ViewStyle | "media";

/**
 * The items of a kind: from their cards on boards and their inside links (a small item in a page). Each item one time.
 * `cardId`: the item to go to (the item, or the page that a small item is in); `boardId`: the home board of that card.
 * Items with no home (in the trash) are not in the list.
 */
export function itemsOfKind(store: Store, graph: GraphIndex, kind: ItemKind): { item: ItemRecord; boardId: Id; cardId: Id; color?: string }[] {
  const out: { item: ItemRecord; boardId: Id; cardId: Id; color?: string }[] = [];
  const seen = new Set<Id>();
  for (const link of store.all("links")) {
    if (link.kind !== "place" && link.kind !== "inside") continue;
    if (seen.has(link.to)) continue;
    const item = store.get("items", link.to);
    if (item === undefined || (kind === "media" ? item.media === undefined : link.view !== kind)) continue;
    const cardId = link.kind === "inside" ? link.from : link.to;
    const home = graph.homeOf(cardId);
    if (home === undefined) continue;
    seen.add(item.id);
    out.push({ item, boardId: home.from, cardId, color: link.kind === "inside" ? link.color ?? home.color : home.color });
  }
  return out;
}
