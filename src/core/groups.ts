// Groups: sets of cards on one board with one shape (see docs/SPEC.md section 2.6).
// - An outline (outline.ts) shows its cards as an aligned list.
// - A calendar shows a month grid (Sunday first, like Google Calendar). Each card is on one day. The user scrolls through the months.
// Groups are one level below the board: in a document, a board name is a title and a group name a subtitle.
// The shown day of a calendar is view state (not saved). The range of months and the view (week, month, year) are saved.

import { makeOp, type Command, type Op } from "./commands";
import { ENGLISH, type Words } from "./words";
import type { ActionContext } from "./actions";
import type { GraphIndex } from "./graph";
import { radialMembers } from "./radial";
import { outlineRows } from "./outline";
import type { Store } from "./store";
import { createItemOnBoard } from "./actions";
import type { CalendarView, Id, ItemRecord, OutlineRecord, PlaceLink, ViewStyle } from "./types";

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

/** The view of a calendar: week, month (the default), or year. */
export function calendarViewOf(calendar: OutlineRecord | undefined): CalendarView {
  return calendar?.view ?? "month";
}

/** Sets the view of a calendar (week, month, year). The month view is the default: it removes the field. One command. */
export function setCalendarView(context: ActionContext, calendarId: Id, view: CalendarView): Command {
  const before = context.store.get("outlines", calendarId);
  if (before === undefined || calendarViewOf(before) === view) return { label: "Calendar view", ops: [] };
  const after: OutlineRecord = { ...before, view };
  if (view === "month") delete after.view;
  return { label: "Calendar view", ops: [makeOp("outlines", calendarId, before, after)] };
}

/** The week view: a column for each day, a strip for all-day and multi-day cards, and an hour grid (0 to 24). */
export const WEEK = {
  /** The column at the left with the hours. */
  gutter: 42,
  cellW: 144,
  /** The row with the weekdays and their dates. */
  head: 28,
  /** The height of one lane of the all-day strip, and the space under the strip. */
  lane: 32,
  stripPad: 8,
  hourH: 36,
} as const;

/** The year view: 12 small months, 4 columns and 3 rows. */
export const YEAR = {
  cellW: 34,
  cellH: 26,
  /** The month name and the weekday letters of a small month. */
  title: 22,
  weekdays: 16,
  gapX: 32,
  gapY: 16,
} as const;

/** The size of a calendar frame in a view. `lanes`: the lanes of the all-day strip of the week view (at least one). */
export function calendarFrameSize(view: CalendarView, lanes = 1): { w: number; h: number } {
  const w = 7 * CALENDAR.cellW + 2 * CALENDAR.pad;
  if (view === "week") return { w, h: CALENDAR.bar + WEEK.head + weekStripHeight(lanes) + 24 * WEEK.hourH + CALENDAR.pad };
  if (view === "year") return { w, h: CALENDAR.bar + 3 * yearMonthHeight() + 2 * YEAR.gapY + CALENDAR.pad };
  return calendarSize();
}

export function weekStripHeight(lanes: number): number {
  return Math.max(1, lanes) * WEEK.lane + WEEK.stripPad;
}

export function yearMonthHeight(): number {
  return YEAR.title + YEAR.weekdays + 6 * YEAR.cellH;
}

/** The Sunday of the week of a day. */
export function weekStart(day: string): string {
  return addDays(day, -new Date(`${day}T00:00:00Z`).getUTCDay());
}

/** The 7 days of the week of a day, Sunday first. */
export function weekDays(day: string): string[] {
  const first = weekStart(day);
  return Array.from({ length: 7 }, (_, index) => addDays(first, index));
}

/** The months that a view of a day shows: its week (one or two months), its month, or the 12 months of its year. */
export function monthsInView(view: CalendarView, day: string): string[] {
  if (view === "week") return [...new Set(weekDays(day).map(monthOf))];
  if (view === "year") return Array.from({ length: 12 }, (_, index) => `${day.slice(0, 4)}-${String(index + 1).padStart(2, "0")}`);
  return [monthOf(day)];
}

/** The day that a calendar view shows after `step` periods (weeks, months, or years) from a day. */
export function stepView(view: CalendarView, day: string, step: number): string {
  if (view === "week") return addDays(weekStart(day), 7 * step);
  const month = addMonths(monthOf(day), view === "year" ? 12 * step : step);
  return `${month}-01`;
}

/**
 * The title of a view, in parts (they show with " – " between them, each one translated alone): ["January 2026"],
 * a week in two months ["January", "February 2026"] or two years ["December 2025", "January 2026"], a year ["2026"].
 */
export function viewTitle(view: CalendarView, day: string): string[] {
  if (view === "year") return [day.slice(0, 4)];
  if (view !== "week") return [monthTitle(monthOf(day))];
  const days = weekDays(day);
  const first = monthOf(days[0]!);
  const last = monthOf(days[6]!);
  if (first === last) return [monthTitle(first)];
  return first.slice(0, 4) === last.slice(0, 4) ? [MONTH_NAMES[Number(first.slice(5)) - 1]!, monthTitle(last)] : [monthTitle(first), monthTitle(last)];
}

/** The top-left corner of small month `index` (0 to 11) of the year view, from the top-left corner of the frame. */
export function yearMonthCorner(index: number): { x: number; y: number } {
  return { x: CALENDAR.pad + (index % 4) * (7 * YEAR.cellW + YEAR.gapX), y: CALENDAR.bar + Math.floor(index / 4) * (yearMonthHeight() + YEAR.gapY) };
}

/**
 * The place of a board point in a calendar view: the day, and in the hour grid of the week view the time (minutes from
 * midnight, in steps of 15). `lanes`: the lanes of the all-day strip of the week view. In the month view, the days
 * of the months before and after count too. Null: no day there.
 */
export function calendarPointAt(calendar: OutlineRecord, view: CalendarView, day: string, point: { x: number; y: number }, lanes = 1): { day: string; minutes: number | null } | null {
  const x = point.x - calendar.x;
  const y = point.y - calendar.y;
  if (view === "week") {
    const column = Math.floor((x - CALENDAR.pad - WEEK.gutter) / WEEK.cellW);
    const top = CALENDAR.bar + WEEK.head;
    if (column < 0 || column > 6 || y < top) return null;
    const target = weekDays(day)[column]!;
    const grid = top + weekStripHeight(lanes);
    if (y < grid) return { day: target, minutes: null };
    const minutes = Math.floor(((y - grid) / WEEK.hourH) * 4) * 15;
    return minutes >= 24 * 60 ? null : { day: target, minutes };
  }
  if (view === "year") {
    for (let index = 0; index < 12; index += 1) {
      const corner = yearMonthCorner(index);
      const column = Math.floor((x - corner.x) / YEAR.cellW);
      const row = Math.floor((y - corner.y - YEAR.title - YEAR.weekdays) / YEAR.cellH);
      if (column < 0 || column > 6 || row < 0 || row > 5) continue;
      const month = `${day.slice(0, 4)}-${String(index + 1).padStart(2, "0")}`;
      const target = gridDays(month)[row * 7 + column]!;
      return target.startsWith(month) ? { day: target, minutes: null } : null;
    }
    return null;
  }
  const target = dayAt(calendar, monthOf(day), point);
  return target === null ? null : { day: target, minutes: null };
}

/** "HH:MM" of minutes from midnight. */
export function clockOf(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/** The end of a card in minutes from midnight: its end time, else one hour after its start. -1: no time. */
export function endMinutes(place: PlaceLink): number {
  const start = startMinutes(place);
  if (start < 0) return -1;
  const match = /–(\d\d):(\d\d)$/.exec(place.time ?? "");
  const end = match === null ? start + 60 : Number(match[1]) * 60 + Number(match[2]);
  return end > start ? end : start + 60;
}

/**
 * Puts cards on a day and a time of a calendar (a drop in the week view). `minutes`: the start (minutes from
 * midnight); a card with an end time keeps its length. Null: all day (the time goes). A card on more than one day
 * keeps its days and has no time. One command (as snapToDay, and the time).
 */
export function snapToTime(context: ActionContext, placeIds: readonly Id[], calendarId: Id, day: string, minutes: number | null): Command {
  const command = snapToDay(context, placeIds, calendarId, day);
  for (const placeId of placeIds) {
    const current = context.store.get("links", placeId);
    if (current?.kind !== "place") continue;
    const op = command.ops.find((one) => one.table === "links" && one.id === placeId);
    const base = (op?.after as PlaceLink | undefined) ?? current;
    if (base.outline !== calendarId || base.until !== undefined) continue;
    const after: PlaceLink = { ...base };
    if (minutes === null) delete after.time;
    else {
      const start = Math.max(0, Math.min(24 * 60 - 15, minutes));
      const ranged = /–/.test(current.time ?? "");
      after.time = ranged ? `${clockOf(start)}–${clockOf(Math.min(24 * 60 - 1, start + endMinutes(current) - startMinutes(current)))}` : clockOf(start);
    }
    if (after.time === base.time) continue;
    if (op !== undefined) op.after = after;
    else command.ops.push(makeOp("links", placeId, current, after));
  }
  return command;
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
/**
 * The order of the cards of one day of a calendar: by start time (cards without a time first), then by the order
 * that the user dragged them into (`rank`), then by the time the items were made.
 */
export function dayOrder(store: Store): (a: PlaceLink, b: PlaceLink) => number {
  const created = (place: PlaceLink) => store.get("items", place.to)?.created ?? "";
  return (a, b) =>
    startMinutes(a) - startMinutes(b) ||
    (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) ||
    (created(a) < created(b) ? -1 : created(a) > created(b) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Moves a card inside its day of a calendar: it goes before `beforeId` (null: at the end). The cards of the day get
 * their new order (`rank`). One command.
 */
export function reorderInDay(context: ActionContext, placeId: Id, beforeId: Id | null): Command {
  const place = context.store.get("links", placeId);
  if (place?.kind !== "place" || place.outline === undefined || place.day === undefined) return { label: "Change order", ops: [] };
  const day = (cardsByDay(context.store, context.graph, place.outline).get(place.day) ?? []).sort(dayOrder(context.store)).filter((other) => other.id !== placeId);
  const at = beforeId === null ? day.length : Math.max(0, day.findIndex((other) => other.id === beforeId));
  day.splice(at === -1 ? day.length : at, 0, place);
  const ops: Op[] = [];
  day.forEach((card, rank) => {
    const current = context.store.get("links", card.id);
    if (current?.kind !== "place" || current.rank === rank) return;
    ops.push(makeOp("links", card.id, current, { ...current, rank }));
  });
  return { label: "Change order", ops };
}

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
export function createOnDay(context: ActionContext, calendarId: Id, day: string, view: ViewStyle, options: { board?: boolean; author?: string; time?: string } = {}): { command: Command; itemId: Id; placeId: Id } | null {
  const calendar = context.store.get("outlines", calendarId);
  if (calendar === undefined) return null;
  const created = createItemOnBoard(context, { boardId: calendar.board, view, x: calendar.x, y: calendar.y, name: dayName(day, view, options.board === true, takenNames(context.store)), board: options.board, author: options.author });
  for (const op of created.command.ops) {
    if (op.table === "items" && op.after !== null) (op.after as ItemRecord).date = day;
    if (op.table === "links" && op.after !== null) Object.assign(op.after as PlaceLink, { outline: calendarId, day, expanded: true }, options.time === undefined ? {} : { time: options.time });
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
  // A radial is a graph, not a list: its board keeps the board look.
  if (group.type === "radial") return null;
  const cards = graph.childrenOf(boardId).filter((place) => !store.has("stamps", place.to));
  if (!cards.every((place) => place.outline === group.id)) return null;
  if (cards.length === 0 && !isCalendar(group)) return null;
  return isCalendar(group) ? "calendar" : "outline";
}

/** A name for a group: its name, or its type. */
export function groupTitle(group: OutlineRecord, words: Words = ENGLISH): string {
  return group.name ?? (isCalendar(group) ? words("Calendar") : group.type === "radial" ? words("Radial") : words("Outline"));
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
  } else if (group.type === "radial") {
    // A radial: its cards, one after the other (they have no order of their own).
    for (const place of radialMembers(store, graph, groupId)) {
      if (nameOf(place.to) !== "") blocks.push(`## ${nameOf(place.to)}`);
      if (bodyOf(place.to) !== "") blocks.push(bodyOf(place.to));
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
