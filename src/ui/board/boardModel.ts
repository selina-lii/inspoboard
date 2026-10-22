// Board model: what one board shows. This is a pure function of the store.
// It has no React and no React Flow. The adapter (BoardView) converts it for React Flow.
// See docs/SPEC.md section 7.1.

import { isPassageLink, onlyInItems } from "../../core/linkEnds";
import type { GraphIndex } from "../../core/graph";
import { outlineLayout, outlineRows, parentPairs, sequencePairs } from "../../core/outline";
import { coreSize, isRadial, RADIAL, radialOffsets } from "../../core/radial";
import { boardGroupType, calendarFrameSize, calendarViewOf, CALENDAR, daysBetween, daysOf, defaultMonth, endMinutes, gridDays, isCalendar, monthsOf, monthOf, dayOrder, monthsInView, startMinutes, WEEK, weekDays, weekStripHeight } from "../../core/groups";
import type { Store } from "../../core/store";
import { DEFAULT_END_CAP, DEFAULT_START_CAP, type CalendarView, type GroupShape, type Id, type LinkCap, type ListStyle, type MediaInfo, type PlaceLink, type QuoteMarks, type ViewStyle } from "../../core/types";
import { defaultQuoteMarks } from "../../core/actions";

export type BoardNodeKind = "item" | "stamp" | "ghost" | "stub" | "outline" | "calendar" | "radial";

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

/**
 * The cards of a calendar in its shown week (the week view, see docs/SPEC.md section 7.6), as Google Calendar:
 * - At the top, a strip for all-day cards (one day, no time) and cards on more than one day: bars in lanes.
 * - Under it, the hour grid: a card with a time is at its hours (one hour if it has only a start). Cards whose times
 *   overlap share the width of the day.
 * Cards with no day in the shown week do not show. Returns the number of lanes of the strip.
 */
function layoutWeek(store: Store, graph: GraphIndex, calendar: { id: Id; x: number; y: number }, day: string, frameId: string, boxes: Map<Id, CalendarBox>, hidden: Set<Id>, popped: ReadonlySet<Id>): number {
  const days = weekDays(day);
  const slotOf = new Map(days.map((one, index) => [one, index] as const));
  const columnLeft = (column: number) => calendar.x + CALENDAR.pad + WEEK.gutter + column * WEEK.cellW;
  const stripTop = calendar.y + CALENDAR.bar + WEEK.head;
  const box = (place: PlaceLink, part: Omit<CalendarBox, "calendarId" | "frameId" | "more" | "expanded" | "popped" | "timeLabel"> & { expanded?: boolean }, timeLabel: string): CalendarBox => {
    const pop = popped.has(place.id) && part.expanded !== true;
    return { ...part, h: pop ? Math.max(part.h, 160) : part.h, expanded: part.expanded === true || pop, popped: pop, calendarId: calendar.id, frameId, timeLabel, more: [] };
  };
  type Bar = { place: PlaceLink; from: number; to: number; lane: number };
  const bars: Bar[] = [];
  const timed = new Map<number, PlaceLink[]>();
  for (const place of graph.membersOf(calendar.id)) {
    if (place.day === undefined || store.has("stamps", place.to)) continue;
    const slots = daysOf(place).flatMap((one) => (slotOf.has(one) ? [slotOf.get(one)!] : []));
    if (slots.length === 0) {
      hidden.add(place.id);
      continue;
    }
    if (place.until === undefined && startMinutes(place) >= 0) timed.set(slots[0]!, [...(timed.get(slots[0]!) ?? []), place]);
    else bars.push({ place, from: Math.min(...slots), to: Math.max(...slots), lane: 0 });
  }
  // The strip: longer bars first, then the order of the day.
  const order = dayOrder(store);
  bars.sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from) || order(a.place, b.place));
  const ends: number[] = [];
  for (const bar of bars) {
    let lane = ends.findIndex((end) => end < bar.from);
    if (lane === -1) lane = ends.length;
    ends[lane] = bar.to;
    bar.lane = lane;
    boxes.set(bar.place.id, box(bar.place, { x: columnLeft(bar.from) + 3, y: stripTop + 2 + lane * WEEK.lane, w: (bar.to - bar.from + 1) * WEEK.cellW - 6, h: WEEK.lane - 4, spanOffset: daysBetween(bar.place.day!, days[bar.from]!) }, ""));
  }
  const gridTop = stripTop + weekStripHeight(ends.length);
  // The hour grid: in each day, cards whose times overlap make a cluster; each card of a cluster takes a column.
  for (const [slot, places] of timed) {
    const sorted = [...places].sort((a, b) => startMinutes(a) - startMinutes(b) || endMinutes(b) - endMinutes(a) || order(a, b));
    let cluster: { place: PlaceLink; column: number }[] = [];
    let clusterEnd = -1;
    const flush = () => {
      const columns = Math.max(...cluster.map((entry) => entry.column)) + 1;
      const width = (WEEK.cellW - 6) / columns;
      for (const { place, column } of cluster) {
        const top = gridTop + (startMinutes(place) / 60) * WEEK.hourH;
        const height = Math.max(COLLAPSED_HEIGHT - 8, ((endMinutes(place) - startMinutes(place)) / 60) * WEEK.hourH - 2);
        boxes.set(place.id, box(place, { x: columnLeft(slot) + 3 + column * width, y: top, w: width - 2, h: Math.min(height, gridTop + 24 * WEEK.hourH - top), spanOffset: 0, expanded: place.expanded === true && height >= 2 * COLLAPSED_HEIGHT }, timeLabelOf(place.time)));
      }
      cluster = [];
    };
    for (const place of sorted) {
      if (cluster.length > 0 && startMinutes(place) >= clusterEnd) flush();
      const ends = new Map(cluster.map((entry) => [entry.column, endMinutes(entry.place)] as const));
      let column = 0;
      while ((ends.get(column) ?? -1) > startMinutes(place)) column += 1;
      cluster.push({ place, column });
      clusterEnd = Math.max(clusterEnd, endMinutes(place));
    }
    if (cluster.length > 0) flush();
  }
  return ends.length;
}

/** The number of cards on each day of a calendar (the year view shows them as dots). All its cards are hidden. */
function countDays(store: Store, graph: GraphIndex, calendarId: Id, hidden: Set<Id>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const place of graph.membersOf(calendarId)) {
    if (place.day === undefined || store.has("stamps", place.to)) continue;
    hidden.add(place.id);
    for (const one of daysOf(place)) counts[one] = (counts[one] ?? 0) + 1;
  }
  return counts;
}

/** Height of a card that shows only its name. */
export const COLLAPSED_HEIGHT = 36;
/** The extra height of a folded card with a subtitle (its second line). */
export const SUBTITLE_HEIGHT = 16;
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
  /** A page: the line under its name (gray, italic). Empty: none (also for a board). */
  subtitle: string;
  preview: string;
  /** A quote card: its quotation marks (from its placement, else from its text). */
  marks: QuoteMarks;
  childCount: number;
  /** True if the item is a board: it has item children, or the user made it a board. */
  isBoard: boolean;
  stamp?: { path: string; alt: string; w: number; h: number };
  /** True if the item lives on a different board. The card is a reference: a ghost with a dashed outline. */
  isReference: boolean;
  /** A reference on a sorting map (plugin "Sorting tray"): it shows as the real card (its kind and color), with a dashed edge. */
  sorted: boolean;
  /** A stub: the card it belongs to (its place link) and the top-right corner of that card as it shows. */
  stubAnchor?: { placeId: Id; x: number; y: number } | null;
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
  /** Radial core: the radius of its ball of cards (board units). A card dropped outside it leaves the radial. */
  radialRadius: number;
  /** Calendar frame: the shown month "YYYY-MM", and all months of its range. */
  month: string;
  months: string[];
  /** Calendar frame: its view, the shown day (the period of the view has it), the lanes of the all-day strip of the
   *  week view, and the number of cards on each day (the year view). */
  calendarView: CalendarView;
  calendarDay: string;
  calendarLanes: number;
  dayCounts: Record<string, number>;
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
  /** A multimedia item (SPEC 7.14): its kind, link, artist, cover. Else null. */
  media: MediaInfo | null;
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

/** View state of a board that is not saved: the day that each calendar shows (its view shows the week, the month,
 *  or the year of the day). `months`: the month of each calendar (older form; `days` comes first). */
export type BoardViewState = {
  days?: ReadonlyMap<Id, string>;
  months?: ReadonlyMap<Id, string>;
  today?: string;
  /** Calendar cards that the user opened in a full day: they show open over their neighbors. Not saved. */
  popped?: ReadonlySet<Id>;
};

export type BoardEdgeKind = "relation" | "sequence" | "outline-child" | "attach" | "radial";

export type BoardEdge = {
  id: string;
  kind: BoardEdgeKind;
  source: string;
  target: string;
  /** Relation link ID. Derived outline lines have none. */
  linkId: Id | null;
  /** A link made from text, put on boards by the user: a dashed gray line. */
  passage?: boolean;
  label?: string;
  group?: string;
  /** The line color of the link (its own color). */
  color?: string;
  dashed?: boolean;
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

const STUB_GAP = 16;
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

/**
 * The width of a card as it shows. A folded card (not in an outline or a calendar) is as wide as its name: an
 * estimate from the name (the view measures it; the model does not), at most 320 px as in the CSS.
 */
function shownWidth(node: BoardNode): number {
  const folded = node.kind === "item" && !node.expanded && !(node.view === "text" && !node.isBoard) && node.view !== "group" && node.outlineId === null && !node.inCalendar;
  if (!folded) return node.w;
  let text = 0;
  for (const ch of node.title !== "" ? node.title : "Untitled") text += /[\u2E80-\uFFEF]/.test(ch) ? 13 : 7.2;
  // The padding, the marker room, and the hover tools at the right.
  return Math.min(320, Math.max(60, Math.round(text + 40)));
}

/** The height of a card on the board. */
export function cardHeight(store: Store, graph: GraphIndex, place: PlaceLink): number {
  if (!isCollapsedPlace(store, graph, place)) return place.h;
  const subtitle = !graph.isBoardItem(place.to) && (store.get("items", place.to)?.subtitle ?? "") !== "";
  return COLLAPSED_HEIGHT + (subtitle ? SUBTITLE_HEIGHT : 0);
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
  /** Radial cores: a line from the core to each of its cards. */
  const radialLines: { frameId: string; placeId: Id }[] = [];
  for (const outline of graph.outlinesOn(boardId)) {
    // A radial: the core circle, and its cards around it (the ball seen from the front, SPEC 7.17).
    if (isRadial(outline)) {
      const size = coreSize(outline.name ?? "");
      const frameId = `radial:${outline.id}`;
      nodes.push({ ...emptyNode(), id: frameId, kind: "radial", recordId: outline.id, x: outline.x - size / 2, y: outline.y - size / 2, w: size, h: size, outlineId: outline.id, groupName: outline.name ?? "", radialRadius: outline.radius ?? RADIAL.radius });
      for (const [placeId, [dx, dy]] of radialOffsets(store, graph, outline)) {
        const place = store.get("links", placeId);
        if (place?.kind !== "place") continue;
        outlinePositions.set(placeId, { x: outline.x + dx - place.w / 2, y: outline.y + dy - cardHeight(store, graph, place) / 2, outlineId: outline.id, frameId, marker: "" });
        radialLines.push({ frameId, placeId });
      }
      continue;
    }
    if (isCalendar(outline)) {
      const months = monthsOf(outline, monthOf(today));
      const calendarView = calendarViewOf(outline);
      // The shown day: the one the user went to (its month in the range), else today (in the range), else the first month.
      const monthStart = view.months?.get(outline.id);
      const requested = view.days?.get(outline.id) ?? (monthStart === undefined ? undefined : `${monthStart}-01`);
      const fallback = defaultMonth(outline, today);
      const day = requested !== undefined && monthsInView(calendarView, requested).some((one) => months.includes(one)) ? requested : fallback === monthOf(today) ? today.slice(0, 10) : `${fallback}-01`;
      const month = monthOf(day);
      const frameId = `calendar:${outline.id}`;
      const frame: BoardNode = { ...emptyNode(), id: frameId, kind: "calendar", recordId: outline.id, x: outline.x, y: outline.y, outlineId: outline.id, groupName: outline.name ?? "", month, months, calendarView, calendarDay: day };
      nodes.push(frame);
      const popped = view.popped ?? new Set<Id>();
      if (calendarView === "week") frame.calendarLanes = layoutWeek(store, graph, outline, day, frameId, calendarBoxes, hiddenPlaces, popped);
      else if (calendarView === "year") frame.dayCounts = countDays(store, graph, outline.id, hiddenPlaces);
      else layoutCalendar(store, graph, outline, month, frameId, frame, calendarBoxes, hiddenPlaces, popped);
      Object.assign(frame, calendarFrameSize(calendarView, frame.calendarLanes));
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
    // From the right edge that shows (a folded card is as wide as its name), or where the user dragged it.
    const right = anchor.x + shownWidth(anchor);
    const anchorPlace = anchor.placeId === null ? undefined : store.get("links", anchor.placeId);
    const saved = anchorPlace?.kind === "place" ? anchorPlace.stubs?.[otherId] : undefined;
    let at: [number, number];
    if (saved !== undefined) at = saved;
    else {
      const index = stubCount.get(anchor.id) ?? 0;
      stubCount.set(anchor.id, index + 1);
      at = [STUB_GAP, index * (STUB_HEIGHT + 8)];
    }
    const stub: BoardNode = {
      ...emptyNode(),
      id: `stub:${key}`,
      kind: "stub",
      recordId: otherId,
      x: right + at[0],
      y: anchor.y + at[1],
      stubAnchor: anchor.placeId === null ? null : { placeId: anchor.placeId, x: right, y: anchor.y },
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
      // A link made from text shows in its items (a gray passage and a shadow), not on the board (SPEC 7.11),
      // unless the user puts it on boards: then a dashed gray line.
      if (onlyInItems(store, link)) continue;
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
      if (link.color !== undefined) edge.color = link.color;
      if (link.dashed === true) edge.dashed = true;
      if (isPassageLink(store, link)) edge.passage = true;
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
  for (const line of radialLines) {
    const target = nodeOfPlace.get(line.placeId);
    if (target !== undefined) edges.push({ id: `radial:${line.placeId}`, kind: "radial", source: line.frameId, target: target.id, linkId: null, start: "none", end: "none", offset: 0 });
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
    subtitle: "",
    preview: "",
    marks: "en",
    childCount: 0,
    isBoard: false,
    isReference: false,
    sorted: false,
    outlineId: null,
    frameId: null,
    marker: "",
    list: null,
    innerStamps: [],
    color: null,
    groupName: "",
    radialRadius: 0,
    month: "",
    months: [],
    calendarView: "month",
    calendarDay: "",
    calendarLanes: 0,
    dayCounts: {},
    inCalendar: false,
    timeLabel: "",
    spanOffset: 0,
    url: "",
    media: null,
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
    subtitle: isBoard ? "" : (item.subtitle ?? ""),
    // An open note shows all its text (the user keeps it short); other cards show the start.
    preview: previewOf(store.get("texts", place.to)?.body ?? "", base.view === "note" && !isBoard ? Infinity : PREVIEW_LENGTH),
    marks: place.marks ?? defaultQuoteMarks(store.get("texts", place.to)?.body ?? ""),
    childCount: graph.childrenOf(place.to).filter((child) => !store.has("stamps", child.to)).length,
    isBoard,
    isReference: graph.isReference(place),
    sorted: graph.isReference(place) && store.get("items", place.from)?.sources !== undefined,
    innerStamps: isBoard ? [] : innerStampsOf(store, graph, place.to),
    url: item.url ?? "",
    media: item.media ?? null,
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

/** Plain text for a card, at most `length` characters. Inline links keep only their label. */
export function previewOf(body: string, length = PREVIEW_LENGTH): string {
  const text = body
    .replace(/\[([^\]\n]*)\]\((?:item|link):[0-9a-z]{12}\)/g, "$1")
    .replace(/!\[([^\]\n|]*)(?:\|[^\]\n]*)?\]\([^)]*\)/g, "[$1]")
    .replace(/^#{1,6}\s+/gm, "");
  return text.length > length ? `${text.slice(0, length)}…` : text;
}
