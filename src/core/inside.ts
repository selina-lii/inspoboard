// Small items inside a medium item (SPEC 1.1): a comment, a note, an action item, … in a page, or in the saved web
// page or PDF of a link object. The data is an inside link (InsideLink) from the home to the small item.
//
// Older vaults (format 1) had another form (`on` = the page, `pageAt`, `quote`). The app does not read it: the
// migration script changes it (core/migrate/legacy.ts).

import { makeOp, type Command, type Op } from "./commands";
import { DEFAULT_SIZE, nameOrCode, UNNAMED_VIEWS, withName, type ActionContext } from "./actions";
import { outlineCleanupOps } from "./outline";
import type { GraphIndex } from "./graph";
import type { Store } from "./store";
import { SMALL_VIEWS, type Id, type InsideLink, type ItemRecord, type PlaceLink, type ViewStyle } from "./types";

/** A small item in a home, from an inside link or from the older form. */
export type InsideEntry = {
  item: ItemRecord;
  link: InsideLink;
  view: ViewStyle;
  /** Place in the home, or null (in the comment column). */
  at: [number, number] | null;
  w: number | null;
  h: number | null;
  color: string | null;
  /** The text in the home that the item points to, and where it starts (a hint). */
  quote: string | null;
  quoteAt: number | null;
};

/** True if an item is a page (a medium item that holds small items): its home card shows it as a page. */
export function isPageHome(store: Store, graph: GraphIndex, itemId: Id): boolean {
  return graph.homeOf(itemId)?.view === "page" && !graph.isBoardItem(itemId) && store.has("items", itemId);
}

/** The small items in a home (links table order). */
export function insideEntries(store: Store, graph: GraphIndex, homeId: Id): InsideEntry[] {
  const entries: InsideEntry[] = [];
  for (const link of graph.insideOf(homeId)) {
    const item = store.get("items", link.to);
    if (item === undefined || graph.insideHomeOf(item.id)?.id !== link.id) continue;
    entries.push({
      item,
      link,
      view: link.view,
      at: link.x !== undefined && link.y !== undefined ? [link.x, link.y] : null,
      w: link.w ?? null,
      h: link.h ?? null,
      color: link.color ?? null,
      quote: link.quote ?? null,
      quoteAt: link.at ?? null,
    });
  }
  return entries;
}

/** The entry of one small item, or null if it is not inside an item. */
export function insideEntryOf(store: Store, graph: GraphIndex, itemId: Id): InsideEntry | null {
  const item = store.get("items", itemId);
  if (item === undefined) return null;
  const homeId = graph.insideHomeOf(itemId)?.from;
  if (homeId === undefined) return null;
  return insideEntries(store, graph, homeId).find((entry) => entry.item.id === itemId) ?? null;
}

/** The home of a small item, or null. */
export function insideHomeId(_store: Store, graph: GraphIndex, itemId: Id): Id | null {
  return graph.insideHomeOf(itemId)?.from ?? null;
}

/** Changes an inside link. One command. */
function changeLink(_context: ActionContext, entry: InsideEntry, label: string, change: (link: InsideLink) => InsideLink): Command {
  const link = entry.link;
  const next = change({ ...link });
  if (JSON.stringify(next) === JSON.stringify(link)) return { label, ops: [] };
  return { label, ops: [makeOp("links", link.id, link, next)] };
}

/** Input for a new small item inside a home. */
export type NewInside = {
  homeId: Id;
  view: ViewStyle;
  /** Place in the home, or null (the comment column of a page). */
  at: [number, number] | null;
  name?: string;
  body?: string;
  url?: string;
  author?: string;
  color?: string;
  w?: number;
  h?: number;
  /** The text in the home that it points to, and where it starts. */
  quote?: string;
  quoteAt?: number;
};

/** Makes a small item inside a home: the item, its text, and its inside link. One command. */
export function createInside(context: ActionContext, input: NewInside): { command: Command; itemId: Id; linkId: Id } {
  if (!SMALL_VIEWS.includes(input.view)) throw new Error(`A ${input.view} cannot be inside an item.`);
  if (!context.store.has("items", input.homeId)) throw new Error(`Item "${input.homeId}" does not exist.`);
  const itemId = context.newId();
  const linkId = context.newId();
  // As on a board: most small kinds have no name by default (the text is enough).
  const named = UNNAMED_VIEWS.includes(input.view) ? { name: (input.name ?? "").trim(), codeName: false } : nameOrCode(context, input.name);
  const item: ItemRecord = withName({ id: itemId, name: "", created: context.now() }, named);
  if (input.url !== undefined && input.url !== "") item.url = input.url;
  if (input.author !== undefined && input.author.trim() !== "") item.author = input.author.trim();
  const link: InsideLink = { id: linkId, kind: "inside", from: input.homeId, to: itemId, view: input.view };
  if (input.at !== null) [link.x, link.y] = input.at.map((value) => Math.round(value)) as [number, number];
  if (input.w !== undefined) link.w = Math.round(input.w);
  if (input.h !== undefined) link.h = Math.round(input.h);
  if (input.color !== undefined) link.color = input.color;
  if (input.quote !== undefined && input.quote !== "") {
    link.quote = input.quote;
    if (input.quoteAt !== undefined) link.at = Math.max(0, Math.round(input.quoteAt));
  }
  const command: Command = {
    label: `Create ${input.view === "todo" ? "action item" : input.view === "weblink" ? "link" : input.view}`,
    ops: [makeOp("items", itemId, null, item), makeOp("texts", itemId, null, { id: itemId, body: input.body ?? "" }), makeOp("links", linkId, null, link)],
  };
  return { command, itemId, linkId };
}

/** Moves a small item in its home: to a place, or (null) to the comment column of a page. */
export function moveInside(context: ActionContext, entry: InsideEntry, at: [number, number] | null): Command {
  return changeLink(context, entry, "Move in page", (link) => {
    if (at === null) {
      delete link.x;
      delete link.y;
    } else [link.x, link.y] = at.map((value) => Math.round(value)) as [number, number];
    return link;
  });
}

/** Changes the size of a small item in its home. */
export function resizeInside(context: ActionContext, entry: InsideEntry, w: number | null, h?: number): Command {
  return changeLink(context, entry, "Resize", (link) => {
    // Null: the width stays (in the comment column of a page, the column sets the width).
    if (w !== null) link.w = Math.max(1, Math.round(w));
    if (h !== undefined) link.h = Math.max(1, Math.round(h));
    return link;
  });
}

/** Points a small item to a text in its home, or (null) to no text. */
export function pointInside(context: ActionContext, entry: InsideEntry, quote: string | null, quoteAt?: number): Command {
  return changeLink(context, entry, quote === null ? "Stop pointing to text" : "Point to text", (link) => {
    delete link.quote;
    delete link.at;
    if (quote !== null && quote !== "") {
      link.quote = quote;
      if (quoteAt !== undefined) link.at = Math.max(0, Math.round(quoteAt));
    }
    return link;
  });
}

/** Sets the color of a small item in its home (null: the color of its kind). */
export function colorInside(context: ActionContext, entry: InsideEntry, color: string | null): Command {
  return changeLink(context, entry, "Change color", (link) => {
    if (color === null) delete link.color;
    else link.color = color;
    return link;
  });
}

/** Folds or unfolds a small item in its home. */
export function expandInside(context: ActionContext, entry: InsideEntry, expanded: boolean): Command {
  return changeLink(context, entry, expanded ? "Unfold" : "Fold", (link) => {
    link.expanded = expanded;
    return link;
  });
}

/**
 * Moves a small item out of its home onto a board: it becomes a free card there. It stops pointing to text.
 * One command.
 */
export function moveOut(context: ActionContext, entry: InsideEntry, boardId: Id, x: number, y: number): { command: Command; placeId: Id } {
  const ops: Op[] = [makeOp("links", entry.link.id, entry.link, null)];
  const size = DEFAULT_SIZE[entry.view];
  const placeId = context.newId();
  const place: PlaceLink = { id: placeId, kind: "place", from: boardId, to: entry.item.id, x: Math.round(x), y: Math.round(y), w: entry.w ?? size.w, h: entry.h ?? size.h, view: entry.view, expanded: true };
  if (entry.color !== null) place.color = entry.color;
  ops.push(makeOp("links", placeId, null, place));
  return { command: { label: "Move out of the page", ops }, placeId };
}

/**
 * Moves a card of a board into a home: its card goes, and it is inside the home at a place. Only small items. If the
 * item has other cards (references), they stay. One command.
 */
export function moveIn(context: ActionContext, placeId: Id, homeId: Id, at: [number, number] | null, quote?: { text: string; at?: number }): { command: Command; linkId: Id } {
  const place = context.store.get("links", placeId);
  if (place?.kind !== "place") throw new Error(`Link "${placeId}" is not a card.`);
  if (!SMALL_VIEWS.includes(place.view)) throw new Error(`A ${place.view} cannot be inside an item.`);
  if (place.to === homeId) throw new Error("An item cannot be inside itself.");
  if (context.graph.insideHomeOf(place.to) !== undefined) throw new Error("The item is inside an item already.");
  const linkId = context.newId();
  const link: InsideLink = { id: linkId, kind: "inside", from: homeId, to: place.to, view: place.view, w: place.w, h: place.h };
  if (at !== null) [link.x, link.y] = at.map((value) => Math.round(value)) as [number, number];
  if (place.color !== undefined) link.color = place.color;
  if (quote !== undefined && quote.text !== "") {
    link.quote = quote.text;
    if (quote.at !== undefined) link.at = Math.max(0, Math.round(quote.at));
  }
  const ops: Op[] = [makeOp("links", placeId, place, null), ...outlineCleanupOps(context, [place]), makeOp("links", linkId, null, link)];
  // The item is free now: it is not attached to a card any more (an attached comment that moves into a page).
  const item = context.store.get("items", place.to);
  if (item?.on !== undefined) {
    const free: ItemRecord = { ...item };
    delete free.on;
    delete free.quote;
    ops.push(makeOp("items", item.id, item, free));
  }
  return { command: { label: "Move into the page", ops }, linkId };
}

/** The inside links of a home and of the small items in it, and the small items (for a delete of the home). */
export function insideOfHome(store: Store, graph: GraphIndex, homeId: Id): { links: InsideLink[]; itemIds: Id[] } {
  const links = [...graph.insideOf(homeId)];
  const itemIds = links.map((link) => link.to).filter((id) => store.has("items", id));
  return { links, itemIds };
}

/**
 * The link bench with a small item at one end (the whole item) and text of its home at the other end: the item points
 * to that text (SPEC 1.1). Null if the ends are not such a pair (then the bench makes a link).
 */
export function pointEnds(context: ActionContext, a: { itemId: Id; quote?: string; range?: { from: number; to: number } }, b: { itemId: Id; quote?: string; range?: { from: number; to: number } }): Command | null {
  for (const [item, text] of [[a, b], [b, a]] as const) {
    if (item.quote !== undefined && item.quote !== "") continue;
    if (text.quote === undefined || text.quote === "") continue;
    const entry = insideEntryOf(context.store, context.graph, item.itemId);
    if (entry === null || insideHomeId(context.store, context.graph, item.itemId) !== text.itemId) continue;
    return pointInside(context, entry, text.quote, text.range?.from);
  }
  return null;
}
