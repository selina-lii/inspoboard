import { describe, expect, it } from "vitest";
import { createItemOnBoard } from "../src/core/actions";
import { decodeVault, encodeVault } from "../src/core/format";
import { calendarFrameSize, calendarPointAt, CALENDAR, createCalendar, createOnDay, setCalendarView, setCardSchedule, snapToDay, snapToTime, stepView, viewTitle, WEEK, weekDays, weekStripHeight, YEAR, yearMonthCorner } from "../src/core/groups";
import { schemaErrors } from "../src/core/validate";
import { buildBoardModel } from "../src/ui/board/boardModel";
import { loadTestContext, ROOT } from "./helpers";

const TOOL_PLACE = "p1a1a1a1a1a1";
const IDEAS_PLACE = "p2b2b2b2b2b2";

function withCalendar(view?: "week" | "year") {
  const context = loadTestContext();
  const { command, calendarId } = createCalendar(context, ROOT, 1000, 0, "2026-01", "2026-03");
  context.history.run(command);
  if (view !== undefined) context.history.run(setCalendarView(context, calendarId, view));
  return { context, calendarId, calendar: () => context.store.get("outlines", calendarId)! };
}

describe("calendar views (week, month, year)", () => {
  it("saves the view on the calendar; the month view is the default (no field)", () => {
    const { context, calendarId, calendar } = withCalendar("week");
    expect(calendar().view).toBe("week");
    expect(schemaErrors("outlines", calendar())).toEqual([]);
    context.history.run(setCalendarView(context, calendarId, "month"));
    expect(calendar()).not.toHaveProperty("view");
    context.history.undo();
    expect(calendar().view).toBe("week");
    // The field goes through the files and back.
    const again = decodeVault(encodeVault(context.store, { format: 2, root: ROOT })).store.get("outlines", calendarId)!;
    expect(again.view).toBe("week");
  });

  it("steps by weeks, months, and years, and names the period", () => {
    expect(weekDays("2026-01-01")).toEqual(["2025-12-28", "2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02", "2026-01-03"]);
    expect(stepView("week", "2026-01-01", 1)).toBe("2026-01-04");
    expect(stepView("month", "2026-01-20", -1)).toBe("2025-12-01");
    expect(stepView("year", "2026-05-20", 1)).toBe("2027-05-01");
    expect(viewTitle("week", "2026-01-01")).toEqual(["December 2025", "January 2026"]);
    expect(viewTitle("week", "2026-03-31")).toEqual(["March", "April 2026"]);
    expect(viewTitle("week", "2026-01-14")).toEqual(["January 2026"]);
    expect(viewTitle("year", "2026-01-14")).toEqual(["2026"]);
  });

  it("week view: timed cards at their hours, all-day and multi-day cards in the strip, overlapping times side by side", () => {
    const { context, calendarId, calendar } = withCalendar("week");
    context.history.run(snapToDay(context, [TOOL_PLACE, IDEAS_PLACE], calendarId, "2026-01-14"));
    context.history.run(setCardSchedule(context, TOOL_PLACE, { day: "2026-01-14", until: null, time: "09:00–11:00" }));
    context.history.run(setCardSchedule(context, IDEAS_PLACE, { day: "2026-01-14", until: null, time: "10:00" }));
    const longOne = createOnDay(context, calendarId, "2026-01-12", "note")!;
    context.history.run(longOne.command);
    context.history.run(setCardSchedule(context, longOne.placeId, { day: "2026-01-12", until: "2026-01-20", time: null }));
    const model = buildBoardModel(context.store, context.graph, ROOT, { days: new Map([[calendarId, "2026-01-14"]]) });
    const frame = model.nodes.find((node) => node.kind === "calendar")!;
    expect(frame).toMatchObject({ calendarView: "week", calendarDay: "2026-01-14", calendarLanes: 1 });
    expect(frame.h).toBe(calendarFrameSize("week", 1).h);
    const c = calendar();
    const gridTop = c.y + CALENDAR.bar + WEEK.head + weekStripHeight(1);
    const tool = model.nodes.find((node) => node.placeId === TOOL_PLACE)!;
    const ideas = model.nodes.find((node) => node.placeId === IDEAS_PLACE)!;
    expect(tool.y).toBe(gridTop + 9 * WEEK.hourH);
    expect(tool.h).toBeCloseTo(2 * WEEK.hourH - 2);
    expect(ideas.y).toBe(gridTop + 10 * WEEK.hourH);
    // 9–11 and 10–11 overlap: each one takes half of the day.
    expect(ideas.x).toBeGreaterThan(tool.x);
    expect(tool.w).toBeLessThan(WEEK.cellW / 2);
    // Wednesday 14 January: column 3.
    expect(tool.x).toBeCloseTo(c.x + CALENDAR.pad + WEEK.gutter + 3 * WEEK.cellW + 3);
    // The multi-day card: a bar from Monday (column 1) to Saturday (the end of the week), in the strip.
    const bar = model.nodes.find((node) => node.placeId === longOne.placeId)!;
    expect(bar.y).toBeLessThan(gridTop);
    expect(bar.w).toBeCloseTo(6 * WEEK.cellW - 6);
    // A card of another week does not show.
    const next = buildBoardModel(context.store, context.graph, ROOT, { days: new Map([[calendarId, "2026-01-28"]]) });
    expect(next.nodes.some((node) => node.placeId === TOOL_PLACE)).toBe(false);
  });

  it("week view: a drop sets the day and the time (keeping the length); in the strip it is all day", () => {
    const { context, calendarId, calendar } = withCalendar("week");
    const c = calendar();
    const gridTop = c.y + CALENDAR.bar + WEEK.head + weekStripHeight(1);
    const column = (index: number) => c.x + CALENDAR.pad + WEEK.gutter + index * WEEK.cellW + 10;
    expect(calendarPointAt(c, "week", "2026-01-14", { x: column(4), y: gridTop + 14.6 * WEEK.hourH })).toEqual({ day: "2026-01-15", minutes: 14 * 60 + 30 });
    expect(calendarPointAt(c, "week", "2026-01-14", { x: column(0), y: gridTop - 5 })).toEqual({ day: "2026-01-11", minutes: null });
    expect(calendarPointAt(c, "week", "2026-01-14", { x: c.x + 5, y: gridTop })).toBeNull();
    context.history.run(snapToDay(context, [TOOL_PLACE], calendarId, "2026-01-14"));
    context.history.run(setCardSchedule(context, TOOL_PLACE, { day: "2026-01-14", until: null, time: "09:00–10:30" }));
    context.history.run(snapToTime(context, [TOOL_PLACE], calendarId, "2026-01-15", 14 * 60));
    expect(context.store.get("links", TOOL_PLACE)).toMatchObject({ day: "2026-01-15", time: "14:00–15:30" });
    // A card from the board onto the hour grid: the start only.
    context.history.run(snapToTime(context, [IDEAS_PLACE], calendarId, "2026-01-16", 8 * 60 + 15));
    expect(context.store.get("links", IDEAS_PLACE)).toMatchObject({ outline: calendarId, day: "2026-01-16", time: "08:15" });
    context.history.run(snapToTime(context, [TOOL_PLACE], calendarId, "2026-01-15", null));
    expect(context.store.get("links", TOOL_PLACE)).not.toHaveProperty("time");
    // One undo step for each drop.
    context.history.undo();
    expect(context.store.get("links", TOOL_PLACE)).toMatchObject({ time: "14:00–15:30" });
  });

  it("week view: a create tool in the hour grid makes an item at that hour", () => {
    const { context, calendarId } = withCalendar("week");
    const created = createOnDay(context, calendarId, "2026-01-14", "todo", { time: "13:00–14:00" })!;
    context.history.run(created.command);
    expect(context.store.get("links", created.placeId)).toMatchObject({ day: "2026-01-14", time: "13:00–14:00" });
  });

  it("year view: all cards hide; each day has its number of cards; a point finds its day", () => {
    const { context, calendarId, calendar } = withCalendar("year");
    context.history.run(snapToDay(context, [TOOL_PLACE, IDEAS_PLACE], calendarId, "2026-02-03"));
    const model = buildBoardModel(context.store, context.graph, ROOT, { days: new Map([[calendarId, "2026-02-03"]]) });
    const frame = model.nodes.find((node) => node.kind === "calendar")!;
    expect(frame.dayCounts).toEqual({ "2026-02-03": 2 });
    expect(model.nodes.some((node) => node.placeId === TOOL_PLACE)).toBe(false);
    const c = calendar();
    // February: small month 1. 3 February 2026 is a Tuesday in the first week row.
    const corner = yearMonthCorner(1);
    const point = { x: c.x + corner.x + 2 * YEAR.cellW + 5, y: c.y + corner.y + YEAR.title + YEAR.weekdays + 5 };
    expect(calendarPointAt(c, "year", "2026-02-03", point)).toEqual({ day: "2026-02-03", minutes: null });
    // A free cell before the first day (1 January 2026 is a Thursday): no day.
    const january = yearMonthCorner(0);
    expect(calendarPointAt(c, "year", "2026-02-03", { x: c.x + january.x + 5, y: c.y + january.y + YEAR.title + YEAR.weekdays + 5 })).toBeNull();
  });

  it("an older calendar (no view field) shows the month view, and the old month view state still works", () => {
    const context = loadTestContext();
    const { command, calendarId } = createCalendar(context, ROOT, 0, 0, "2026-01", "2026-03");
    context.history.run(command);
    const card = createItemOnBoard(context, { boardId: ROOT, view: "note", x: 0, y: 0 });
    context.history.run(card.command);
    const frame = buildBoardModel(context.store, context.graph, ROOT, { months: new Map([[calendarId, "2026-02"]]) }).nodes.find((node) => node.kind === "calendar")!;
    expect(frame).toMatchObject({ calendarView: "month", month: "2026-02", calendarDay: "2026-02-01" });
    expect(frame.h).toBe(calendarFrameSize("month").h);
  });
});
