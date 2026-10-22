// The calendar frame on a board (docs/SPEC.md section 7.6), with three views as in Google Calendar:
// - Month: a month grid, Sunday first. Cards of the shown month sit in their days.
// - Week: 7 day columns. At the top, a strip for all-day and multi-day cards; under it an hour grid with the cards
//   that have a time.
// - Year: 12 small months. A day with cards has a dot; a click on a day opens its week.
// The cards are board nodes (boardModel.ts puts them in place); the frame draws only the grid. Its sizes come from
// CALENDAR, WEEK, and YEAR in core/groups.ts, so the cards and the grid agree.

import type { NodeProps } from "@xyflow/react";
import { CalendarDays, ChevronLeft, ChevronRight, GripHorizontal } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { CALENDAR, gridDays, monthOf, monthTitle, monthsInView, stepView, viewTitle, WEEK, WEEKDAYS, weekDays, weekStripHeight, YEAR, yearMonthCorner } from "../../core/groups";
import { CALENDAR_VIEWS, type CalendarView } from "../../core/types";
import { GroupName, useBoardCallbacks, type BoardNodeData, type FlowNode } from "./nodes";

const VIEW_NAMES: Record<CalendarView, string> = { week: "Week", month: "Month", year: "Year" };
const STEP_TIPS: Record<CalendarView, [string, string]> = { week: ["Week before", "Week after"], month: ["Month before", "Month after"], year: ["Year before", "Year after"] };

/** Today as "YYYY-MM-DD" (the day of the computer). */
function todayOf(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** The minutes of the day now. It changes each minute (the line of the time in the week view). */
function useMinuteOfDay(on: boolean): number {
  const read = () => new Date().getHours() * 60 + new Date().getMinutes();
  const [minute, setMinute] = useState(read);
  useEffect(() => {
    if (!on) return;
    const timer = window.setInterval(() => setMinute(read()), 60_000);
    return () => window.clearInterval(timer);
  }, [on]);
  return minute;
}

export function CalendarNode({ data, selected }: NodeProps<FlowNode>) {
  const { node } = data;
  const callbacks = useBoardCallbacks();
  const view = node.calendarView;
  const day = node.calendarDay;
  const today = todayOf();
  const calendarId = node.outlineId;
  const inRange = (one: string) => monthsInView(view, one).some((month) => node.months.includes(month));
  const go = (step: number) => (event: MouseEvent) => {
    event.stopPropagation();
    const next = stepView(view, day, step);
    if (calendarId !== null && inRange(next)) callbacks.onCalendarDay(calendarId, next);
  };
  const stop = (event: MouseEvent) => event.stopPropagation();
  const openWeek = (one: string) => (event: MouseEvent) => {
    event.stopPropagation();
    if (calendarId !== null) callbacks.onCalendarView(calendarId, "week", one);
  };
  return (
    <div className={`calendar-frame view-${view}${selected ? " selected" : ""}${data.dropTarget === true ? " drop-target" : ""}`} style={{ padding: `0 ${CALENDAR.pad}px` }}>
      <div className="calendar-bar" style={{ height: CALENDAR.bar }}>
        <GripHorizontal size={14} className="outline-grip" />
        <CalendarDays size={14} className="group-icon calendar" />
        <GroupName data={data} />
        <span className="spacer" />
        <span className="calendar-views nodrag" role="group">
          {CALENDAR_VIEWS.map((option) => (
            <button
              key={option}
              className={option === view ? "on" : undefined}
              onClick={(event) => {
                event.stopPropagation();
                if (calendarId !== null && option !== view) callbacks.onCalendarView(calendarId, option);
              }}
              onDoubleClick={stop}
            >
              {VIEW_NAMES[option]}
            </button>
          ))}
        </span>
        <button
          className="calendar-today nodrag"
          data-tip="Go to today"
          onClick={(event) => {
            event.stopPropagation();
            if (calendarId !== null) callbacks.onCalendarJump(calendarId, today);
          }}
          onDoubleClick={stop}
        >
          Today
        </button>
        <button className="icon-button small nodrag" data-tip={STEP_TIPS[view][0]} disabled={!inRange(stepView(view, day, -1))} onClick={go(-1)} onDoubleClick={stop}>
          <ChevronLeft size={14} />
        </button>
        {data.editing === "month" && calendarId !== null ? (
          <input
            className="calendar-month-input nodrag nopan"
            type="month"
            autoFocus
            defaultValue={node.month}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                if (event.currentTarget.value !== "") callbacks.onCalendarJump(calendarId, `${event.currentTarget.value}-01`);
                callbacks.onEndEdit();
              }
              if (event.key === "Escape") callbacks.onEndEdit();
            }}
            onBlur={(event) => {
              if (event.currentTarget.value !== "") callbacks.onCalendarJump(calendarId, `${event.currentTarget.value}-01`);
              callbacks.onEndEdit();
            }}
            onDoubleClick={stop}
          />
        ) : (
          <span className="calendar-month" data-tip="Double-click the calendar: go to any month">
            {viewTitle(view, day).map((part, index) => (
              <span key={index}>
                {index > 0 && " – "}
                <span>{part}</span>
              </span>
            ))}
          </span>
        )}
        <button className="icon-button small nodrag" data-tip={STEP_TIPS[view][1]} disabled={!inRange(stepView(view, day, 1))} onClick={go(1)} onDoubleClick={stop}>
          <ChevronRight size={14} />
        </button>
      </div>
      {view === "week" ? <WeekGrid node={node} today={today} /> : view === "year" ? <YearGrid node={node} today={today} openWeek={openWeek} /> : <MonthGrid node={node} today={today} openWeek={openWeek} />}
    </div>
  );
}

type GridProps = { node: BoardNodeData["node"]; today: string };

function MonthGrid({ node, today, openWeek }: GridProps & { openWeek(day: string): (event: MouseEvent) => void }) {
  const days = gridDays(node.month);
  return (
    <>
      <div className="calendar-weekdays" style={{ height: CALENDAR.weekdays, gridTemplateColumns: `repeat(7, ${CALENDAR.cellW}px)` }}>
        {WEEKDAYS.map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>
      <div className="calendar-grid" style={{ gridTemplateColumns: `repeat(7, ${CALENDAR.cellW}px)`, gridAutoRows: `${CALENDAR.cellH}px` }}>
        {Array.from({ length: 42 }, (_, slot) => {
          const day = days[slot]!;
          // A day of the month before or after: dimmed; its cards do not show here.
          const outside = !day.startsWith(node.month);
          const number = Number(day.slice(8));
          return (
            <div key={slot} className={`calendar-cell${outside ? " outside" : ""}${day === today ? " today" : ""}${slot % 7 === 0 || slot % 7 === 6 ? " weekend" : ""}`}>
              <button className="calendar-day nodrag" data-tip="Open this week" onClick={openWeek(day)} onDoubleClick={(event) => event.stopPropagation()}>
                {number === 1 ? `${monthTitle(day.slice(0, 7)).split(" ")[0]!.slice(0, 3)} 1` : number}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

function WeekGrid({ node, today }: GridProps) {
  const days = weekDays(node.calendarDay);
  const columns = `${WEEK.gutter}px repeat(7, ${WEEK.cellW}px)`;
  const todayColumn = days.indexOf(today);
  const minute = useMinuteOfDay(todayColumn !== -1);
  return (
    <>
      <div className="calendar-weekdays week-head" style={{ height: WEEK.head, gridTemplateColumns: columns }}>
        <span />
        {days.map((day, index) => (
          <span key={day} className={day === today ? "today" : undefined}>
            {WEEKDAYS[index]} <b>{Number(day.slice(8))}</b>
          </span>
        ))}
      </div>
      <div className="week-strip" style={{ height: weekStripHeight(node.calendarLanes), gridTemplateColumns: columns }}>
        <span className="week-hour">all day</span>
        {days.map((day, index) => (
          <span key={day} className={`week-strip-day${index === 0 || index === 6 ? " weekend" : ""}`} />
        ))}
      </div>
      <div className="week-hours" style={{ gridTemplateColumns: columns, gridAutoRows: `${WEEK.hourH}px` }}>
        {Array.from({ length: 24 }, (_, hour) => (
          <div key={hour} className="week-row" style={{ display: "contents" }}>
            <span className="week-hour">{hour === 0 ? "" : `${hour}:00`}</span>
            {days.map((day, index) => (
              <span key={day} className={`week-cell${index === 0 || index === 6 ? " weekend" : ""}${day === today ? " today" : ""}`} />
            ))}
          </div>
        ))}
        {todayColumn !== -1 && <span className="week-now" style={{ left: WEEK.gutter + todayColumn * WEEK.cellW, width: WEEK.cellW, top: (minute / 60) * WEEK.hourH }} />}
      </div>
    </>
  );
}

function YearGrid({ node, today, openWeek }: GridProps & { openWeek(day: string): (event: MouseEvent) => void }) {
  const year = node.calendarDay.slice(0, 4);
  const callbacks = useBoardCallbacks();
  return (
    <>
      {Array.from({ length: 12 }, (_, index) => {
        const month = `${year}-${String(index + 1).padStart(2, "0")}`;
        const corner = yearMonthCorner(index);
        const days = gridDays(month);
        const inRange = node.months.includes(month);
        return (
          <div key={month} className={`year-month${inRange ? "" : " outside"}`} style={{ left: corner.x, top: corner.y, width: 7 * YEAR.cellW }}>
            <button
              className="year-month-name nodrag"
              style={{ height: YEAR.title }}
              data-tip="Open this month"
              onClick={(event) => {
                event.stopPropagation();
                if (node.outlineId !== null) callbacks.onCalendarView(node.outlineId, "month", `${month}-01`);
              }}
            >
              {monthTitle(month).split(" ")[0]}
            </button>
            <div className="year-weekdays" style={{ height: YEAR.weekdays, gridTemplateColumns: `repeat(7, ${YEAR.cellW}px)` }}>
              {WEEKDAYS.map((weekday) => (
                <span key={weekday}>{weekday}</span>
              ))}
            </div>
            <div className="year-days" style={{ gridTemplateColumns: `repeat(7, ${YEAR.cellW}px)`, gridAutoRows: `${YEAR.cellH}px` }}>
              {days.map((day) => {
                if (monthOf(day) !== month) return <span key={day} />;
                const count = node.dayCounts[day] ?? 0;
                return (
                  <button key={day} className={`year-day nodrag${day === today ? " today" : ""}${count > 0 ? " busy" : ""}`} data-tip={count > 0 ? `${count} cards: open this week` : "Open this week"} onClick={openWeek(day)} onDoubleClick={(event) => event.stopPropagation()}>
                    {Number(day.slice(8))}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}
