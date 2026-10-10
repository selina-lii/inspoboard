// Groups: sets of cards on one board with one shape (see docs/SPEC.md section 2.6).
// - An outline (outline.ts) shows its cards as an aligned list.
// - A calendar shows a month grid (Sunday first, like Google Calendar). Each card is on one day. The user scrolls through the months.
// Groups are one level below the board: in a document, a board name is a title and a group name a subtitle.
// The shown month of a calendar is view state (not saved). The range of months is saved.

import { makeOp, type Command, type Op } from "./commands";
import { ENGLISH, type Words } from "./words";
import type { ActionContext } from "./actions";
import type { GraphIndex } from "./graph";
import { outlineRows } from "./outline";
import type { Store } from "./store";
import { createItemOnBoard } from "./actions";
import type { Id, ItemRecord, OutlineRecord, PlaceLink, ViewStyle } from "./types";

export const CALENDAR = {
  /** Size of one day. */
  cellW: 150,
  cellH: 112,
  /** Top bar: the name and the month with its arrows. */
  bar: 40,
  /** The row of weekday names. */
  weekdays: 24,
  /** Space around the grid. */
  pad: 10,
  /** Top of the cards in a day (under the day number). */
  dayTop: 22,
} as const;

export const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function isCalendar(group: OutlineRecord | undefined): boolean {
  return group?.type === "calendar";
}

/** "YYYY-MM" of an ISO time or a day. */
export function monthOf(time: string): string {
  return time.slice(0, 7);
}

/** The month after (+1) or before (-1). */
export function addMonths(month: string, count: number): string {
  const [year, number] = month.split("-").map(Number) as [number, number];
  const index = year * 12 + (number - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export function monthTitle(month: string): string {
  const [year, number] = month.split("-").map(Number) as [number, number];
  return `${MONTH_NAMES[number - 1] ?? month} ${year}`;
}

/** The months of a calendar, first to last. A calendar with no range shows only `fallback`. */
export function monthsOf(calendar: OutlineRecord, fallback: string): string[] {
  const start = calendar.start ?? calendar.end ?? fallback;
  const end = calendar.end ?? start;
  const months: string[] = [];
  for (let month = start; month <= end && months.length < 240; month = addMonths(month, 1)) months.push(month);
  return months.length === 0 ? [start] : months;
}

/** The month that a calendar shows first: this month if it is in the range, else the first month. */
export function defaultMonth(calendar: OutlineRecord, today: string): string {
  const months = monthsOf(calendar, monthOf(today));
  return months.includes(monthOf(today)) ? monthOf(today) : months[0]!;
}

/** The days of a month and the weekday of its first day (0 = Sunday). */
/**
 * The 42 days of the month grid (6 week rows, Sunday first): the last days of the month before, the days of the
 * month, and the first days of the month after. As in Google Calendar, cards show on all of them.
 */
export function gridDays(month: string): string[] {
  const { offset } = monthDays(month);
  const first = addDays(`${month}-01`, -offset);
  return Array.from({ length: 42 }, (_, index) => addDays(first, index));
}

export function monthDays(month: string): { days: string[]; offset: number } {
  const [year, number] = month.split("-").map(Number) as [number, number];
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const offset = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
  const days = Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
  return { days, offset };
}

/** The size of a calendar frame: 7 columns, 6 week rows. */
export function calendarSize(): { w: number; h: number } {
  return { w: 7 * CALENDAR.cellW + 2 * CALENDAR.pad, h: CALENDAR.bar + CALENDAR.weekdays + 6 * CALENDAR.cellH + CALENDAR.pad };
}

/** The top-left corner of a day in board coordinates, or null if the day is not in the month. */
export function dayCell(calendar: OutlineRecord, month: string, day: string): { x: number; y: number } | null {
  const { days, offset } = monthDays(month);
  const index = days.indexOf(day);
  if (index === -1) return null;
  const slot = index + offset;
  return {
    x: calendar.x + CALENDAR.pad + (slot % 7) * CALENDAR.cellW,
    y: calendar.y + CALENDAR.bar + CALENDAR.weekdays + Math.floor(slot / 7) * CALENDAR.cellH,
  };
}

/** The day at a board point in the shown month, or null. */
export function dayAt(calendar: OutlineRecord, month: string, point: { x: number; y: number }): string | null {
  const column = Math.floor((point.x - calendar.x - CALENDAR.pad) / CALENDAR.cellW);
  const row = Math.floor((point.y - calendar.y - CALENDAR.bar - CALENDAR.weekdays) / CALENDAR.cellH);
  if (column < 0 || column > 6 || row < 0 || row > 5) return null;
  return gridDays(month)[row * 7 + column] ?? null;
}

/** The cards of a calendar on each day, in the order of the links table. Stamps do not count. */
export function cardsByDay(store: Store, graph: GraphIndex, calendarId: Id): Map<string, PlaceLink[]> {
  const result = new Map<string, PlaceLink[]>();
  for (const place of graph.membersOf(calendarId)) {
    if (place.day === undefined || store.has("stamps", place.to)) continue;
    result.set(place.day, [...(result.get(place.day) ?? []), place]);
  }
  return result;
}

/** Creates an empty calendar at a board point. Range: from `start` to `end` (months). One command. */
export function createCalendar(context: ActionContext, boardId: Id, x: number, y: number, start: string, end: string = start): { command: Command; calendarId: Id } {
  const calendarId = context.newId();
  const calendar: OutlineRecord = { id: calendarId, type: "calendar", board: boardId, x, y, start, end: end < start ? start : end };
  return { command: { label: "New calendar", ops: [makeOp("outlines", calendarId, null, calendar)] }, calendarId };
}

export function setCalendarRange(context: ActionContext, calendarId: Id, start: string, end: string): Command {
  const before = context.store.get("outlines", calendarId);
  if (before === undefined) return { label: "Change months", ops: [] };
  const after: OutlineRecord = { ...before, start, end: end < start ? start : end };
  return { label: "Change months", ops: before.start === after.start && before.end === after.end ? [] : [makeOp("outlines", calendarId, before, after)] };
}

/** Sets or removes (empty text) the name of a group. */
export function renameGroup(context: ActionContext, groupId: Id, name: string): Command {
  const before = context.store.get("outlines", groupId);
  if (before === undefined || (before.name ?? "") === name.trim()) return { label: "Rename group", ops: [] };
  const after: OutlineRecord = { ...before };
  if (name.trim() === "") delete after.name;
  else after.name = name.trim();
  return { label: "Rename group", ops: [makeOp("outlines", groupId, before, after)] };
}

/** The date of an item on a calendar: "YYYY-MM-DD", or a range "YYYY-MM-DD/YYYY-MM-DD" (more than one day). */
export function dateText(day: string, until?: string): string {
  return until === undefined ? day : `${day}/${until}`;
}

/** A day plus some days. */
export function addDays(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

/** The number of days from one day to a later one. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** All days of a card: from its day to its last day. */
export function daysOf(place: PlaceLink): string[] {
  if (place.day === undefined) return [];
  const count = place.until === undefined ? 0 : Math.max(0, daysBetween(place.day, place.until));
  return Array.from({ length: Math.min(count, 400) + 1 }, (_, index) => addDays(place.day!, index));
}

/**
 * Sets the last day of a calendar card (null: one day). A card on more than one day has no time.
 * The item date becomes the range. One command.
 */
export function setCardDays(context: ActionContext, placeId: Id, until: string | null): Command {
  const place = context.store.get("links", placeId);
  if (place?.kind !== "place" || place.day === undefined) return { label: "Change days", ops: [] };
  const after: PlaceLink = { ...place };
  if (until === null || until <= place.day) delete after.until;
  else {
    after.until = until;
    delete after.time;
  }
  const ops: Op[] = [];
  if (after.until !== place.until || after.time !== place.time) ops.push(makeOp("links", placeId, place, after));
  const item = context.store.get("items", place.to);
  const date = dateText(place.day, after.until);
  if (item !== undefined && item.date !== date) ops.push(makeOp("items", item.id, item, { ...item, date }));
  return { label: "Change days", ops };
}

/** Sets the time of a calendar card ("HH:MM" or "HH:MM–HH:MM"; null: all day). A card with a time is on one day. */
export function setCardTime(context: ActionContext, placeId: Id, time: string | null): Command {
  const place = context.store.get("links", placeId);
  if (place?.kind !== "place" || place.day === undefined) return { label: "Change time", ops: [] };
  const after: PlaceLink = { ...place };
  if (time === null || time === "") delete after.time;
  else {
    after.time = time.replace("-", "–");
    delete after.until;
  }
  const ops: Op[] = [];
  if (after.until !== place.until || after.time !== place.time) ops.push(makeOp("links", placeId, place, after));
  const item = context.store.get("items", place.to);
  if (item !== undefined && place.until !== after.until && item.date !== place.day) ops.push(makeOp("items", item.id, item, { ...item, date: place.day }));
  return { label: "Change time", ops };
}

/** The start time of a card in minutes (for sorting), or -1 (all day: first). */
export function startMinutes(place: PlaceLink): number {
  const match = /^(\d\d):(\d\d)/.exec(place.time ?? "");
  return match === null ? -1 : Number(match[1]) * 60 + Number(match[2]);
}

/** "MM-DD-YYYY" of a day "YYYY-MM-DD". */
export function dayLabel(day: string): string {
  return `${day.slice(5, 7)}-${day.slice(8, 10)}-${day.slice(0, 4)}`;
}

/** The type word in a day name: "page", "note", "todo", "board", ... */
function typeWord(view: ViewStyle, board: boolean): string {
  if (board) return "board";
  return view === "weblink" ? "link" : view;
}

/**
 * A name for an item without a name on a calendar day: "MM-DD-YYYY <type><n>", for example "09-01-2026 page1".
 * `taken`: the names that are in use (the next free number is used).
 */
export function dayName(day: string, view: ViewStyle, board: boolean, taken: ReadonlySet<string>): string {
  const base = `${dayLabel(day)} ${typeWord(view, board)}`;
  let number = 1;
  while (taken.has(`${base}${number}`)) number += 1;
  return `${base}${number}`;
}

/** True if an item has no name of its own: empty, or a code that the app made. */
function hasNoName(item: ItemRecord): boolean {
  return item.name.trim() === "" || item.codeName === true;
}

/**
 * The item change for a card that goes onto a calendar day: the date of the item is the day.
 * An item without a name (or with a code name) gets a day name. Returns null if nothing changes.
 */
function datedItem(item: ItemRecord, day: string, view: ViewStyle, board: boolean, taken: Set<string>, until?: string): ItemRecord | null {
  const after: ItemRecord = { ...item, date: dateText(day, until) };
  if (hasNoName(item)) {
    after.name = dayName(day, view, board, taken);
    delete after.codeName;
    taken.add(after.name);
  }
  return after.date === item.date && after.name === item.name && after.codeName === item.codeName ? null : after;
}

/** The names of all items (for free day names). */
function takenNames(store: Store): Set<string> {
  return new Set([...store.all("items")].map((item) => item.name));
}

/**
 * Puts cards on a day of a calendar (a "snap" to the grid). Cards from a different group leave it.
 * Only cards on the board of the calendar. Each item gets the day as its date; an item without a name gets a
 * day name (see dayName). One command.
 */
export function snapToDay(context: ActionContext, placeIds: readonly Id[], calendarId: Id, day: string): Command {
  const calendar = context.store.get("outlines", calendarId);
  if (calendar === undefined) return { label: "Put on day", ops: [] };
  const ops: Op[] = [];
  const taken = takenNames(context.store);
  for (const placeId of placeIds) {
    const place = context.store.get("links", placeId);
    if (place?.kind !== "place" || place.from !== calendar.board || context.store.has("stamps", place.to)) continue;
    const after: PlaceLink = { ...place, outline: calendarId, day };
    delete after.parent;
    delete after.rank;
    // A card on more than one day keeps its length.
    if (place.until !== undefined && place.day !== undefined && place.outline === calendarId) after.until = addDays(day, daysBetween(place.day, place.until));
    else delete after.until;
    if (place.outline !== calendarId || place.day !== day || place.until !== after.until) ops.push(makeOp("links", placeId, place, after));
    const item = context.store.get("items", place.to);
    const dated = item === undefined ? null : datedItem(item, day, place.view, context.graph.isBoardItem(item.id), taken, after.until);
    if (dated !== null) ops.push(makeOp("items", item!.id, item!, dated));
  }
  return { label: "Put on day", ops };
}

/** The days and the time of a calendar card. `until`: the last day (null: one day). `time`: "HH:MM" or "HH:MM–HH:MM" (null: all day). */
export type CardSchedule = { day: string; until: string | null; time: string | null };

/**
 * Sets the first day, the last day, and the time of a calendar card. A card on more than one day has no time:
 * a time is ignored then. The item date becomes the day (or the range). A card with no name gets the day name. One command.
 */
export function setCardSchedule(context: ActionContext, placeId: Id, schedule: CardSchedule): Command {
  const place = context.store.get("links", placeId);
  if (place?.kind !== "place" || place.day === undefined) return { label: "Change days and time", ops: [] };
  const after: PlaceLink = { ...place, day: schedule.day };
  delete after.until;
  delete after.time;
  if (schedule.until !== null && schedule.until > schedule.day) after.until = schedule.until;
  else if (schedule.time !== null && schedule.time !== "") after.time = schedule.time.replace("-", "–");
  const ops: Op[] = [];
  if (after.day !== place.day || after.until !== place.until || after.time !== place.time) ops.push(makeOp("links", placeId, place, after));
  const item = context.store.get("items", place.to);
  const dated = item === undefined ? null : datedItem(item, after.day!, place.view, context.graph.isBoardItem(item.id), takenNames(context.store), after.until);
  if (dated !== null) ops.push(makeOp("items", item!.id, item!, dated));
  return { label: "Change days and time", ops };
}

/** Creates an item on a calendar day: named by the day (see dayName), with the day as its date. One command. */
export function createOnDay(context: ActionContext, calendarId: Id, day: string, view: ViewStyle, options: { board?: boolean; author?: string } = {}): { command: Command; itemId: Id; placeId: Id } | null {
  const calendar = context.store.get("outlines", calendarId);
  if (calendar === undefined) return null;
  const created = createItemOnBoard(context, { boardId: calendar.board, view, x: calendar.x, y: calendar.y, name: dayName(day, view, options.board === true, takenNames(context.store)), board: options.board, author: options.author });
  for (const op of created.command.ops) {
    if (op.table === "items" && op.after !== null) (op.after as ItemRecord).date = day;
    if (op.table === "links" && op.after !== null) Object.assign(op.after as PlaceLink, { outline: calendarId, day, expanded: true });
  }
  return created;
}

/** Deletes a calendar. Its cards stay on the board, at the given positions (default: where they were). One command. */
export function deleteCalendar(context: ActionContext, calendarId: Id, positions: ReadonlyMap<Id, { x: number; y: number }> = new Map()): Command {
  const calendar = context.store.get("outlines", calendarId);
  if (calendar === undefined) return { label: "Delete calendar", ops: [] };
  const ops: Op[] = [];
  for (const place of context.graph.membersOf(calendarId)) {
    const after: PlaceLink = { ...place, ...(positions.get(place.id) ?? {}) };
    delete after.outline;
    delete after.day;
    delete after.until;
    delete after.time;
    ops.push(makeOp("links", place.id, place, after));
  }
  ops.push(makeOp("outlines", calendarId, calendar, null));
  return { label: "Delete calendar", ops };
}

/**
 * The type of group that a board is: if all its cards are in one group (scribbles do not count),
 * the board is an "outline" or a "calendar" board. Else null.
 */
export function boardGroupType(store: Store, graph: GraphIndex, boardId: Id): "outline" | "calendar" | null {
  const groups = graph.outlinesOn(boardId);
  if (groups.length !== 1) return null;
  const group = groups[0]!;
  const cards = graph.childrenOf(boardId).filter((place) => !store.has("stamps", place.to));
  if (!cards.every((place) => place.outline === group.id)) return null;
  if (cards.length === 0 && !isCalendar(group)) return null;
  return isCalendar(group) ? "calendar" : "outline";
}

/** A name for a group: its name, or its type. */
export function groupTitle(group: OutlineRecord, words: Words = ENGLISH): string {
  return group.name ?? (isCalendar(group) ? words("Calendar") : words("Outline"));
}

/**
 * One Markdown document with all cards of a group. Outline: the rows in order, deeper rows get deeper headings.
 * Calendar: the days in order, each with its cards.
 */
export function groupDocument(store: Store, graph: GraphIndex, groupId: Id, words: Words = ENGLISH): string {
  const group = store.get("outlines", groupId);
  if (group === undefined) return "";
  const nameOf = (id: Id) => {
    const item = store.get("items", id);
    return item === undefined ? words("(missing)") : item.name !== "" ? item.name : "";
  };
  const bodyOf = (id: Id) => (store.get("texts", id)?.body ?? "").trimEnd();
  const blocks: string[] = [`# ${groupTitle(group, words)}`];
  if (isCalendar(group)) {
    const byDay = cardsByDay(store, graph, groupId);
    for (const day of [...byDay.keys()].sort()) {
      const weekday = words(WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]!);
      blocks.push(`## ${weekday} ${day}`);
      for (const place of [...byDay.get(day)!].sort((a, b) => startMinutes(a) - startMinutes(b))) {
        const name = nameOf(place.to);
        const when = place.until !== undefined ? `${words("(to {0})", place.until)} ` : place.time !== undefined ? `${place.time} ` : "";
        if (name !== "" || when !== "") blocks.push(`### ${when}${name}`.trimEnd());
        if (bodyOf(place.to) !== "") blocks.push(bodyOf(place.to));
      }
    }
  } else {
    for (const row of outlineRows(store, graph, groupId)) {
      const name = nameOf(row.recordId);
      const heading = "#".repeat(Math.min(6, 2 + row.depth));
      if (name !== "" || row.marker !== "") blocks.push(`${heading} ${row.marker !== "" && row.marker !== "•" ? `${row.marker} ` : ""}${name}`.trimEnd());
      if (bodyOf(row.recordId) !== "") blocks.push(bodyOf(row.recordId));
    }
  }
  return `${blocks.join("\n\n")}\n`;
}
