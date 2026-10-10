// Derived data: children, parents, relations, inline references, and ghosts.
// This data is never saved. The index is rebuilt from the store when the store changes.

import { findInlineRefs, type InlineRef } from "./refs";
import type { Store } from "./store";
import type { Id, ItemRecord, OutlineRecord, PlaceLink, RelationLink } from "./types";

export type InlineRefEdge = InlineRef & { from: Id };

type IndexData = {
  placementsOnBoard: Map<Id, PlaceLink[]>;
  placementsOfRecord: Map<Id, PlaceLink[]>;
  relationsFrom: Map<Id, RelationLink[]>;
  relationsTo: Map<Id, RelationLink[]>;
  refsFrom: Map<Id, InlineRefEdge[]>;
  refsTo: Map<Id, InlineRefEdge[]>;
  outlinesOnBoard: Map<Id, OutlineRecord[]>;
  membersOfOutline: Map<Id, PlaceLink[]>;
  /** Item ID -> its home placement. */
  homes: Map<Id, PlaceLink>;
  /** Item ID -> the objects attached to it (comments, links), oldest first. */
  attached: Map<Id, ItemRecord[]>;
};

export class GraphIndex {
  private data: IndexData | null = null;
  private refCache = new Map<Id, { body: string; refs: InlineRefEdge[] }>();

  constructor(private readonly store: Store) {
    store.subscribe(() => {
      this.data = null;
    });
  }

  /** Placements on a board, in the order of the links table. */
  childrenOf(boardId: Id): readonly PlaceLink[] {
    return this.get().placementsOnBoard.get(boardId) ?? [];
  }

  /** Placements of a record on all boards. */
  parentsOf(recordId: Id): readonly PlaceLink[] {
    return this.get().placementsOfRecord.get(recordId) ?? [];
  }

  relationsFrom(itemId: Id): readonly RelationLink[] {
    return this.get().relationsFrom.get(itemId) ?? [];
  }

  relationsTo(itemId: Id): readonly RelationLink[] {
    return this.get().relationsTo.get(itemId) ?? [];
  }

  refsFrom(itemId: Id): readonly InlineRefEdge[] {
    return this.get().refsFrom.get(itemId) ?? [];
  }

  refsTo(itemId: Id): readonly InlineRefEdge[] {
    return this.get().refsTo.get(itemId) ?? [];
  }

  /**
   * True if the item is a board: it has item children, or the user made it a board.
   * Scribbles alone do not make a board: a note can hold scribbles.
   */
  isBoardItem(id: Id): boolean {
    if (this.store.get("items", id)?.board === true) return true;
    return this.childrenOf(id).some((place) => !this.store.has("stamps", place.to));
  }

  /** Outlines on a board, sorted by ID. */
  outlinesOn(boardId: Id): readonly OutlineRecord[] {
    return this.get().outlinesOnBoard.get(boardId) ?? [];
  }

  /** The cards of an outline. Only cards on the board of the outline count. */
  membersOf(outlineId: Id): readonly PlaceLink[] {
    return this.get().membersOfOutline.get(outlineId) ?? [];
  }

  /**
   * The home placement of an item: the one placement that is not a reference.
   * Older vaults can have more: then the one with the lowest ID is the home. Others show as references.
   */
  homeOf(itemId: Id): PlaceLink | undefined {
    return this.get().homes.get(itemId);
  }

  /**
   * The boards from the root to a record, along home placements: [root, ..., boardId].
   * If the chain does not reach the root (a cycle or an unplaced item), the result is [root, id].
   */
  homePath(rootId: Id, id: Id): Id[] {
    const path: Id[] = [id];
    const seen = new Set<Id>([id]);
    let current = id;
    while (current !== rootId) {
      const parent = this.homeOf(current)?.from;
      if (parent === undefined || seen.has(parent)) return id === rootId ? [rootId] : [rootId, id];
      seen.add(parent);
      path.unshift(parent);
      current = parent;
    }
    return path;
  }

  /** True if a placement shows an item that lives on a different board. */
  isReference(place: PlaceLink): boolean {
    if (!this.store.has("items", place.to)) return false;
    return this.homeOf(place.to)?.id !== place.id;
  }

  /** The objects attached to an item (comments, links: ItemRecord.on), oldest first. */
  attachedTo(itemId: Id): readonly ItemRecord[] {
    return this.get().attached.get(itemId) ?? [];
  }

  /** A ghost is an ID that a link or an inline reference uses, but that has no record. */
  isGhost(id: Id): boolean {
    return !this.store.has("items", id) && !this.store.has("stamps", id);
  }

  /** All ghost IDs. */
  ghosts(): Set<Id> {
    const ghosts = new Set<Id>();
    for (const link of this.store.all("links")) {
      if (this.isGhost(link.from)) ghosts.add(link.from);
      if (this.isGhost(link.to)) ghosts.add(link.to);
    }
    for (const refs of this.get().refsFrom.values()) {
      for (const ref of refs) if (this.isGhost(ref.to)) ghosts.add(ref.to);
    }
    return ghosts;
  }

  /** Items that are on no board. The root item is not an orphan. Nor is an attached object (a reply to a comment). */
  unplacedItems(rootId: Id): Id[] {
    const result: Id[] = [];
    for (const item of this.store.all("items")) {
      const attached = item.on !== undefined && this.store.has("items", item.on);
      if (item.id !== rootId && !attached && this.parentsOf(item.id).length === 0) result.push(item.id);
    }
    return result;
  }

  private get(): IndexData {
    if (this.data === null) this.data = this.build();
    return this.data;
  }

  private build(): IndexData {
    const data: IndexData = {
      placementsOnBoard: new Map(),
      placementsOfRecord: new Map(),
      relationsFrom: new Map(),
      relationsTo: new Map(),
      refsFrom: new Map(),
      refsTo: new Map(),
      outlinesOnBoard: new Map(),
      membersOfOutline: new Map(),
      homes: new Map(),
      attached: new Map(),
    };
    for (const item of this.store.all("items")) if (item.on !== undefined) pushTo(data.attached, item.on, item);
    for (const list of data.attached.values()) list.sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : a.id < b.id ? -1 : 1));
    for (const outline of [...this.store.all("outlines")].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      pushTo(data.outlinesOnBoard, outline.board, outline);
    }
    for (const link of this.store.all("links")) {
      if (link.kind === "place") {
        pushTo(data.placementsOnBoard, link.from, link);
        pushTo(data.placementsOfRecord, link.to, link);
        if (link.outline !== undefined && this.store.get("outlines", link.outline)?.board === link.from) {
          pushTo(data.membersOfOutline, link.outline, link);
        }
        if (link.ref !== true) {
          const home = data.homes.get(link.to);
          if (home === undefined || link.id < home.id) data.homes.set(link.to, link);
        }
      } else {
        pushTo(data.relationsFrom, link.from, link);
        pushTo(data.relationsTo, link.to, link);
      }
    }
    // An item with references only (its home placement was removed): its first reference is its home.
    for (const [recordId, places] of data.placementsOfRecord) {
      if (data.homes.has(recordId)) continue;
      const first = [...places].sort((a, b) => (a.id < b.id ? -1 : 1))[0];
      if (first !== undefined) data.homes.set(recordId, first);
    }
    const liveTextIds = new Set<Id>();
    for (const text of this.store.all("texts")) {
      liveTextIds.add(text.id);
      const refs = this.refsOfText(text.id, text.body);
      if (refs.length > 0) data.refsFrom.set(text.id, refs);
      for (const ref of refs) pushTo(data.refsTo, ref.to, ref);
    }
    for (const id of this.refCache.keys()) {
      if (!liveTextIds.has(id)) this.refCache.delete(id);
    }
    return data;
  }

  /** Parses a body text only when it changed. */
  private refsOfText(id: Id, body: string): InlineRefEdge[] {
    const cached = this.refCache.get(id);
    if (cached !== undefined && cached.body === body) return cached.refs;
    const refs = findInlineRefs(body).map((ref) => ({ ...ref, from: id }));
    this.refCache.set(id, { body, refs });
    return refs;
  }
}

function pushTo<V>(map: Map<Id, V[]>, key: Id, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}
