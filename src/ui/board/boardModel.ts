// Board model: what one board shows. This is a pure function of the store.
// It has no React and no React Flow. The adapter (BoardView) converts it for React Flow.
// See docs/SPEC.md section 7.1.

import type { GraphIndex } from "../../core/graph";
import { outlineLayout, outlineRows, parentPairs, sequencePairs } from "../../core/outline";
import { boardGroupType, calendarSize, CALENDAR, daysBetween, daysOf, defaultMonth, gridDays, isCalendar, monthsOf, monthOf, dayOrder } from "../../core/groups";
import type { Store } from "../../core/store";
import { DEFAULT_END_CAP, DEFAULT_START_CAP, type GroupShape, type Id, type LinkCap, type ListStyle, type PlaceLink, type QuoteMarks, type ViewStyle } from "../../core/types";
import { defaultQuoteMarks } from "../../core/actions";

export type BoardNodeKind = "item" | "stamp" | "ghost" | "stub" | "outline" | "calendar";

/** `spanOffset`: days from the card day to the first day of this box. `more`: the other week rows of a card on more than one day. */
type CalendarBox = { x: number; y: number; w: number; h: number; expanded: boolean; popped: boolean; calendarId: Id; frameId: string; timeLabel: string; spanOffset: number; more: CalendarBox[] };

/** "09:30–11:00" → "9:30–11:00". */
function timeLabelOf(time: string | undefined): string {
  return time === undefined ? "" : time.replace(/(^|–)0(\d)/g, "$1$2");
}

/**
 * The cards of a calendar in its shown month (see docs/SPEC.md section 7.6):
 * - A card on more than one day is a bar across its days, one bar for each week row. Each bar is a full card node
 *   (the same name and text, clickable). Bars stack in lanes at the top of the week row.
 * - Cards on one day are under the lanes of their week, in the order of their time (cards with no time first).
 * - A card that is alone in its days (in that week row) can show its text (its own fold state).
 * Cards with no day in the shown month do not show (the days of the months before and after hold no cards).
 */
function layoutCalendar(store: Store, graph: GraphIndex, calendar: { id: Id; x: number; y: number }, month: string, frameId: string, frame: BoardNode, boxes: Map<Id, CalendarBox>, hidden: Set<Id>, popped: ReadonlySet<Id>): void {
  // The 42 days of the grid. Only days of the shown month hold cards: a card on a day of the month before or after
  // does not show there (a card on more than one day shows only its days in this month).
  const days = gridDays(month);
  const slotOf = new Map(days.flatMap((day, index) => (day.startsWith(month) ? [[day, index] as const] : [])));
  const row = (slot: number) => Math.floor(slot / 7);
  const cellTop = (rowIndex: number) => calendar.y + CALENDAR.bar + CALENDAR.weekdays + rowIndex * CALENDAR.cellH + CALENDAR.dayTop;
  const cellLeft = (column: number) => calendar.x + CALENDAR.pad + column * CALENDAR.cellW;
  const lineHeight = COLLAPSED_HEIGHT - 4;
  const free = CALENDAR.cellH - CALENDAR.dayTop - 6;
  /** An opened card in a full day (quick view): its top stays, and it reaches the bottom of its day, over its neighbors. */
  const cellBottom = (rowIndex: number) => calendar.y + CALENDAR.bar + CALENDAR.weekdays + (rowIndex + 1) * CALENDAR.cellH - 4;
  const poppedHeight = (rowIndex: number, top: number) => Math.max(COLLAPSED_HEIGHT - 6, cellBottom(rowIndex) - top);
  type Segment = { place: PlaceLink; rowIndex: number; from: number; to: number; lane: number };
  const segments: Segment[] = [];
  const singles = new Map<number, PlaceLink[]>();
  for (const place of graph.membersOf(calendar.id)) {
    if (place.day === undefined || store.has("stamps", place.to)) continue;
    const slots = daysOf(place).flatMap((day) => (slotOf.has(day) ? [slotOf.get(day)!] : []));
    if (slots.length === 0) {
      hidden.add(place.id);
      continue;
    }
    if (place.until === undefined) {
      singles.set(slots[0]!, [...(singles.get(slots[0]!) ?? []), place]);
      continue;
    }
    for (const rowIndex of [...new Set(slots.map(row))]) {
      const inRow = slots.filter((slot) => row(slot) === rowIndex);
      segments.push({ place, rowIndex, from: Math.min(...inRow) % 7, to: Math.max(...inRow) % 7, lane: 0 });
    }
  }
  // Lanes: in each week row, a bar takes the first lane that is free over its days.
  const lanes = new Map<number, number>();
  for (let rowIndex = 0; rowIndex < 6; rowIndex += 1) {
    const ends: number[] = [];
    const inRow = segments.filter((segment) => segment.rowIndex === rowIndex).sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from));
    for (const segment of inRow) {
      let lane = ends.findIndex((end) => end < segment.from);
      if (lane === -1) lane = ends.length;
      ends[lane] = segment.to;
      segment.lane = lane;
    }
    lanes.set(rowIndex, ends.length);
  }
  // A card on more than one week row looks the same in each row: it is open only if it is alone in all its rows.
  const aloneIn = (segment: Segment) => lanes.get(segment.rowIndex) === 1 && [...singles.keys()].every((slot) => row(slot) !== segment.rowIndex || slot % 7 < segment.from || slot % 7 > segment.to);
  const crowded = new Set(segments.filter((segment) => !aloneIn(segment)).map((segment) => segment.place.id));
  for (const segment of segments.sort((a, b) => a.rowIndex - b.rowIndex)) {
    const { place, rowIndex } = segment;
    const box = { x: cellLeft(segment.from) + 5, y: cellTop(rowIndex) + segment.lane * lineHeight, w: (segment.to - segment.from + 1) * CALENDAR.cellW - 10, h: COLLAPSED_HEIGHT - 6 };
    const open = !crowded.has(place.id) && place.expanded === true;
    const pop = !open && popped.has(place.id);
    const firstDay = days[rowIndex * 7 + segment.from]!;
    const part: CalendarBox = { ...box, h: open ? free : pop ? poppedHeight(rowIndex, box.y) : box.h, expanded: open || pop, popped: pop, calendarId: calendar.id, frameId, timeLabel: "", spanOffset: daysBetween(place.day!, firstDay), more: [] };
    const first = boxes.get(place.id);
    if (first === undefined) boxes.set(place.id, part);
    else first.more.push(part);
  }
  for (const [slot, places] of singles) {
    const ordered = [...places].sort(dayOrder(store));
    const before = lanes.get(row(slot)) ?? 0;
    ordered.forEach((place, index) => {
      const open = ordered.length === 1 && before === 0 && place.expanded === true;
      const pop = !open && popped.has(place.id);
      const top = cellTop(row(slot)) + (before + index) * lineHeight;
      boxes.set(place.id, {
        x: cellLeft(slot % 7) + 5,
        y: top,
        w: CALENDAR.cellW - 10,
        h: open ? free : pop ? poppedHeight(row(slot), top) : COLLAPSED_HEIGHT - 6,
        expanded: open || pop,
        popped: pop,
        calendarId: calendar.id,
        frameId,
        timeLabel: timeLabelOf(place.time),
        spanOffset: 0,
        more: [],
      });
    });
  }
}

/** Height of a card that shows only its name. */
export const COLLAPSED_HEIGHT = 36;
/** Space around the rows of an outline frame, and the height of its top bar. */
export const OUTLINE_PADDING = 12;
export const OUTLINE_BAR = 26;

/** A scribble that a note holds. Its position is relative to the note card. */
/** `color`: the ink of the scribble (the place link color), or null for the theme ink. */
export type InnerStamp = { placeId: Id; stampId: Id; x: number; y: number; w: number; h: number; path: string; alt: string; color: string | null };

export type BoardNode = {
  /** Node ID. For placed records it is the place link ID. */
  id: string;
  kind: BoardNodeKind;
  /** The record that the node shows. For a stub, the record at the other end. */
  recordId: Id;
  /** Place link ID. Stubs have none. */
  placeId: Id | null;
  view: ViewStyle;
  /** True if the card shows its text. */
  expanded: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  /** True if the title is a code that the app made (see names.ts). It shows in a low-profile style. */
  codeName: boolean;
  preview: string;
  /** A quote card: its quotation marks (from its placement, else from its text). */
  marks: QuoteMarks;
  childCount: number;
  /** True if the item is a board: it has item children, or the user made it a board. */
  isBoard: boolean;
  stamp?: { path: string; alt: string; w: number; h: number };
  /** True if the item lives on a different board. The card is a reference: a ghost with a dashed outline. */
  isReference: boolean;
  /** The outline that holds the card, or the outline of an outline frame node. */
  outlineId: Id | null;
  /** Outline frame: the node ID of the frame. React Flow moves the cards with their frame. */
  frameId: string | null;
  /** Bullet or number of an outline row. */
  marker: string;
  /** Outline frame: the list style. */
  list: ListStyle | null;
  /** Scribbles inside the card (a note can hold scribbles). */
  innerStamps: InnerStamp[];
  /** Card color "#rrggbb", or null for the color of the card kind. */
  color: string | null;
  /** Group frame: the group name (empty: none). */
  groupName: string;
  /** Calendar frame: the shown month "YYYY-MM", and all months of its range. */
  month: string;
  months: string[];
  /** A card in a calendar: it has a fixed size in its day. */
  inCalendar: boolean;
  /** A calendar card in a full day that the user opened: it shows its text over its neighbors (view state). */
  calendarPopped: boolean;
  /** A calendar card at a time: "9:30" or "9:30–11:00" (shows before its name). Else "". */
  timeLabel: string;
  /**
   * A calendar card on more than one day: days from the card day to the first day of this bar. Each week row is one
   * node: the first has the place ID as node ID, the others "<place ID>~<n>" (same place, same item).
   */
  spanOffset: number;
  /** Objects: the web address (link), the signature and the creation time (comment). */
  url: string;
  author: string;
  created: string;
  /** A comment on a text passage: the passage. */
  quote: string;
  /** A comment: its replies (replies of replies too), oldest first. */
  replies: { id: Id; author: string; created: string; text: string }[];
  /** True if the object shows at the side of its card (its card is on this board). It moves with that card. */
  pinned: boolean;
  /** An attached object (comment, link): the item it belongs to. It shows at the side of that card. */
  attachedTo: Id | null;
  /** A board that holds only one group is that kind of board. */
  boardGroup: "outline" | "calendar" | null;
  /** A group card (view "group"): its shape, and the path of a free shape (else ""). */
  shape: GroupShape;
  shapePath: string;
  /** A group card: filled with its color (else only its outline). */
  filled: boolean;
  /** A page card: the number of open comments in the page. The card shows a dot if it is above 0. */
  openComments: number;
};

/** View state of a board that is not saved: the month that each calendar shows. */
export type BoardViewState = {
  months?: ReadonlyMap<Id, string>;
  today?: string;
  /** Calendar cards that the user opened in a full day: they show open over their neighbors. Not saved. */
  popped?: ReadonlySet<Id>;
};

export type BoardEdgeKind = "relation" | "sequence" | "outline-child" | "attach";

export type BoardEdge = {
  id: string;
  kind: BoardEdgeKind;
  source: string;
  target: string;
  /** Relation link ID. Derived outline lines have none. */
  linkId: Id | null;
  label?: string;
  group?: string;
  start: LinkCap;
  end: LinkCap;
  /**
   * Side offset in board units. Several relations between the same two cards are drawn side by side.
   * The offset is measured to the left of the line from the lower node ID to the higher node ID,
   * so that relations in both directions share one order.
   */
  offset: number;
};

/** Distance between parallel lines of one card pair. */
export const PARALLEL_GAP = 10;

export type BoardModel = { nodes: BoardNode[]; edges: BoardEdge[] };

const STUB_GAP = 48;
const STUB_HEIGHT = 28;
const STUB_WIDTH = 140;
const PREVIEW_LENGTH = 280;

/** True if the card shows only its name. Text cards and scribbles always show their content. */
export function isCollapsedPlace(store: Store, graph: GraphIndex, place: PlaceLink): boolean {
  if (store.has("stamps", place.to) || !store.has("items", place.to)) return false;
  const board = graph.isBoardItem(place.to);
  if (!board && place.view === "text") return false;
  return place.expanded !== true;
}

/** The height of a card on the board. */
export function cardHeight(store: Store, graph: GraphIndex, place: PlaceLink): number {
  return isCollapsedPlace(store, graph, place) ? COLLAPSED_HEIGHT : place.h;
}

/** Space between a card and the objects attached to it. */
const ATTACH_GAP = 18;

export function buildBoardModel(store: Store, graph: GraphIndex, boardId: Id, view: BoardViewState = {}): BoardModel {
  const today = view.today ?? new Date().toISOString();
  const nodes: BoardNode[] = [];
  const edges: BoardEdge[] = [];
  /** Record ID -> node of its first placement on this board. */
  const nodeOfRecord = new Map<Id, BoardNode>();
  /** Place link ID -> node. */
  const nodeOfPlace = new Map<Id, BoardNode>();

  // Outline frames come first: React Flow needs a parent node before its child nodes.
  const outlineLines: { kind: "sequence" | "outline-child"; from: Id; to: Id }[] = [];
  const outlinePositions = new Map<Id, { x: number; y: number; outlineId: Id; frameId: string; marker: string }>();
  /** Calendar cards in the shown month: their box. Cards of other months do not show. */
  const calendarBoxes = new Map<Id, CalendarBox>();
  const hiddenPlaces = new Set<Id>();
  for (const outline of graph.outlinesOn(boardId)) {
    if (isCalendar(outline)) {
      const months = monthsOf(outline, monthOf(today));
      const requested = view.months?.get(outline.id);
      const month = requested !== undefined && months.includes(requested) ? requested : defaultMonth(outline, today);
      const frameId = `calendar:${outline.id}`;
      const size = calendarSize();
      const frame: BoardNode = { ...emptyNode(), id: frameId, kind: "calendar", recordId: outline.id, x: outline.x, y: outline.y, w: size.w, h: size.h, outlineId: outline.id, groupName: outline.name ?? "", month, months };
      nodes.push(frame);
      layoutCalendar(store, graph, outline, month, frameId, frame, calendarBoxes, hiddenPlaces, view.popped ?? new Set());
      continue;
    }
    const rows = outlineRows(store, graph, outline.id);
    if (rows.length === 0) continue;
    const positions = outlineLayout(outline, rows, store, (place) => cardHeight(store, graph, place));
    const frameId = `outline:${outline.id}`;
    let right = outline.x;
    let bottom = outline.y;
    for (const row of rows) {
      const place = store.get("links", row.placeId);
      const position = positions.get(row.placeId);
      if (place?.kind !== "place" || position === undefined) continue;
      outlinePositions.set(row.placeId, { ...position, outlineId: outline.id, frameId, marker: row.marker });
      right = Math.max(right, position.x + place.w);
      bottom = Math.max(bottom, position.y + cardHeight(store, graph, place));
    }
    nodes.push({
      ...emptyNode(),
      id: frameId,
      kind: "outline",
      recordId: outline.id,
      x: outline.x - OUTLINE_PADDING,
      y: outline.y - OUTLINE_PADDING - OUTLINE_BAR,
      w: right - outline.x + 2 * OUTLINE_PADDING,
      h: bottom - outline.y + 2 * OUTLINE_PADDING + OUTLINE_BAR,
      outlineId: outline.id,
      list: outline.list ?? null,
      groupName: outline.name ?? "",
    });
    for (const [from, to] of sequencePairs(rows)) outlineLines.push({ kind: "sequence", from, to });
    for (const [from, to] of parentPairs(rows)) outlineLines.push({ kind: "outline-child", from, to });
  }

  const attachedNodes: BoardNode[] = [];
  for (const place of graph.childrenOf(boardId)) {
    // A resolved comment is hidden. It stays in the data (with its replies) until it is deleted.
    if (hiddenPlaces.has(place.id) || store.get("items", place.to)?.resolved === true) continue;
    const node = placedNode(store, graph, place);
    const inOutline = outlinePositions.get(place.id);
    if (inOutline !== undefined) {
      node.x = inOutline.x;
      node.y = inOutline.y;
      node.outlineId = inOutline.outlineId;
      node.frameId = inOutline.frameId;
      node.marker = inOutline.marker;
    }
    const inCalendar = calendarBoxes.get(place.id);
    if (inCalendar !== undefined) {
      Object.assign(node, { x: inCalendar.x, y: inCalendar.y, w: inCalendar.w, h: inCalendar.h, expanded: inCalendar.expanded, calendarPopped: inCalendar.popped, outlineId: inCalendar.calendarId, frameId: inCalendar.frameId, inCalendar: true, timeLabel: inCalendar.timeLabel, spanOffset: inCalendar.spanOffset });
    }
    if (node.attachedTo !== null) attachedNodes.push(node);
    nodes.push(node);
    // The other week rows of a calendar card on more than one day: the same card, one node for each row.
    inCalendar?.more.forEach((part, index) => {
      nodes.push({ ...node, id: `${node.id}~${index + 1}`, x: part.x, y: part.y, w: part.w, h: part.h, expanded: part.expanded, calendarPopped: part.popped, spanOffset: part.spanOffset });
    });
    nodeOfPlace.set(place.id, node);
    if (!nodeOfRecord.has(place.to) || nodeOfRecord.get(place.to)!.isReference) nodeOfRecord.set(place.to, node);
  }

  // Attached objects (comments, links) show at the right side of their card, one under the other, with a dotted line.
  const stackOf = new Map<string, number>();
  // A page holds its comments and notes: they show in the page, not on the board. The page card shows a dot for open comments.
  const inPage = new Set<BoardNode>();
  for (const node of attachedNodes) {
    const target = nodeOfRecord.get(node.attachedTo!);
    if (target === undefined || target === node) continue;
    if (isPageCard(target) && (node.view === "comment" || node.view === "note")) {
      inPage.add(node);
      if (node.view === "comment") target.openComments += 1;
      if (node.placeId !== null) nodeOfPlace.delete(node.placeId);
      if (nodeOfRecord.get(node.recordId) === node) nodeOfRecord.delete(node.recordId);
      continue;
    }
    const below = stackOf.get(target.id) ?? 0;
    node.x = target.x + target.w + ATTACH_GAP;
    node.y = target.y + below;
    node.pinned = true;
    stackOf.set(target.id, below + node.h + 8);
    edges.push({ id: `attach:${node.id}`, kind: "attach", source: node.id, target: target.id, linkId: null, start: "none", end: "none", offset: 0 });
  }

  // Comments inside a page or a link object (inside links, SPEC 1.1): open ones count for the dot too.
  for (const node of nodes) {
    if (node.kind !== "item" || node.isReference) continue;
    for (const link of graph.insideOf(node.recordId)) {
      if (link.view === "comment" && store.get("items", link.to)?.resolved !== true && store.has("items", link.to)) node.openComments += 1;
    }
  }

  if (inPage.size > 0) {
    const kept = nodes.filter((node) => !inPage.has(node));
    nodes.length = 0;
    nodes.push(...kept);
  }

  const stubCount = new Map<string, number>();
  /** One stub for each (card, other record) pair. All links between them share it. */
  const stubs = new Map<string, BoardNode>();
  const stubFor = (anchor: BoardNode, otherId: Id, key: string): BoardNode => {
    const existing = stubs.get(`${anchor.id}>${otherId}`);
    if (existing !== undefined) return existing;
    const index = stubCount.get(anchor.id) ?? 0;
    stubCount.set(anchor.id, index + 1);
    const stub: BoardNode = {
      ...emptyNode(),
      id: `stub:${key}`,
      kind: "stub",
      recordId: otherId,
      x: anchor.x + anchor.w + STUB_GAP,
      y: anchor.y + index * (STUB_HEIGHT + 8),
      w: STUB_WIDTH,
      h: STUB_HEIGHT,
      title: titleOf(store, otherId),
      codeName: store.get("items", otherId)?.codeName === true,
    };
    nodes.push(stub);
    stubs.set(`${anchor.id}>${otherId}`, stub);
    return stub;
  };

  const seenRelations = new Set<Id>();
  /** Card pairs (both directions) that have a relation line. Outline lines do not draw on them. */
  const relationPairs = new Set<string>();
  for (const [recordId, node] of nodeOfRecord) {
    for (const link of [...graph.relationsFrom(recordId), ...graph.relationsTo(recordId)]) {
      if (seenRelations.has(link.id)) continue;
      seenRelations.add(link.id);
      // A link to the current board itself needs no stub: you are on that board already.
      // The parent board shows this link.
      if (link.from === boardId || link.to === boardId) continue;
      const sourceNode = nodeOfRecord.get(link.from);
      const targetNode = nodeOfRecord.get(link.to);
      const source = sourceNode ?? stubFor(node, link.from, link.id);
      const target = targetNode ?? stubFor(node, link.to, link.id);
      const edge: BoardEdge = {
        id: link.id,
        kind: "relation",
        source: source.id,
        target: target.id,
        linkId: link.id,
        start: link.start ?? DEFAULT_START_CAP,
        end: link.end ?? DEFAULT_END_CAP,
        offset: 0,
      };
      relationPairs.add(pairKey(source.id, target.id));
      if (link.label !== undefined) edge.label = link.label;
      if (link.group !== undefined) edge.group = link.group;
      edges.push(edge);
    }
  }
  spreadParallelRelations(edges);

  // Outline lines come from the order (not saved): a plain line between rows that follow each other,
  // and an arrow from a parent row to each child row. A pair with a relation gets no outline line.
  for (const line of outlineLines) {
    const source = nodeOfPlace.get(line.from);
    const target = nodeOfPlace.get(line.to);
    if (source === undefined || target === undefined || relationPairs.has(pairKey(source.id, target.id))) continue;
    relationPairs.add(pairKey(source.id, target.id));
    const end: LinkCap = line.kind === "sequence" ? "none" : "arrow";
    edges.push({ id: `${line.kind}:${line.from}:${line.to}`, kind: line.kind, source: source.id, target: target.id, linkId: null, start: "none", end, offset: 0 });
  }
  return { nodes, edges };
}

/** A page card: a page (not a board) that holds its comments and notes. */
function isPageCard(node: BoardNode): boolean {
  return node.kind === "item" && node.view === "page" && !node.isBoard;
}

/** One key for a card pair, the same in both directions. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Gives relations between the same two cards different side offsets, centered on the middle line. */
function spreadParallelRelations(edges: BoardEdge[]): void {
  const groups = new Map<string, BoardEdge[]>();
  for (const edge of edges) {
    const key = pairKey(edge.source, edge.target);
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }
  for (const group of groups.values()) {
    group.forEach((edge, index) => {
      edge.offset = (index - (group.length - 1) / 2) * PARALLEL_GAP;
    });
  }
}

/** A node with all optional parts empty. */
function emptyNode(): BoardNode {
  return {
    id: "",
    kind: "item",
    recordId: "",
    placeId: null,
    view: "text",
    expanded: false,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    title: "",
    codeName: false,
    preview: "",
    marks: "en",
    childCount: 0,
    isBoard: false,
    isReference: false,
    outlineId: null,
    frameId: null,
    marker: "",
    list: null,
    innerStamps: [],
    color: null,
    groupName: "",
    month: "",
    months: [],
    inCalendar: false,
    timeLabel: "",
    spanOffset: 0,
    url: "",
    author: "",
    created: "",
    attachedTo: null,
    openComments: 0,
    calendarPopped: false,
    quote: "",
    pinned: false,
    replies: [],
    boardGroup: null,
    shape: "rect",
    shapePath: "",
    filled: false,
  };
}

/** The scribbles that an item card holds, relative to the card. */
function innerStampsOf(store: Store, graph: GraphIndex, itemId: Id): InnerStamp[] {
  return graph.childrenOf(itemId).flatMap((place) => {
    const stamp = store.get("stamps", place.to);
    return stamp === undefined ? [] : [{ placeId: place.id, stampId: stamp.id, x: place.x, y: place.y, w: place.w, h: place.h, path: stamp.path, alt: stamp.alt, color: place.color ?? null }];
  });
}

function placedNode(store: Store, graph: GraphIndex, place: PlaceLink): BoardNode {
  const base = {
    ...emptyNode(),
    id: place.id,
    recordId: place.to,
    placeId: place.id,
    view: place.view,
    expanded: place.expanded === true,
    x: place.x,
    y: place.y,
    w: place.w,
    h: place.h,
    color: place.color ?? null,
  };
  const stamp = store.get("stamps", place.to);
  if (stamp !== undefined) {
    return {
      ...base,
      kind: "stamp",
      title: stamp.alt,
      codeName: false,
      preview: "",
      childCount: 0,
      isBoard: false,
      stamp: { path: stamp.path, alt: stamp.alt, w: stamp.w, h: stamp.h },
    };
  }
  const item = store.get("items", place.to);
  if (item === undefined) {
    const childCount = graph.childrenOf(place.to).length;
    return { ...base, kind: "ghost", title: "Missing item", codeName: false, preview: place.to, childCount, isBoard: childCount > 0 };
  }
  const isBoard = graph.isBoardItem(place.to);
  return {
    ...base,
    kind: "item",
    title: item.name,
    codeName: item.codeName === true,
    preview: previewOf(store.get("texts", place.to)?.body ?? ""),
    marks: place.marks ?? defaultQuoteMarks(store.get("texts", place.to)?.body ?? ""),
    childCount: graph.childrenOf(place.to).filter((child) => !store.has("stamps", child.to)).length,
    isBoard,
    isReference: graph.isReference(place),
    innerStamps: isBoard ? [] : innerStampsOf(store, graph, place.to),
    url: item.url ?? "",
    author: item.author ?? "",
    created: item.created,
    attachedTo: item.on !== undefined && store.has("items", item.on) ? item.on : null,
    quote: item.quote ?? "",
    replies: place.view === "comment" ? repliesOf(store, graph, item.id) : [],
    boardGroup: isBoard ? boardGroupType(store, graph, place.to) : null,
    shape: place.shape ?? "rect",
    shapePath: place.shapePath ?? "",
    filled: place.filled === true,
  };
}

/** The replies under a comment, depth first, oldest first. */
export function repliesOf(store: Store, graph: GraphIndex, commentId: Id): BoardNode["replies"] {
  const result: BoardNode["replies"] = [];
  const seen = new Set<Id>([commentId]);
  const walk = (id: Id) => {
    for (const reply of graph.attachedTo(id)) {
      if (seen.has(reply.id)) continue;
      seen.add(reply.id);
      result.push({ id: reply.id, author: reply.author ?? "", created: reply.created, text: store.get("texts", reply.id)?.body ?? "" });
      walk(reply.id);
    }
  };
  walk(commentId);
  return result;
}

/** The name of a record for lists and labels. An item with no name shows the start of its text. */
export function titleOf(store: Store, id: Id): string {
  const item = store.get("items", id);
  if (item !== undefined) return item.name !== "" ? item.name : snippetOf(store.get("texts", id)?.body ?? "") || "Untitled";
  const stamp = store.get("stamps", id);
  if (stamp !== undefined) return stamp.alt;
  return "Missing item";
}

/** The first words of a text, for a record with no name. */
export function snippetOf(body: string, length = 40): string {
  const line = previewOf(body).split("\n").find((part) => part.trim() !== "")?.trim() ?? "";
  return line.length > length ? `${line.slice(0, length)}…` : line;
}

/** Short plain text for a card. Inline links keep only their label. */
export function previewOf(body: string): string {
  const text = body
    .replace(/\[([^\]\n]*)\]\((?:item|link):[0-9a-z]{12}\)/g, "$1")
    .replace(/!\[([^\]\n|]*)(?:\|[^\]\n]*)?\]\([^)]*\)/g, "[$1]")
    .replace(/^#{1,6}\s+/gm, "");
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text;
}
