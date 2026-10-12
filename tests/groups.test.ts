import { describe, expect, it } from "vitest";
import { attachItem, completeItems, createItemOnBoard, createReply, deleteThread, setPlacementExpanded, setResolved } from "../src/core/actions";
import { decodeVault, encodeVault } from "../src/core/format";
import {
  addMonths,
  boardGroupType,
  createCalendar,
  createOnDay,
  dayName,
  daysOf,
  setCardDays,
  setCardSchedule,
  setCardTime,
  CALENDAR,
  dayAt,
  gridDays,
  dayCell,
  defaultMonth,
  deleteCalendar,
  groupDocument,
  monthDays,
  monthsOf,
  renameGroup,
  setCalendarRange,
  snapToDay,
  reorderInDay,
  dayOrder,
  cardsByDay,
} from "../src/core/groups";
import { linearize } from "../src/core/linearize";
import { createOutline, removeFromOutline } from "../src/core/outline";
import { schemaErrors } from "../src/core/validate";
import { buildBoardModel } from "../src/ui/board/boardModel";
import { buildGalaxyModel } from "../src/ui/galaxy/galaxyModel";
import { scheduleOf } from "../src/ui/dialogs/ScheduleFields";
import { DATA_INTEGRITY, IDEAS, loadTestContext, ROOT, TOOL_RESEARCH } from "./helpers";

const TOOL_PLACE = "p1a1a1a1a1a1";
const IDEAS_PLACE = "p2b2b2b2b2b2";
const INTEGRITY_ON_ROOT = "p4d4d4d4d4d4";
const heightOf = (place: { h: number }) => place.h;

function withCalendar() {
  const context = loadTestContext();
  const { command, calendarId } = createCalendar(context, ROOT, 1000, 0, "2026-01", "2026-03");
  context.history.run(command);
  return { context, calendarId };
}

describe("calendar groups", () => {
  it("orders the cards of a day by creation, and a drag gives them a new order", () => {
    const { context, calendarId } = withCalendar();
    context.history.run(snapToDay(context, [TOOL_PLACE, INTEGRITY_ON_ROOT], calendarId, "2026-01-15"));
    const order = () => (cardsByDay(context.store, context.graph, calendarId).get("2026-01-15") ?? []).sort(dayOrder(context.store)).map((place) => place.id);
    const before = order();
    expect(before).toHaveLength(2);
    // The second card goes first.
    context.history.run(reorderInDay(context, before[1]!, before[0]!));
    expect(order()).toEqual([before[1], before[0]]);
    // A move to a different day takes its order away: it is ordered by creation there.
    context.history.run(snapToDay(context, [before[1]!], calendarId, "2026-01-16"));
    expect((context.store.get("links", before[1]!) as { rank?: number }).rank).toBeUndefined();
  });

  it("cards can span days (no time) or have a time (one day); a move keeps the length", () => {
    const { context, calendarId } = withCalendar();
    context.history.run(snapToDay(context, [TOOL_PLACE], calendarId, "2026-01-15"));
    context.history.run(setCardDays(context, TOOL_PLACE, "2026-01-17"));
    const itemId = context.store.get("links", TOOL_PLACE)!.to;
    expect(context.store.get("links", TOOL_PLACE)).toMatchObject({ day: "2026-01-15", until: "2026-01-17" });
    expect(context.store.get("items", itemId)!.date).toBe("2026-01-15/2026-01-17");
    expect(daysOf(context.store.get("links", TOOL_PLACE) as never)).toEqual(["2026-01-15", "2026-01-16", "2026-01-17"]);
    // A move keeps three days, also across a month.
    context.history.run(snapToDay(context, [TOOL_PLACE], calendarId, "2026-01-30"));
    expect(context.store.get("links", TOOL_PLACE)).toMatchObject({ day: "2026-01-30", until: "2026-02-01" });
    // A time: one day again.
    context.history.run(setCardTime(context, TOOL_PLACE, "09:30-11:00"));
    expect(context.store.get("links", TOOL_PLACE)).toMatchObject({ day: "2026-01-30", time: "09:30–11:00" });
    expect(context.store.get("links", TOOL_PLACE)).not.toHaveProperty("until");
    expect(context.store.get("items", itemId)!.date).toBe("2026-01-30");
    // The vault stays valid and writes the new fields.
    expect(schemaErrors("links", context.store.get("links", TOOL_PLACE))).toEqual([]);
    expect(schemaErrors("links", { ...context.store.get("links", TOOL_PLACE)!, until: "2026-01-31" })).toHaveLength(1); // a span cannot have a time
    expect(decodeVault(encodeVault(context.store, { format: 1, root: ROOT })).store.get("links", TOOL_PLACE)).toMatchObject({ time: "09:30–11:00" });
  });

  it("sets days and time from one From/To schedule; a card on many weeks is one node per week row", () => {
    const { context, calendarId } = withCalendar();
    context.history.run(snapToDay(context, [TOOL_PLACE], calendarId, "2026-01-15"));
    expect(scheduleOf({ fromDay: "01-20-2026", fromTime: "09:00", toDay: "2026-01-28", toTime: "" })).toEqual({ day: "2026-01-20", until: "2026-01-28", time: null });
    expect(scheduleOf({ fromDay: "2026-01-20", fromTime: "9:00", toDay: "2026-01-20", toTime: "10:30" })).toEqual({ day: "2026-01-20", until: null, time: "09:00–10:30" });
    expect(typeof scheduleOf({ fromDay: "2026-01-20", fromTime: "", toDay: "2026-01-19", toTime: "" })).toBe("string");
    context.history.run(setCardSchedule(context, TOOL_PLACE, { day: "2026-01-20", until: "2026-01-28", time: null }));
    const itemId = context.store.get("links", TOOL_PLACE)!.to;
    expect(context.store.get("links", TOOL_PLACE)).toMatchObject({ day: "2026-01-20", until: "2026-01-28" });
    expect(context.store.get("items", itemId)!.date).toBe("2026-01-20/2026-01-28");
    // January 2026 starts on a Thursday: the 20th to the 28th is in two week rows. Each row is a card node of the same place.
    context.history.run(setCalendarRange(context, calendarId, "2026-01", "2026-01"));
    const rows = buildBoardModel(context.store, context.graph, ROOT).nodes.filter((node) => node.placeId === TOOL_PLACE);
    expect(rows.map((node) => node.id)).toEqual([TOOL_PLACE, `${TOOL_PLACE}~1`]);
    expect(rows.map((node) => node.spanOffset)).toEqual([0, 5]); // the second row starts on Sunday, 2026-01-25
    expect(rows.every((node) => node.recordId === itemId && node.inCalendar)).toBe(true);
    // One day with a time.
    context.history.run(setCardSchedule(context, TOOL_PLACE, { day: "2026-01-21", until: null, time: "09:00–10:30" }));
    expect(context.store.get("links", TOOL_PLACE)).toMatchObject({ day: "2026-01-21", time: "09:00–10:30" });
    expect(context.store.get("links", TOOL_PLACE)).not.toHaveProperty("until");
  });

  it("names items without a name by their day; sets the date of each item on a day", () => {
    expect(dayName("2026-09-01", "page", false, new Set(["09-01-2026 page1"]))).toBe("09-01-2026 page2");
    expect(dayName("2026-09-01", "todo", false, new Set())).toBe("09-01-2026 todo1");
    const { context, calendarId } = withCalendar();
    const created = createOnDay(context, calendarId, "2026-01-05", "page")!;
    context.history.run(created.command);
    expect(context.store.get("items", created.itemId)).toMatchObject({ name: "01-05-2026 page1", date: "2026-01-05" });
    expect(context.store.get("items", created.itemId)).not.toHaveProperty("codeName");
    expect(context.store.get("links", created.placeId)).toMatchObject({ outline: calendarId, day: "2026-01-05" });
    // A card with a name keeps it; it gets the date.
    const before = context.store.get("items", context.store.get("links", TOOL_PLACE)!.to)!;
    context.history.run(snapToDay(context, [TOOL_PLACE], calendarId, "2026-01-15"));
    expect(context.store.get("items", before.id)).toMatchObject({ name: before.name, date: "2026-01-15" });
    // A card with no name gets a day name.
    const note = createItemOnBoard(context, { boardId: ROOT, view: "note", x: 0, y: 0 });
    context.history.run(note.command);
    context.history.run(snapToDay(context, [note.placeId], calendarId, "2026-01-05"));
    expect(context.store.get("items", note.itemId)!.name).toBe("01-05-2026 note1");
  });

  it("knows months, weekdays, and day cells", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    // 1 January 2026 is a Thursday: three empty days (Mo, Tu, We) before it.
    expect(monthDays("2026-01")).toMatchObject({ offset: 4 });
    expect(monthDays("2024-02").days).toHaveLength(29);
    const { context, calendarId } = withCalendar();
    const calendar = context.store.get("outlines", calendarId)!;
    expect(monthsOf(calendar, "2030-01")).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(defaultMonth(calendar, "2026-02-14T10:00:00Z")).toBe("2026-02");
    expect(defaultMonth(calendar, "2027-05-01T10:00:00Z")).toBe("2026-01");
    const cell = dayCell(calendar, "2026-01", "2026-01-15")!;
    expect(dayAt(calendar, "2026-01", { x: cell.x + 5, y: cell.y + 5 })).toBe("2026-01-15");
    // The grid shows the days of the month before and after too: the first cell is Sunday 28 December 2025.
    expect(dayAt(calendar, "2026-01", { x: calendar.x + 15, y: cell.y - 200 })).toBe("2025-12-28");
    expect(gridDays("2026-01")).toHaveLength(42);
    expect([gridDays("2026-01")[0], gridDays("2026-01")[41]]).toEqual(["2025-12-28", "2026-02-07"]);
    expect(dayAt(calendar, "2026-01", { x: calendar.x - 50, y: cell.y })).toBeNull();
  });

  it("puts cards on days; other months hide them; leaving and deleting keep the cards; undo works", () => {
    const { context, calendarId } = withCalendar();
    context.history.run(snapToDay(context, [TOOL_PLACE], calendarId, "2026-01-15"));
    context.history.run(snapToDay(context, [IDEAS_PLACE], calendarId, "2026-02-20"));
    expect(context.store.get("links", TOOL_PLACE)).toMatchObject({ outline: calendarId, day: "2026-01-15" });

    const january = buildBoardModel(context.store, context.graph, ROOT, { months: new Map([[calendarId, "2026-01"]]) });
    expect(january.nodes.find((node) => node.kind === "calendar")).toMatchObject({ month: "2026-01", months: ["2026-01", "2026-02", "2026-03"] });
    expect(january.nodes.find((node) => node.placeId === TOOL_PLACE)).toMatchObject({ inCalendar: true, frameId: `calendar:${calendarId}` });
    expect(january.nodes.some((node) => node.placeId === IDEAS_PLACE)).toBe(false);

    context.history.run(removeFromOutline(context, [TOOL_PLACE], heightOf, new Map([[TOOL_PLACE, { x: 5, y: 6 }]])));
    expect(context.store.get("links", TOOL_PLACE)).not.toHaveProperty("day");
    expect(context.store.get("links", TOOL_PLACE)).toMatchObject({ x: 5, y: 6 });
    // An empty day does not delete the calendar.
    expect(context.store.has("outlines", calendarId)).toBe(true);

    context.history.run(deleteCalendar(context, calendarId));
    expect(context.store.has("outlines", calendarId)).toBe(false);
    expect(context.store.get("links", IDEAS_PLACE)).not.toHaveProperty("outline");
    context.history.undo();
    expect(context.store.get("links", IDEAS_PLACE)).toMatchObject({ outline: calendarId, day: "2026-02-20" });
  });

  it("shows only the days of the shown month: a card into the next month shows its days in this month", () => {
    const { context, calendarId } = withCalendar();
    context.history.run(snapToDay(context, [TOOL_PLACE], calendarId, "2026-01-27"));
    context.history.run(setCardSchedule(context, TOOL_PLACE, { day: "2026-01-27", until: "2026-02-04", time: null }));
    context.history.run(setPlacementExpanded(context, TOOL_PLACE, true));
    const rows = buildBoardModel(context.store, context.graph, ROOT, { months: new Map([[calendarId, "2026-01"]]) }).nodes.filter((node) => node.placeId === TOOL_PLACE);
    // 27 January to 4 February: in January, only 27 to 31 January show (one week row). The February days hold no cards.
    expect(rows.map((node) => node.spanOffset)).toEqual([0]);
    expect(rows[0]!.w).toBeGreaterThan(4 * 150);
    const february = buildBoardModel(context.store, context.graph, ROOT, { months: new Map([[calendarId, "2026-02"]]) }).nodes.filter((node) => node.placeId === TOOL_PLACE);
    expect(february.map((node) => node.spanOffset)).toEqual([5]);
    // The data does not change.
    expect(context.store.get("links", TOOL_PLACE)).toMatchObject({ day: "2026-01-27", until: "2026-02-04" });
  });

  it("opens one card of a full day over its neighbors (view state only)", () => {
    const { context, calendarId } = withCalendar();
    context.history.run(snapToDay(context, [TOOL_PLACE, IDEAS_PLACE], calendarId, "2026-01-15"));
    const before = context.store.get("links", IDEAS_PLACE);
    const view = (popped: Set<string>) => buildBoardModel(context.store, context.graph, ROOT, { months: new Map([[calendarId, "2026-01"]]), popped }).nodes.find((node) => node.placeId === IDEAS_PLACE)!;
    // Two cards on one day: both show only their names.
    expect(view(new Set())).toMatchObject({ expanded: false, calendarPopped: false });
    // The second card opens over its neighbor.
    const opened = view(new Set([IDEAS_PLACE]));
    const folded = view(new Set());
    expect(opened).toMatchObject({ expanded: true, calendarPopped: true });
    // The quick view keeps its top (the text does not move) and fits in its day.
    expect(opened.y).toBe(folded.y);
    expect(opened.h).toBeGreaterThan(folded.h);
    const calendar = context.store.get("outlines", calendarId)!;
    const dayBottom = dayCell(calendar, "2026-01", "2026-01-15")!;
    expect(opened.y + opened.h).toBeLessThanOrEqual(dayBottom.y + CALENDAR.cellH);
    expect(context.store.get("links", IDEAS_PLACE)).toEqual(before);
  });

  it("changes its range and name, exports one document, and saves as before", () => {
    const { context, calendarId } = withCalendar();
    context.history.run(snapToDay(context, [TOOL_PLACE], calendarId, "2026-01-15"));
    context.history.run(setCalendarRange(context, calendarId, "2026-04", "2026-02"));
    expect(context.store.get("outlines", calendarId)).toMatchObject({ start: "2026-04", end: "2026-04" });
    context.history.run(renameGroup(context, calendarId, " Plan "));
    expect(context.store.get("outlines", calendarId)?.name).toBe("Plan");
    const document = groupDocument(context.store, context.graph, calendarId);
    expect(document).toContain("# Plan");
    expect(document).toContain("## Th 2026-01-15");
    expect(document).toContain("### Tool research");
    expect(linearize(context.store, context.graph, ROOT)).toContain("## Plan");
    expect(schemaErrors("outlines", context.store.get("outlines", calendarId))).toEqual([]);
    expect(schemaErrors("outlines", { id: "abcdefabcdef", board: ROOT, x: 0, y: 0, type: "calendar", start: "2026-13" })).toHaveLength(1);
    expect(schemaErrors("links", { ...context.store.get("links", TOOL_PLACE)!, day: "2026-1-5" })).toHaveLength(1);
    const files = encodeVault(context.store, { format: 1, root: ROOT });
    const again = decodeVault(files);
    expect(again.problems).toEqual([]);
    expect(again.store.get("outlines", calendarId)).toEqual(context.store.get("outlines", calendarId));
    expect(again.store.get("links", TOOL_PLACE)).toEqual(context.store.get("links", TOOL_PLACE));
  });

  it("makes a board an outline or calendar board when the group is all it holds", () => {
    const context = loadTestContext();
    expect(boardGroupType(context.store, context.graph, ROOT)).toBeNull();
    // A board with one calendar and nothing else.
    const { command, itemId } = createItemOnBoard(context, { boardId: ROOT, view: "note", x: 0, y: 0, board: true });
    context.history.run(command);
    context.history.run(createCalendar(context, itemId, 0, 0, "2026-01").command);
    expect(boardGroupType(context.store, context.graph, itemId)).toBe("calendar");
    // The root board with all its cards in one outline (scribbles do not count).
    const all = [...context.graph.childrenOf(ROOT)].filter((place) => !context.store.has("stamps", place.to)).map((place) => place.id);
    context.history.run(createOutline(context, ROOT, all).command);
    expect(boardGroupType(context.store, context.graph, ROOT)).toBe("outline");
    const galaxy = buildGalaxyModel(context.store, context.graph, ROOT);
    const group = galaxy.points.find((point) => point.kind === "group");
    expect(group).toMatchObject({ groupType: "outline" });
    expect(group!.tree.length).toBeGreaterThan(0);
    expect(galaxy.points.find((point) => point.recordId === itemId)?.groupType).toBe("calendar");
  });
});

describe("objects", () => {
  // A comment on a card that is not a page shows on the board. (A page holds its comments: boardModel.test.ts.)
  it("attaches a comment with a signature; it shows at the side of its card, with a line", () => {
    const context = loadTestContext();
    const { command, itemId, placeId } = createItemOnBoard(context, { boardId: ROOT, view: "comment", x: 0, y: 0, on: DATA_INTEGRITY, author: " Ada ", quote: "tools" });
    context.history.run(command);
    expect(context.store.get("items", itemId)).toMatchObject({ name: "", author: "Ada", on: DATA_INTEGRITY, quote: "tools" });
    expect(context.graph.attachedTo(DATA_INTEGRITY).map((item) => item.id)).toEqual([itemId]);
    const model = buildBoardModel(context.store, context.graph, ROOT);
    const card = model.nodes.find((node) => node.placeId === "p4d4d4d4d4d4")!;
    const comment = model.nodes.find((node) => node.placeId === placeId)!;
    expect(comment).toMatchObject({ pinned: true, attachedTo: DATA_INTEGRITY, author: "Ada", x: card.x + card.w + 18, y: card.y });
    expect(model.edges.some((edge) => edge.kind === "attach" && edge.source === placeId)).toBe(true);
    // Exports show the comment under its item, not as an item of its own.
    const text = linearize(context.store, context.graph, ROOT);
    expect(text).toContain("> **Ada** on “tools”:");
    context.history.run(attachItem(context, itemId, null));
    expect(context.store.get("items", itemId)).not.toHaveProperty("on");
    expect(context.store.get("items", itemId)).not.toHaveProperty("quote");
    expect(schemaErrors("items", { ...context.store.get("items", itemId)!, on: "bad" })).toHaveLength(1);
  });

  it("makes link, action item, and flashcard objects; Done removes an action item, undo brings it back", () => {
    const context = loadTestContext();
    const link = createItemOnBoard(context, { boardId: ROOT, view: "weblink", x: 0, y: 0, url: "https://a.example" });
    context.history.run(link.command);
    expect(context.store.get("items", link.itemId)).toMatchObject({ name: "", url: "https://a.example" });
    const todo = createItemOnBoard(context, { boardId: ROOT, view: "todo", x: 0, y: 0, body: "Call" });
    context.history.run(todo.command);
    expect(context.store.get("links", todo.placeId)).toMatchObject({ view: "todo", expanded: true, color: "#f4ff3a" });
    const card = createItemOnBoard(context, { boardId: ROOT, view: "flashcard", x: 0, y: 0, name: "Front", body: "Back" });
    context.history.run(card.command);
    expect(context.store.get("items", card.itemId)?.name).toBe("Front");
    expect(context.store.get("texts", card.itemId)?.body).toBe("Back");
    context.history.run(completeItems(context, [todo.itemId]));
    expect(context.store.has("items", todo.itemId)).toBe(false);
    expect(context.store.has("links", todo.placeId)).toBe(false);
    context.history.undo();
    expect(context.store.get("texts", todo.itemId)?.body).toBe("Call");
    expect(schemaErrors("links", context.store.get("links", card.placeId))).toEqual([]);
    expect(IDEAS).toBeTruthy();
  });

  it("keeps a thread of replies; resolve hides it and keeps it; delete removes the thread; undo brings it back", () => {
    const context = loadTestContext();
    const { command, itemId: commentId, placeId } = createItemOnBoard(context, { boardId: ROOT, view: "comment", x: 0, y: 0, on: DATA_INTEGRITY, author: "Ada" });
    context.history.run(command);
    const reply = createReply(context, commentId, "Bo", "Agreed");
    context.history.run(reply.command);
    context.history.run(createReply(context, reply.itemId, "Ada", "Thanks").command);
    // A reply has no placement, and it is not an unplaced item.
    expect(context.graph.parentsOf(reply.itemId)).toEqual([]);
    expect(context.graph.unplacedItems(ROOT)).not.toContain(reply.itemId);
    let model = buildBoardModel(context.store, context.graph, ROOT);
    expect(model.nodes.find((node) => node.placeId === placeId)?.replies.map((entry) => entry.text)).toEqual(["Agreed", "Thanks"]);
    expect(model.nodes.some((node) => node.recordId === reply.itemId)).toBe(false);
    expect(linearize(context.store, context.graph, ROOT)).toContain("> > **Bo**: Agreed");

    context.history.run(setResolved(context, commentId, true));
    model = buildBoardModel(context.store, context.graph, ROOT);
    expect(model.nodes.some((node) => node.placeId === placeId)).toBe(false);
    expect(context.store.has("items", reply.itemId)).toBe(true);
    expect(linearize(context.store, context.graph, ROOT)).toContain("(resolved)");

    context.history.run(deleteThread(context, commentId));
    expect(context.store.has("items", commentId)).toBe(false);
    expect(context.store.has("items", reply.itemId)).toBe(false);
    context.history.undo();
    expect(context.store.get("texts", reply.itemId)?.body).toBe("Agreed");
    expect(schemaErrors("items", context.store.get("items", commentId))).toEqual([]);
  });
});
