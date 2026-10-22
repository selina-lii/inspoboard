// Lineage (SPEC 7.16, "Processing maps and lineage"): items made from other items. A copy on a processing map, or an
// item with clips of other items, has `madeFrom`: each source and its version then. Many to many.
// - Version: a hash of the name and the text. A source whose version is not the `seen` one makes the item outdated.
// - Only the items made directly from a changed item are outdated; "Same meaning" accepts the change.
// - Pure: reads the store, returns commands. The UI is in the sorting tray plugin (src/ui/plugins/tray/).

import type { ActionContext } from "./actions";
import { makeOp, type Command, type Op } from "./commands";
import type { Store } from "./store";
import type { Id, ItemRecord, MadeFrom } from "./types";

/** The version of an item: a hash (53 bits, base 36) of its name and its text. */
export function versionOf(store: Store, itemId: Id): string {
  const text = `${store.get("items", itemId)?.name ?? ""}\n${store.get("texts", itemId)?.body ?? ""}`;
  // cyrb53: fast, and enough to see a change (not for security).
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function sourcesOf(store: Store, itemId: Id): readonly MadeFrom[] {
  return store.get("items", itemId)?.madeFrom ?? [];
}

/** The items made directly from each item (the reverse of `madeFrom`). */
export function madeIndex(store: Store): Map<Id, Id[]> {
  const index = new Map<Id, Id[]>();
  for (const item of store.all("items")) {
    for (const source of item.madeFrom ?? []) {
      const list = index.get(source.from) ?? [];
      list.push(item.id);
      index.set(source.from, list);
    }
  }
  return index;
}

/** All the items that an item was made from, at any depth. */
export function ancestorsOf(store: Store, itemId: Id): Set<Id> {
  const found = new Set<Id>();
  const queue = [itemId];
  for (let at = 0; at < queue.length; at += 1) {
    for (const source of sourcesOf(store, queue[at]!)) {
      if (found.has(source.from) || source.from === itemId) continue;
      found.add(source.from);
      queue.push(source.from);
    }
  }
  return found;
}

/** All the items made from an item, at any depth. */
export function descendantsOf(store: Store, itemId: Id, index: Map<Id, Id[]> = madeIndex(store)): Set<Id> {
  const found = new Set<Id>();
  const queue = [itemId];
  for (let at = 0; at < queue.length; at += 1) {
    for (const child of index.get(queue[at]!) ?? []) {
      if (found.has(child) || child === itemId) continue;
      found.add(child);
      queue.push(child);
    }
  }
  return found;
}

/** The newest versions of an item: the items made from it that nothing was made from (the last generation). */
export function newestOf(store: Store, itemId: Id, index: Map<Id, Id[]> = madeIndex(store)): Id[] {
  return [...descendantsOf(store, itemId, index)].filter((id) => (index.get(id) ?? []).length === 0 && store.has("items", id));
}

/** The sources of an item that changed since it was made from them (or since the user accepted them). */
export function changedSources(store: Store, itemId: Id): Id[] {
  return sourcesOf(store, itemId)
    .filter((source) => store.has("items", source.from) && versionOf(store, source.from) !== source.seen)
    .map((source) => source.from);
}

export const isOutdated = (store: Store, itemId: Id): boolean => changedSources(store, itemId).length > 0;

/** "Same meaning": the current versions of the changed sources (all, or `sourceIds`) are accepted. */
export function acceptChanges(context: ActionContext, itemIds: readonly Id[], sourceIds?: readonly Id[]): Command {
  const ops: Op[] = [];
  for (const itemId of itemIds) {
    const item = context.store.get("items", itemId);
    if (item?.madeFrom === undefined) continue;
    let changed = false;
    const madeFrom = item.madeFrom.map((source) => {
      if (sourceIds !== undefined && !sourceIds.includes(source.from)) return source;
      if (!context.store.has("items", source.from)) return source;
      const seen = versionOf(context.store, source.from);
      if (seen === source.seen) return source;
      changed = true;
      return { from: source.from, seen };
    });
    if (changed) ops.push(makeOp("items", itemId, item, { ...item, madeFrom }));
  }
  return { label: itemIds.length === 1 ? "Same meaning" : `Same meaning (${itemIds.length} items)`, ops };
}

/** Adds sources to an item (clips pasted into it). A source that it has already is kept as it is. */
export function addSources(context: ActionContext, itemId: Id, sourceIds: readonly Id[]): Command {
  const item = context.store.get("items", itemId);
  if (item === undefined) return { label: "Made from", ops: [] };
  const known = new Set((item.madeFrom ?? []).map((source) => source.from));
  const added = [...new Set(sourceIds)].filter((id) => id !== itemId && !known.has(id) && context.store.has("items", id));
  if (added.length === 0) return { label: "Made from", ops: [] };
  const madeFrom = [...(item.madeFrom ?? []), ...added.map((from) => ({ from, seen: versionOf(context.store, from) }))];
  return { label: "Made from", ops: [makeOp("items", itemId, item, { ...item, madeFrom })] };
}

/** Fields of an item that a copy does not take: its identity, its times, its trash state, and sorting map data. */
const NOT_COPIED = ["id", "created", "modified", "trashed", "trashedFrom", "sources", "discarded", "lostAndFound", "detached", "madeFrom"] as const;

/** True if an item can be copied: not a collection (an item with its own board: its board stays one). */
export function canCopy(store: Store, itemId: Id): boolean {
  const item = store.get("items", itemId);
  return item !== undefined && item.board !== true;
}

/**
 * A copy of an item: the same name, text, and fields, made from it. Ops only (no card): the caller places it.
 * `board`: a collection can be copied too (its board is not: processing.ts copies its cards).
 */
export function copyOps(context: ActionContext, itemId: Id, board = false): { ops: Op[]; copyId: Id } | null {
  const item = context.store.get("items", itemId);
  if (item === undefined || (!board && !canCopy(context.store, itemId))) return null;
  const copyId = context.newId();
  const now = context.now();
  const fields = { ...item } as Partial<ItemRecord>;
  for (const key of NOT_COPIED) delete fields[key];
  const copy: ItemRecord = { ...(fields as ItemRecord), id: copyId, created: now, madeFrom: [{ from: itemId, seen: versionOf(context.store, itemId) }] };
  const ops: Op[] = [makeOp("items", copyId, null, copy)];
  const text = context.store.get("texts", itemId);
  if (text !== undefined) ops.push(makeOp("texts", copyId, null, { id: copyId, body: text.body }));
  return { ops, copyId };
}
