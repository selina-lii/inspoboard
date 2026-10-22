// Command builders. Each user action makes exactly one command.
// A builder reads the store and returns a command. It does not change the store.
// To do the action, give the command to History.run().

import { emptyCommand, makeOp, type Command, type Op } from "./commands";
import type { IdSource } from "./ids";
import { uniqueCode } from "./names";
import { outlineCleanupOps, outlineRows, withoutOutline } from "./outline";
import type { GraphIndex } from "./graph";
import { roundBoard } from "./stamps";
import type { Store } from "./store";
import {
  type Id,
  type ItemRecord,
  type MediaInfo,
  type OutlineRecord,
  type PlaceLink,
  type QuoteMarks,
  type Point3,
  type ViewStyle,
  OBJECT_VIEWS,
} from "./types";

import { requirePlace, requireRecord } from "./records";
import { deleteLinks } from "./relations";
export type ActionContext = {
  store: Store;
  graph: GraphIndex;
  newId: IdSource;
  /** Returns the current time as an ISO 8601 string. */
  now: () => string;
  /** Random numbers in [0, 1) for name codes. Tests give a fixed source. Default: Math.random. */
  random?: () => number;
};

/** The name to save: the typed name, or a new code if the name is empty. */
export function nameOrCode(context: ActionContext, name: string | undefined): { name: string; codeName: boolean } {
  const trimmed = (name ?? "").trim();
  if (trimmed !== "") return { name: trimmed, codeName: false };
  const taken = new Set<string>();
  for (const item of context.store.all("items")) taken.add(item.name);
  return { name: uniqueCode(taken, context.random), codeName: true };
}

/** Sets the name fields of an item record: a code name has `codeName: true`. */
export function withName(item: ItemRecord, named: { name: string; codeName: boolean }): ItemRecord {
  const after: ItemRecord = { ...item, name: named.name };
  if (named.codeName) after.codeName = true;
  else delete after.codeName;
  return after;
}

export type Rect = { x: number; y: number; w: number; h: number };

export const DEFAULT_SIZE: Record<ViewStyle, { w: number; h: number }> = {
  note: { w: 200, h: 160 },
  page: { w: 240, h: 320 },
  text: { w: 200, h: 40 },
  comment: { w: 220, h: 96 },
  weblink: { w: 200, h: 36 },
  todo: { w: 190, h: 110 },
  // The sticky note size (a flashcard shows at this size).
  flashcard: { w: 200, h: 160 },
  // A slim card: 320 wide, as high as its text (the height is a minimum).
  quote: { w: 320, h: 72 },
  group: { w: 480, h: 320 },
};

/** Views whose items have no name by default: the text (or the front of a flashcard) is enough. */
export const UNNAMED_VIEWS: readonly ViewStyle[] = ["note", "comment", "weblink", "todo", "flashcard", "quote", "group"];

/** The card color of an unimportant note (gray). A note without a color is yellow. */
export const NOTE_GRAY = "#a1a1a6";

/** Fluorescent film colors for action items. The card shows them half transparent. */
export const TODO_COLORS = ["#f4ff3a", "#39ff6a", "#34d8ff", "#ff4fd8", "#b06bff"] as const;

/**
 * Creates an item with empty text and places it on a board.
 * A note has no name by default. A page or a board with no name gets a code (see names.ts).
 */
export function createItemOnBoard(
  context: ActionContext,
  input: {
    boardId: Id;
    view: ViewStyle;
    x: number;
    y: number;
    name?: string;
    board?: boolean;
    /** Objects: the text, the web address, the signature, the item it is attached to, the quoted passage, the color. */
    body?: string;
    url?: string;
    author?: string;
    on?: Id;
    quote?: string;
    color?: string;
    /** A multimedia item (see media.ts), and a card size other than the default size of the view. */
    media?: MediaInfo;
    size?: { w: number; h: number };
  },
): { command: Command; itemId: Id; placeId: Id } {
  const itemId = context.newId();
  const placeId = context.newId();
  const named = UNNAMED_VIEWS.includes(input.view) && input.board !== true ? { name: (input.name ?? "").trim(), codeName: false } : nameOrCode(context, input.name);
  const item: ItemRecord = withName({ id: itemId, name: "", created: context.now() }, named);
  if (input.url !== undefined) item.url = input.url;
  if (input.author !== undefined && input.author.trim() !== "") item.author = input.author.trim();
  if (input.on !== undefined) item.on = input.on;
  if (input.quote !== undefined && input.quote !== "") item.quote = input.quote;
  if (input.media !== undefined) item.media = input.media;
  // An empty board: the item opens as a board, not as a text page.
  if (input.board === true) item.board = true;
  const size = input.size ?? DEFAULT_SIZE[input.view];
  const place: PlaceLink = {
    id: placeId,
    kind: "place",
    from: input.boardId,
    to: itemId,
    x: input.x,
    y: input.y,
    w: size.w,
    h: size.h,
    view: input.view,
  };
  // A new note (and each object) shows its text. The user can collapse a note to one line.
  if ((input.view === "note" && input.board !== true) || OBJECT_VIEWS.includes(input.view)) place.expanded = true;
  if (input.color !== undefined) place.color = input.color;
  else if (input.view === "todo") place.color = TODO_COLORS[0];
  const command: Command = {
    label: input.board === true ? "Create board" : `Create ${VIEW_LABELS[input.view]}`,
    ops: [
      makeOp("items", itemId, null, item),
      makeOp("texts", itemId, null, { id: itemId, body: input.body ?? "" }),
      makeOp("links", placeId, null, place),
    ],
  };
  return { command, itemId, placeId };
}

/** Names of views for command labels and menus. */
export const VIEW_LABELS: Record<ViewStyle, string> = {
  note: "note",
  page: "page",
  text: "text",
  comment: "comment",
  weblink: "link",
  todo: "action item",
  flashcard: "flashcard",
  quote: "quote",
  group: "group",
};

/** The marks of a quote card without its own: CJK text (Han, kana, Hangul) gets 「 」, other text ‘ ’. */
export function defaultQuoteMarks(text: string): QuoteMarks {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text) ? "cjk" : "en";
}

/** Sets the quotation marks of a quote card. */
export function setQuoteMarks(context: ActionContext, placeId: Id, marks: QuoteMarks): Command {
  const before = context.store.get("links", placeId);
  if (before === undefined || before.kind !== "place") throw new Error(`Link "${placeId}" is not a place link.`);
  if (before.marks === marks) return emptyCommand("Change quotation marks");
  const after: PlaceLink = { ...before, marks };
  return { label: "Change quotation marks", ops: [makeOp("links", placeId, before, after)] };
}

/** A group card: filled with its color, or only its outline. */
export function setGroupFilled(context: ActionContext, placeId: Id, filled: boolean): Command {
  const before = context.store.get("links", placeId);
  if (before === undefined || before.kind !== "place") throw new Error(`Link "${placeId}" is not a place link.`);
  if ((before.filled === true) === filled) return emptyCommand("Change group look");
  const after: PlaceLink = { ...before };
  if (filled) after.filled = true;
  else delete after.filled;
  return { label: "Change group look", ops: [makeOp("links", placeId, before, after)] };
}

/** Sets the web address of a link object. */
export function setItemUrl(context: ActionContext, itemId: Id, url: string): Command {
  const before = requireRecord(context.store.get("items", itemId), "items", itemId);
  const value = url.trim();
  if ((before.url ?? "") === value) return emptyCommand("Change URL");
  const after: ItemRecord = { ...before, modified: context.now() };
  if (value === "") delete after.url;
  else after.url = value;
  return { label: "Change URL", ops: [makeOp("items", itemId, before, after)] };
}

/** A reply to a comment: a comment item attached to it, with no placement (it shows in the thread). */
export function createReply(context: ActionContext, commentId: Id, author: string, body = ""): { command: Command; itemId: Id } {
  requireRecord(context.store.get("items", commentId), "items", commentId);
  const itemId = context.newId();
  const item: ItemRecord = { id: itemId, name: "", created: context.now(), on: commentId };
  if (author.trim() !== "") item.author = author.trim();
  return {
    command: { label: "Reply", ops: [makeOp("items", itemId, null, item), makeOp("texts", itemId, null, { id: itemId, body })] },
    itemId,
  };
}

/**
 * Puts a comment or note attached to an item (`on`; a page has inside links instead) at a place in its window:
 * [x, y] (px) from the top-right corner of the text. Null puts it back in the column at the right edge of the text.
 */
export function setPageAt(context: ActionContext, itemId: Id, spot: [number, number] | null): Command {
  const before = requireRecord(context.store.get("items", itemId), "items", itemId);
  const rounded = spot === null ? null : (spot.map((value) => Math.round(value)) as [number, number]);
  if (rounded?.[0] === before.pageAt?.[0] && rounded?.[1] === before.pageAt?.[1]) return emptyCommand("Move in page");
  const after: ItemRecord = { ...before };
  if (rounded === null) delete after.pageAt;
  else after.pageAt = rounded;
  return { label: "Move in page", ops: [makeOp("items", itemId, before, after)] };
}

/** Resolves a comment thread (it is hidden and stays), or opens it again. */
export function setResolved(context: ActionContext, commentId: Id, resolved: boolean): Command {
  const before = requireRecord(context.store.get("items", commentId), "items", commentId);
  if ((before.resolved === true) === resolved) return emptyCommand(resolved ? "Resolve" : "Reopen");
  const after: ItemRecord = { ...before };
  if (resolved) after.resolved = true;
  else delete after.resolved;
  return { label: resolved ? "Resolve comment" : "Reopen comment", ops: [makeOp("items", commentId, before, after)] };
}

/** The comment and all replies under it (replies of replies too). */
export function threadOf(context: { store: Store; graph: GraphIndex }, commentId: Id): Id[] {
  const ids: Id[] = [];
  const walk = (id: Id) => {
    if (ids.includes(id)) return;
    ids.push(id);
    for (const reply of context.graph.attachedTo(id)) walk(reply.id);
  };
  walk(commentId);
  return ids;
}

/** Deletes a comment with its replies (and their placements). Undo brings them back. */
export function deleteThread(context: ActionContext, commentId: Id): Command {
  return { ...completeItems(context, threadOf(context, commentId)), label: "Delete comment" };
}

/** Attaches an object (comment, link) to an item, or makes it free (null). */
export function attachItem(context: ActionContext, itemId: Id, target: Id | null): Command {
  const before = requireRecord(context.store.get("items", itemId), "items", itemId);
  if ((before.on ?? null) === target) return emptyCommand("Attach");
  const after: ItemRecord = { ...before };
  if (target === null) {
    delete after.on;
    delete after.quote;
  } else after.on = target;
  return { label: target === null ? "Detach" : "Attach", ops: [makeOp("items", itemId, before, after)] };
}

/**
 * Finishes action items: "Done" removes them. The item, its text, and its placements go. Undo brings them back.
 */
export function completeItems(context: ActionContext, itemIds: readonly Id[]): Command {
  const ops: Op[] = [];
  for (const itemId of new Set(itemIds)) {
    const places = context.graph.parentsOf(itemId);
    ops.push(...places.map((place) => makeOp("links", place.id, place, null)), ...outlineCleanupOps(context, places));
    // A small item inside a page: its inside link goes too.
    const inside = context.graph.insideHomeOf(itemId);
    if (inside !== undefined) ops.push(makeOp("links", inside.id, inside, null));
    ops.push(...deleteItem(context, itemId).ops);
  }
  return { label: itemIds.length > 1 ? `Done (${itemIds.length})` : "Done", ops };
}

/** Creates a new outline at a board point, with one new page as its first row. One command. */
export function createOutlineWithPage(context: ActionContext, boardId: Id, x: number, y: number): { command: Command; outlineId: Id; placeId: Id } {
  const created = createItemOnBoard(context, { boardId, view: "page", x, y });
  const outlineId = context.newId();
  const ops: Op[] = created.command.ops.map((op) =>
    op.table === "links" && op.id === created.placeId && op.after !== null ? { ...op, after: { ...(op.after as PlaceLink), outline: outlineId, rank: 0 } } : op,
  );
  ops.push(makeOp("outlines", outlineId, null, { id: outlineId, board: boardId, x, y }));
  return { command: { label: "New outline", ops }, outlineId, placeId: created.placeId };
}

/**
 * Places an existing record (item, stamp, or ghost) on a board.
 * An item lives on one board only. If it has a home already, the new placement is a reference.
 */
export function placeRecord(
  context: ActionContext,
  input: { boardId: Id; recordId: Id; view: ViewStyle } & Rect,
): { command: Command; placeId: Id } {
  const placeId = context.newId();
  const place: PlaceLink = {
    id: placeId,
    kind: "place",
    from: input.boardId,
    to: input.recordId,
    x: input.x,
    y: input.y,
    w: input.w,
    h: input.h,
    view: input.view,
  };
  const hasHome = context.store.has("items", input.recordId) && context.graph.homeOf(input.recordId) !== undefined;
  if (hasHome) place.ref = true;
  return { command: { label: hasHome ? "Show reference" : "Place on board", ops: [makeOp("links", placeId, null, place)] }, placeId };
}

/**
 * Renames an item. An empty name gives the item a new code (see names.ts).
 * `allowEmpty`: an empty name stays empty (notes can have no name).
 */
export function renameItem(context: ActionContext, itemId: Id, newName: string, options: { allowEmpty?: boolean } = {}): Command {
  const before = requireRecord(context.store.get("items", itemId), "items", itemId);
  // An item with a code keeps it when the name stays empty.
  if (newName.trim() === "" && before.codeName === true && options.allowEmpty !== true) return emptyCommand("Rename");
  const named = options.allowEmpty === true && newName.trim() === "" ? { name: "", codeName: false } : nameOrCode(context, newName);
  if (before.name === named.name && (before.codeName === true) === named.codeName) return emptyCommand("Rename");
  return { label: "Rename", ops: [makeOp("items", itemId, before, { ...withName(before, named), modified: context.now() })] };
}

/** Sets the subtitle of a page (one line). An empty text removes it. */
export function setItemSubtitle(context: ActionContext, itemId: Id, subtitle: string): Command {
  const before = requireRecord(context.store.get("items", itemId), "items", itemId);
  const value = subtitle.replace(/\s+/g, " ").trim();
  if ((before.subtitle ?? "") === value) return emptyCommand("Change subtitle");
  const after: ItemRecord = { ...before, modified: context.now() };
  if (value === "") delete after.subtitle;
  else after.subtitle = value;
  return { label: "Change subtitle", ops: [makeOp("items", itemId, before, after)] };
}

/** Puts the stub of a linked record (not on this board) at [x, y] from the top-right corner of the card. */
export function setStubPlace(context: ActionContext, placeId: Id, otherId: Id, at: [number, number]): Command {
  const before = requirePlace(context, placeId);
  const rounded: [number, number] = [roundBoard(at[0]), roundBoard(at[1])];
  const old = before.stubs?.[otherId];
  if (old !== undefined && old[0] === rounded[0] && old[1] === rounded[1]) return emptyCommand("Move stub");
  return { label: "Move stub", ops: [makeOp("links", placeId, before, { ...before, stubs: { ...before.stubs, [otherId]: rounded } })] };
}

/** Sets the date that the user types. An empty string removes it. */
export function setItemDate(context: ActionContext, itemId: Id, date: string): Command {
  const before = requireRecord(context.store.get("items", itemId), "items", itemId);
  const value = date.trim();
  if ((before.date ?? "") === value) return emptyCommand("Change date");
  const after: ItemRecord = { ...before };
  if (value === "") delete after.date;
  else after.date = value;
  return { label: "Change date", ops: [makeOp("items", itemId, before, after)] };
}

export function setStampAlt(context: ActionContext, stampId: Id, alt: string): Command {
  const before = requireRecord(context.store.get("stamps", stampId), "stamps", stampId);
  if (before.alt === alt) return emptyCommand("Change alt text");
  return { label: "Change alt text", ops: [makeOp("stamps", stampId, before, { ...before, alt })] };
}

/** Moves or resizes placements in 2D. One command for all placements. */
export function setPlacementRects(context: ActionContext, rects: ReadonlyMap<Id, Partial<Rect>>): Command {
  const ops: Op[] = [];
  for (const [placeId, rect] of rects) {
    const before = requirePlace(context, placeId);
    const after: PlaceLink = { ...before, ...rect };
    if (!samePlacement(before, after)) ops.push(makeOp("links", placeId, before, after));
  }
  return { label: ops.length > 1 ? `Move ${ops.length} records` : "Move", ops };
}

/** Moves placements in 3D. One command for all placements. */
export function setPlacement3d(context: ActionContext, positions: ReadonlyMap<Id, Point3>): Command {
  const ops: Op[] = [];
  for (const [placeId, p3] of positions) {
    const before = requirePlace(context, placeId);
    ops.push(makeOp("links", placeId, before, { ...before, p3: [p3[0], p3[1], p3[2]] }));
  }
  return { label: "Move in 3D", ops };
}

/** Shows or hides the text of a card. A card that is not expanded shows only its name. */
export function setPlacementExpanded(context: ActionContext, placeId: Id, expanded: boolean): Command {
  const before = requirePlace(context, placeId);
  if ((before.expanded ?? false) === expanded) return emptyCommand(expanded ? "Expand" : "Collapse");
  const after: PlaceLink = { ...before };
  if (expanded) after.expanded = true;
  else delete after.expanded;
  return { label: expanded ? "Expand" : "Collapse", ops: [makeOp("links", placeId, before, after)] };
}

/** The state of a card: a reduced item shown as a note or a page, or a board. */
export type CardState = "note" | "page" | "board";

/**
 * Sets the state of a card. One command.
 * - "note" or "page": the view of this card, and the item is no longer a board.
 * - "board": the item becomes a board everywhere.
 * An item with children is always a board. Then only reduceBoard() can change it.
 */
export function setCardState(context: ActionContext, placeId: Id, state: CardState): Command {
  const place = requirePlace(context, placeId);
  const item = requireRecord(context.store.get("items", place.to), "items", place.to);
  // Item children make a board. Scribbles alone do not (a note can hold scribbles).
  if (context.graph.childrenOf(item.id).some((child) => !context.store.has("stamps", child.to))) return emptyCommand("Change state");
  const ops: Op[] = [];
  if (state === "board") {
    if (item.board !== true) ops.push(makeOp("items", item.id, item, { ...item, board: true }));
    return { label: "Make board", ops };
  }
  if (item.board === true) {
    const after: ItemRecord = { ...item };
    delete after.board;
    ops.push(makeOp("items", item.id, item, after));
  }
  if (place.view !== state) ops.push(makeOp("links", place.id, place, { ...place, view: state }));
  return { label: state === "note" ? "Show as note" : "Show as page", ops };
}

/**
 * Reduces a board with exactly one child to a normal item. One command.
 * The child moves out of the item onto the board of the card, to the right of the card.
 */
export function reduceBoard(context: ActionContext, placeId: Id): Command {
  const place = requirePlace(context, placeId);
  const item = requireRecord(context.store.get("items", place.to), "items", place.to);
  const children = context.graph.childrenOf(item.id);
  const inner = children[0];
  if (children.length !== 1 || inner === undefined) return emptyCommand("Reduce board");
  const moved: PlaceLink = { ...inner, id: context.newId(), from: place.from, x: place.x + place.w + 40, y: place.y };
  delete moved.p3;
  const ops: Op[] = [makeOp("links", inner.id, inner, null), makeOp("links", moved.id, null, moved)];
  if (item.board === true) {
    const after: ItemRecord = { ...item };
    delete after.board;
    ops.push(makeOp("items", item.id, item, after));
  }
  return { label: "Reduce board", ops };
}

/** Space between the cards of a board and records that move in. */
const MOVE_IN_GAP = 40;

/**
 * Moves placements to a different board. One command. Only the place links (and the outlines that move) change:
 * the records, their links, and their text stay the same.
 * - The records keep their layout relative to each other.
 * - The group goes to the right of the cards on the target board (or to 0, 0 on an empty board).
 * - A record cannot move into itself. Such a placement stays where it is.
 * - Outlines keep their tree. A row brings its child rows. An outline (or a calendar) in `outlineIds`, or one whose
 *   rows all move, moves as it is. Some rows of an outline: they make a new outline on the target board (the moved
 *   rows whose parent stays become its top rows). Some cards of a calendar leave their days.
 */
export function moveIntoBoard(context: ActionContext, placeIds: readonly Id[], targetBoardId: Id, outlineIds: readonly Id[] = []): Command {
  const isMovable = (place: PlaceLink) => place.to !== targetBoardId && place.from !== targetBoardId;
  const moving = new Map<Id, PlaceLink>();
  for (const place of placeIds.map((placeId) => requirePlace(context, placeId))) if (isMovable(place)) moving.set(place.id, place);
  const groups = outlineIds.flatMap((id) => {
    const group = context.store.get("outlines", id);
    return group !== undefined && group.board !== targetBoardId ? [group] : [];
  });
  for (const group of groups) for (const place of context.graph.membersOf(group.id)) if (isMovable(place)) moving.set(place.id, place);
  // A row brings its child rows (all levels).
  for (const outlineId of new Set([...moving.values()].flatMap((place) => (place.outline === undefined ? [] : [place.outline])))) {
    const rows = outlineRows(context.store, context.graph, outlineId);
    for (const row of rows) {
      if (moving.has(row.placeId) || row.parentPlaceId === null || !moving.has(row.parentPlaceId)) continue;
      const place = requirePlace(context, row.placeId);
      if (isMovable(place)) moving.set(place.id, place);
    }
  }
  if (moving.size === 0) return emptyCommand("Move into board");
  const places = [...moving.values()];
  // The groups whose cards all move go as they are.
  const whole = new Map<Id, OutlineRecord>();
  for (const outlineId of new Set(places.flatMap((place) => (place.outline === undefined ? [] : [place.outline])))) {
    const group = context.store.get("outlines", outlineId);
    if (group !== undefined && group.board !== targetBoardId && context.graph.membersOf(outlineId).every((place) => moving.has(place.id))) whole.set(outlineId, group);
  }
  const corners = [...places.filter((place) => place.outline === undefined || !whole.has(place.outline)), ...whole.values()];
  const minX = Math.min(...corners.map((corner) => corner.x));
  const minY = Math.min(...corners.map((corner) => corner.y));
  const existing = context.graph.childrenOf(targetBoardId);
  const originX = existing.length === 0 ? 0 : Math.max(...existing.map((place) => place.x + place.w)) + MOVE_IN_GAP;
  const originY = existing.length === 0 ? 0 : Math.min(...existing.map((place) => place.y));
  const at = (corner: { x: number; y: number }) => ({ x: originX + (corner.x - minX), y: originY + (corner.y - minY) });
  const ops: Op[] = [];
  for (const group of whole.values()) ops.push(makeOp("outlines", group.id, group, { ...group, board: targetBoardId, ...at(group) }));
  // Some rows of an outline: a new outline on the target board, with the same look.
  const split = new Map<Id, { id: Id; rank: number }>();
  for (const place of places) {
    const old = place.outline === undefined ? undefined : context.store.get("outlines", place.outline);
    if (old === undefined || old.type !== undefined || whole.has(old.id) || split.has(old.id)) continue;
    const id = context.newId();
    split.set(old.id, { id, rank: 0 });
    const rows = places.filter((other) => other.outline === old.id);
    const outline: OutlineRecord = { id, board: targetBoardId, ...at({ x: Math.min(...rows.map((row) => row.x)), y: Math.min(...rows.map((row) => row.y)) }) };
    if (old.list !== undefined) outline.list = old.list;
    if (old.direction !== undefined) outline.direction = old.direction;
    ops.push(makeOp("outlines", id, null, outline));
  }
  const ordered = [...split.keys()].flatMap((outlineId) => outlineRows(context.store, context.graph, outlineId).filter((row) => moving.has(row.placeId)).map((row) => moving.get(row.placeId)!));
  const orderedIds = new Set(ordered.map((place) => place.id));
  for (const place of [...ordered, ...places.filter((place) => !orderedIds.has(place.id))]) {
    // A 3D position belongs to the old board. The new board derives a 3D position from the 2D layout.
    let after: PlaceLink;
    const target = place.outline === undefined ? undefined : split.get(place.outline);
    if (place.outline !== undefined && whole.has(place.outline)) after = { ...place, from: targetBoardId, ...at(place) };
    else if (target !== undefined) {
      after = { ...place, from: targetBoardId, ...at(place), outline: target.id };
      if (place.parent === undefined || !moving.has(place.parent)) {
        delete after.parent;
        after.rank = target.rank;
        target.rank += 1;
      }
    } else after = { ...withoutOutline(place), from: targetBoardId, ...at(place) };
    delete after.p3;
    ops.push(makeOp("links", place.id, place, after));
  }
  return { label: places.length > 1 ? `Move ${places.length} records into board` : "Move into board", ops };
}

/**
 * Moves a scribble into a note. The note then holds the scribble: it moves with the note
 * and stays inside it. The scribble keeps its place on the screen (inside the note bounds).
 */
export function moveIntoNote(context: ActionContext, stampPlaceId: Id, notePlaceId: Id, at?: { x: number; y: number }): Command {
  const stampPlace = requirePlace(context, stampPlaceId);
  const note = requirePlace(context, notePlaceId);
  if (!context.store.has("stamps", stampPlace.to) || !context.store.has("items", note.to)) return emptyCommand("Move into note");
  // `at`: the board position of the scribble at the drop. Default: its saved position.
  const origin = at ?? stampPlace;
  const x = clamp(origin.x - note.x, 0, Math.max(0, note.w - stampPlace.w));
  const y = clamp(origin.y - note.y, 0, Math.max(0, note.h - stampPlace.h));
  const after: PlaceLink = { ...withoutOutline(stampPlace), from: note.to, x: roundBoard(x), y: roundBoard(y) };
  delete after.p3;
  return { label: "Move into note", ops: [makeOp("links", stampPlace.id, stampPlace, after), ...outlineCleanupOps(context, [stampPlace])] };
}

/** Moves the scribbles of a note out onto the board of the note card. They keep their place on the screen. */
export function releaseFromNote(context: ActionContext, notePlaceId: Id): Command {
  const note = requirePlace(context, notePlaceId);
  const ops = context.graph
    .childrenOf(note.to)
    .filter((place) => context.store.has("stamps", place.to))
    .map((place) => makeOp("links", place.id, place, { ...place, from: note.from, x: roundBoard(note.x + place.x), y: roundBoard(note.y + place.y) }));
  return { label: "Take scribbles out of note", ops };
}

/** Sets the background of a board: a color, an image path, or null (the default background). */
export function setBoardBackground(context: ActionContext, boardId: Id, background: string | null): Command {
  const before = requireRecord(context.store.get("items", boardId), "items", boardId);
  if ((before.background ?? null) === background) return emptyCommand("Change background");
  const after: ItemRecord = { ...before };
  if (background === null) delete after.background;
  else after.background = background;
  // A new image starts again at its automatic place and size (it covers the cards).
  delete after.backgroundWidth;
  delete after.backgroundCenter;
  return { label: background === null ? "Remove background" : "Change background", ops: [makeOp("items", boardId, before, after)] };
}

/** The background image of a board lies on the board (it moves and zooms with the cards), or fills the view. */
export function setBackgroundOnBoard(context: ActionContext, boardId: Id, onBoard: boolean): Command {
  const before = requireRecord(context.store.get("items", boardId), "items", boardId);
  if ((before.backgroundOnBoard === true) === onBoard) return emptyCommand("Change background");
  const after: ItemRecord = { ...before };
  if (onBoard) after.backgroundOnBoard = true;
  else delete after.backgroundOnBoard;
  return { label: onBoard ? "Background on the board" : "Background fills the view", ops: [makeOp("items", boardId, before, after)] };
}

/** The area of the cards of a board (board coordinates), or a default area if it has none. */
export function cardsArea(context: { store: Store; graph: GraphIndex }, boardId: Id): { x: number; y: number; w: number; h: number } {
  const places = context.graph.childrenOf(boardId);
  if (places.length === 0) return { x: -600, y: -400, w: 1200, h: 800 };
  const left = Math.min(...places.map((place) => place.x));
  const top = Math.min(...places.map((place) => place.y));
  const right = Math.max(...places.map((place) => place.x + place.w));
  const bottom = Math.max(...places.map((place) => place.y + place.h));
  return { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
}

/** The place for a new card at the right of the cards of a board (40 units after them, level with the top card). */
export function rightOfCards(context: { graph: GraphIndex }, boardId: Id): { x: number; y: number } {
  const places = context.graph.childrenOf(boardId);
  if (places.length === 0) return { x: 0, y: 0 };
  return { x: Math.max(...places.map((place) => place.x + place.w)) + 40, y: Math.min(...places.map((place) => place.y)) };
}

/**
 * The box of a background image on a board (board coordinates): its saved size and place, or (automatic) the size
 * that covers the area of the cards, with a margin, in its middle. `aspect`: image height / width.
 */
export function backgroundBox(context: { store: Store; graph: GraphIndex }, boardId: Id, aspect: number): { x: number; y: number; w: number; h: number } {
  const board = context.store.get("items", boardId);
  if (board?.backgroundWidth !== undefined && board.backgroundCenter !== undefined) {
    const w = board.backgroundWidth;
    const h = w * aspect;
    return { x: board.backgroundCenter[0] - w / 2, y: board.backgroundCenter[1] - h / 2, w, h };
  }
  const area = cardsArea(context, boardId);
  const margin = 200;
  const width = area.w + 2 * margin;
  const height = area.h + 2 * margin;
  const w = Math.max(width, height / aspect);
  const h = w * aspect;
  return { x: area.x + area.w / 2 - w / 2, y: area.y + area.h / 2 - h / 2, w, h };
}

/** Sets the color of cards. Null gives them the color of their kind again. One command. */
export function setCardColor(context: ActionContext, placeIds: readonly Id[], color: string | null): Command {
  const ops: Op[] = [];
  for (const placeId of placeIds) {
    const before = requirePlace(context, placeId);
    if ((before.color ?? null) === color) continue;
    const after: PlaceLink = { ...before };
    if (color === null) delete after.color;
    else after.color = color;
    ops.push(makeOp("links", placeId, before, after));
  }
  return { label: color === null ? "Remove card color" : "Color cards", ops };
}

/** Collapses all expanded cards on a board: they show only their names. One command. */
export function collapseAll(context: ActionContext, boardId: Id): Command {
  const ops: Op[] = [];
  for (const place of context.graph.childrenOf(boardId)) {
    if (place.expanded !== true) continue;
    const after: PlaceLink = { ...place };
    delete after.expanded;
    ops.push(makeOp("links", place.id, place, after));
  }
  return { label: "Collapse all", ops };
}

/** Removes records from a board. The records stay. Only the place links are deleted. */
export function removeFromBoard(context: ActionContext, placeIds: readonly Id[]): Command {
  const places = placeIds.map((placeId) => requirePlace(context, placeId));
  const ops = [...places.map((place) => makeOp("links", place.id, place, null)), ...outlineCleanupOps(context, places)];
  return { label: "Remove from board", ops };
}

/**
 * Deletes an item record and its body text. All links stay.
 * The item becomes a ghost node and stays a bridge in the graph.
 */
export function deleteItem(context: ActionContext, itemId: Id): Command {
  const item = requireRecord(context.store.get("items", itemId), "items", itemId);
  const text = context.store.get("texts", itemId) ?? null;
  const ops: Op[] = [makeOp("items", itemId, item, null)];
  if (text !== null) ops.push(makeOp("texts", itemId, text, null));
  return { label: "Delete item", ops };
}

/** Deletes all links of a ghost. The user must confirm before this action. */
export function deleteGhost(context: ActionContext, ghostId: Id): Command {
  if (!context.graph.isGhost(ghostId)) {
    throw new Error(`Record "${ghostId}" exists. It is not a ghost.`);
  }
  const linkIds = new Set<Id>();
  for (const link of context.graph.childrenOf(ghostId)) linkIds.add(link.id);
  for (const link of context.graph.parentsOf(ghostId)) linkIds.add(link.id);
  for (const link of context.graph.relationsFrom(ghostId)) linkIds.add(link.id);
  for (const link of context.graph.relationsTo(ghostId)) linkIds.add(link.id);
  return { ...deleteLinks(context, [...linkIds]), label: "Delete ghost" };
}

/**
 * Sets the body text of an item and its "modified" time. This is not a command:
 * the editor has its own undo stack. Returns false if the text did not change.
 */
/**
 * Replaces the names and texts of items (for example a script conversion by a plugin). One command: one undo.
 * A code name (made by the app) does not change. Items that are gone are skipped.
 */
export function replaceItemTexts(context: ActionContext, changes: readonly { id: Id; name: string; body: string }[], label: string): Command {
  const ops: Op[] = [];
  const now = context.now();
  for (const change of changes) {
    const item = context.store.get("items", change.id);
    if (item === undefined) continue;
    const text = context.store.get("texts", change.id);
    const rename = item.codeName !== true && change.name !== item.name;
    const rewrite = (text?.body ?? "") !== change.body;
    if (!rename && !rewrite) continue;
    ops.push(makeOp("items", item.id, item, { ...item, name: rename ? change.name : item.name, modified: now }));
    if (rewrite) ops.push(makeOp("texts", item.id, text ?? null, { id: item.id, body: change.body }));
  }
  return { label, ops };
}

export function writeText(
  store: Store,
  itemId: Id,
  body: string,
  now: string = new Date().toISOString(),
  /** Other records that change with the text, in the same write (for example the link ends of moved passages). */
  also: Parameters<Store["write"]>[0] = [],
): boolean {
  const item = requireRecord(store.get("items", itemId), "items", itemId);
  const before = store.get("texts", itemId);
  if (before !== undefined && before.body === body) return false;
  store.write([
    { table: "texts", id: itemId, after: { id: itemId, body } },
    { table: "items", id: itemId, after: { ...item, modified: now } },
    ...also,
  ]);
  return true;
}

function samePlacement(a: PlaceLink, b: PlaceLink): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}


// The builders of scribbles and of relation links have their own files. They are part of this API.
export { emptyCommand } from "./commands";
export * from "./scribbles";
export * from "./relations";
