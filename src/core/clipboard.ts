// Copy and paste of cards (⌘C / ⌘V, or Ctrl): a paste makes new items, copies of the copied ones.
// See docs/SPEC.md section 7.1.
// - For now only small items (note, text, comment, URL, action item, flashcard, quote) and pages can be copied.
//   Boards, outlines, and calendars cannot (an item with a board, or a group frame).
// - The copy is taken at ⌘C: later changes to the items do not change it.
// - A new item gets the name, the text, the date, the web address, and the signature of the copied item, and a card
//   with its kind, size, color, and fold state. It is a free card: not in an outline or a calendar, not attached.
// - In the text, a link to a relation link ("[label](link:<id>)") becomes plain text (the link belongs to the copied
//   item). A link to an item ("[label](item:<id>)") stays. Highlights, scribbles, comments, and links stay with the
//   copied item.
// - A link object is a full copy (SPEC 1.1): its saved web page or PDF, its marks (the caller copies the files: see
//   `webCopies`), and the small items inside it (new items, with the replies of comments).
// - A page is a full copy too: the small items inside it are new items in the new page.
// - One paste is one command (one undo).

import { makeOp, type Command, type Op } from "./commands";
import type { ActionContext } from "./actions";
import type { GraphIndex } from "./graph";
import type { Store } from "./store";
import { threadOf } from "./actions";
import { insideEntries } from "./inside";
import type { Id, InsideLink, ItemRecord, PlaceLink, ViewStyle } from "./types";

/** The kinds of card that can be copied. */
export const COPYABLE_VIEWS: readonly ViewStyle[] = ["note", "page", "text", "comment", "weblink", "todo", "flashcard", "quote"];

/** A copied card: the item (its fields at ⌘C), its text, and its card. */
export type CopiedCard = {
  item: ItemRecord;
  body: string;
  place: Pick<PlaceLink, "x" | "y" | "w" | "h" | "view" | "color" | "expanded" | "marks">;
  /** A link object or a page: the small items inside it (their fields at ⌘C, and their inside links). */
  inside?: CopiedInside[];
};

/** A small item inside a copied home. `replies`: the replies under a comment (each `on` an item of the thread). */
export type CopiedInside = { item: ItemRecord; body: string; link: Omit<InsideLink, "id" | "from" | "to">; replies: { item: ItemRecord; body: string }[] };

const RELATION_TEXT_LINK = /\[([^\]\n]*)\]\(link:[0-9a-z]{12}\)/g;

/** True if the card of this placement can be copied (a small item or a page, not a board). */
export function canCopy(context: { store: Store; graph: GraphIndex }, place: PlaceLink): boolean {
  return context.store.has("items", place.to) && COPYABLE_VIEWS.includes(place.view) && !context.graph.isBoardItem(place.to);
}

/** The copies of the cards that can be copied (in the given order). Other cards are left out. */
export function copyCards(context: { store: Store; graph: GraphIndex }, placeIds: readonly Id[]): CopiedCard[] {
  const out: CopiedCard[] = [];
  for (const placeId of new Set(placeIds)) {
    const place = context.store.get("links", placeId);
    if (place?.kind !== "place" || !canCopy(context, place)) continue;
    const item = context.store.get("items", place.to)!;
    const card: CopiedCard["place"] = { x: place.x, y: place.y, w: place.w, h: place.h, view: place.view };
    if (place.color !== undefined) card.color = place.color;
    if (place.expanded !== undefined) card.expanded = place.expanded;
    if (place.marks !== undefined) card.marks = place.marks;
    const copied: CopiedCard = { item: { ...item }, body: context.store.get("texts", place.to)?.body ?? "", place: card };
    if (item.url !== undefined || place.view === "page") {
      const inside = copyInside(context, item.id);
      if (inside.length > 0) copied.inside = inside;
    }
    out.push(copied);
  }
  return out;
}

/** The small items inside a home, as copies. */
function copyInside(context: { store: Store; graph: GraphIndex }, homeId: Id): CopiedInside[] {
  const textOf = (id: Id) => context.store.get("texts", id)?.body ?? "";
  return insideEntries(context.store, context.graph, homeId).map((entry) => {
    const { id: _id, from: _from, to: _to, ...link } = entry.link;
    const item: ItemRecord = { ...entry.item };
    const replies = threadOf(context, entry.item.id)
      .slice(1)
      .flatMap((id) => {
        const reply = context.store.get("items", id);
        return reply === undefined ? [] : [{ item: { ...reply }, body: textOf(id) }];
      });
    return { item, body: textOf(entry.item.id), link, replies };
  });
}

/**
 * New items from copied cards, on a board. `at`: the board point of the top-left corner of the copied cards
 * (they keep their places to each other). One command.
 */
export function pasteCards(context: ActionContext, cards: readonly CopiedCard[], boardId: Id, at: { x: number; y: number }): { command: Command; placeIds: Id[]; webCopies: { from: Id; to: Id }[] } {
  const webCopies: { from: Id; to: Id }[] = [];
  const left = Math.min(...cards.map((card) => card.place.x));
  const top = Math.min(...cards.map((card) => card.place.y));
  const ops: Op[] = [];
  const placeIds: Id[] = [];
  const now = context.now();
  for (const card of cards) {
    const itemId = context.newId();
    const placeId = context.newId();
    const item: ItemRecord = { id: itemId, name: card.item.name, created: now };
    if (card.item.codeName === true) item.codeName = true;
    if (card.item.date !== undefined) item.date = card.item.date;
    if (card.item.url !== undefined) item.url = card.item.url;
    if (card.item.author !== undefined) item.author = card.item.author;
    const body = card.body.replace(RELATION_TEXT_LINK, (_whole, label: string) => label);
    const place: PlaceLink = {
      id: placeId,
      kind: "place",
      from: boardId,
      to: itemId,
      x: Math.round(at.x + card.place.x - left),
      y: Math.round(at.y + card.place.y - top),
      w: card.place.w,
      h: card.place.h,
      view: card.place.view,
    };
    if (card.place.color !== undefined) place.color = card.place.color;
    if (card.place.expanded !== undefined) place.expanded = card.place.expanded;
    if (card.place.marks !== undefined) place.marks = card.place.marks;
    ops.push(makeOp("items", itemId, null, item), makeOp("texts", itemId, null, { id: itemId, body }), makeOp("links", placeId, null, place));
    placeIds.push(placeId);
    if (card.item.url !== undefined) webCopies.push({ from: card.item.id, to: itemId });
    // The small items inside a link object or a page: new items, inside the new home (with their replies).
    for (const inner of card.inside ?? []) {
      const innerId = context.newId();
      const linkId = context.newId();
      const copy: ItemRecord = { ...inner.item, id: innerId, created: now };
      delete copy.modified;
      ops.push(
        makeOp("items", innerId, null, copy),
        makeOp("texts", innerId, null, { id: innerId, body: inner.body.replace(RELATION_TEXT_LINK, (_whole, label: string) => label) }),
        makeOp("links", linkId, null, { ...inner.link, id: linkId, from: itemId, to: innerId } as InsideLink),
      );
      const newIds = new Map<Id, Id>([[inner.item.id, innerId]]);
      for (const reply of inner.replies) newIds.set(reply.item.id, context.newId());
      for (const reply of inner.replies) {
        const replyId = newIds.get(reply.item.id)!;
        const copyReply: ItemRecord = { ...reply.item, id: replyId, created: now, on: newIds.get(reply.item.on ?? "") ?? innerId };
        delete copyReply.modified;
        ops.push(makeOp("items", replyId, null, copyReply), makeOp("texts", replyId, null, { id: replyId, body: reply.body }));
      }
    }
  }
  return { command: { label: cards.length > 1 ? `Paste ${cards.length} items` : "Paste item", ops }, placeIds, webCopies };
}
