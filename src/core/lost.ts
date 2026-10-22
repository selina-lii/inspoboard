// Lost items (SPEC 7.16, "Lost and found"): the items that the root board cannot reach. Search, lists, and the
// boards never show them. Two kinds:
// - An item on no board (the trash).
// - An item on a board that is itself on no board that the root reaches (for example two boards that hold each
//   other, and nothing else holds them).
// An item is reached from the root through its cards (place links), the small items inside an item (inside links),
// and the objects attached to an item (`on`: comments, replies, links).
// The lost "tops" are the items to salvage: put a top on a board, and its board, its small items, and its attached
// objects are reached again with it.

import type { GraphIndex } from "./graph";
import type { Store } from "./store";
import type { Id } from "./types";

/** The items that an item holds: the items on its board, inside it, and attached to it. */
function heldBy(store: Store, graph: GraphIndex, itemId: Id): Id[] {
  return [...graph.childrenOf(itemId).map((place) => place.to), ...graph.insideOf(itemId).map((link) => link.to), ...graph.attachedTo(itemId).map((item) => item.id)].filter((id) => store.has("items", id));
}

/** All items that the root reaches. */
export function reachedItems(store: Store, graph: GraphIndex, rootId: Id): Set<Id> {
  const reached = new Set<Id>([rootId]);
  const queue = [rootId];
  for (let index = 0; index < queue.length; index += 1) {
    for (const id of heldBy(store, graph, queue[index]!)) {
      if (reached.has(id)) continue;
      reached.add(id);
      queue.push(id);
    }
  }
  return reached;
}

/**
 * The tops of the lost items, oldest first: each lost group of items once, at the item that holds the others. An
 * item that a different lost item holds is not a top; a ring of items that hold each other gets its oldest item.
 */
export function lostTops(store: Store, graph: GraphIndex, rootId: Id): Id[] {
  const reached = reachedItems(store, graph, rootId);
  const lost = [...store.all("items")].filter((item) => !reached.has(item.id)).sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : a.id < b.id ? -1 : 1));
  const lostIds = new Set(lost.map((item) => item.id));
  const heldByLost = new Set<Id>();
  for (const item of lost) for (const id of heldBy(store, graph, item.id)) if (id !== item.id && lostIds.has(id)) heldByLost.add(id);
  const tops: Id[] = [];
  const covered = new Set<Id>();
  const cover = (start: Id) => {
    const queue = [start];
    covered.add(start);
    for (let index = 0; index < queue.length; index += 1) {
      for (const id of heldBy(store, graph, queue[index]!)) {
        if (covered.has(id) || !lostIds.has(id)) continue;
        covered.add(id);
        queue.push(id);
      }
    }
  };
  // First the items that no lost item holds, then one item of each ring that is left.
  for (const item of lost) if (!heldByLost.has(item.id) && !covered.has(item.id)) (tops.push(item.id), cover(item.id));
  for (const item of lost) if (!covered.has(item.id)) (tops.push(item.id), cover(item.id));
  return tops;
}
