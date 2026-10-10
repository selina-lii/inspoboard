// The days and the time of a calendar card: "From [day] [time]" and "To [day] [time]".
// A card on more than one day has no time (the time inputs are off then).
// Each day takes typed text (YYYY-MM-DD or MM-DD-YYYY) or a click in a small month calendar. A time is HH:MM.

import { useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { monthDays, monthTitle, WEEKDAYS, type CardSchedule } from "../../core/groups";
import type { PlaceLink } from "../../core/types";
import { isComposing } from "../app/keys";
import "./dialogs.css";

export type ScheduleDraft = { fromDay: string; fromTime: string; toDay: string; toTime: string };

export function draftOf(place: PlaceLink): ScheduleDraft {
  const [fromTime = "", toTime = ""] = (place.time ?? "").split("–");
  return { fromDay: place.day ?? "", fromTime, toDay: place.until ?? place.day ?? "", toTime };
}

/** "MM-DD-YYYY" or "YYYY-MM-DD" → "YYYY-MM-DD". Else null. */
export function dayOfText(text: string): string | null {
  const trimmed = text.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  const us = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(trimmed);
  const [year, month, day] = iso !== null ? [iso[1]!, iso[2]!, iso[3]!] : us !== null ? [us[3]!, us[1]!, us[2]!] : [];
  if (year === undefined) return null;
  const text10 = `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`;
  const date = new Date(`${text10}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text10 ? text10 : null;
}

/** "9:30" → "09:30". Empty text: "". Else null. */
function timeOfText(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(trimmed);
  return match === null ? null : `${match[1]!.padStart(2, "0")}:${match[2]}`;
}

/** The schedule of a draft, or the problem as a sentence. */
export function scheduleOf(draft: ScheduleDraft): CardSchedule | string {
  const day = dayOfText(draft.fromDay);
  const until = dayOfText(draft.toDay === "" ? draft.fromDay : draft.toDay);
  if (day === null) return "The first day is not a date (YYYY-MM-DD).";
  if (until === null) return "The last day is not a date (YYYY-MM-DD).";
  if (until < day) return "The last day is before the first day.";
  if (until > day) return { day, until, time: null };
  const from = timeOfText(draft.fromTime);
  const to = timeOfText(draft.toTime);
  if (from === null || to === null) return "A time is HH:MM, for example 09:30.";
  if (from === "" && to !== "") return "Give a start time too.";
  if (to !== "" && to <= from) return "The end time is before the start time.";
  return { day, until: null, time: from === "" ? null : to === "" ? from : `${from}–${to}` };
}

type FieldsProps = {
  draft: ScheduleDraft;
  onChange(draft: ScheduleDraft): void;
  onEnter?(): void;
  disabled?: boolean;
  autoFocus?: boolean;
  /**
   * True (in a document): with no time, the time fields do not show; an "Add a time" button shows them.
   * A card on one day shows one day field with no "From" and "To"; an "Add an end day" button shows both days.
   */
  hideEmptyTime?: boolean;
};

export function ScheduleFields({ draft, onChange, onEnter, disabled = false, autoFocus = false, hideEmptyTime = false }: FieldsProps) {
  const fromDay = dayOfText(draft.fromDay);
  const toDay = dayOfText(draft.toDay);
  const manyDays = fromDay !== null && toDay !== null && toDay > fromDay;
  const [timeAsked, setTimeAsked] = useState(false);
  const [rangeAsked, setRangeAsked] = useState(false);
  const oneDay = hideEmptyTime && !rangeAsked && (draft.toDay === "" || draft.toDay === draft.fromDay);
  const hasTime = draft.fromTime !== "" || draft.toTime !== "";
  // A card on more than one day has no time. In a document, an empty time does not show.
  const showTime = hideEmptyTime ? !manyDays && (hasTime || timeAsked) : true;
  const onKeyDown = (event: React.KeyboardEvent) => !isComposing(event) && event.key === "Enter" && onEnter?.();
  const row = (label: string, dayKey: "fromDay" | "toDay", timeKey: "fromTime" | "toTime", first: boolean) => (
    <div className="schedule-row">
      <span className="schedule-label">{label}</span>
      <DayPicker value={draft[dayKey]} disabled={disabled} autoFocus={autoFocus && first} onChange={(value) => onChange({ ...draft, [dayKey]: value })} onKeyDown={onKeyDown} />
      {showTime && (
        <input
          type="time"
          className="schedule-time"
          value={manyDays ? "" : draft[timeKey]}
          disabled={disabled || manyDays}
          autoFocus={hideEmptyTime && timeAsked && first && !hasTime}
          aria-label={`${label} time`}
          onChange={(event) => onChange({ ...draft, [timeKey]: event.target.value })}
          onKeyDown={onKeyDown}
        />
      )}
    </div>
  );
  const time = (label: string, timeKey: "fromTime" | "toTime", first: boolean) => (
    <input
      type="time"
      className="schedule-time"
      value={draft[timeKey]}
      disabled={disabled}
      autoFocus={timeAsked && first && !hasTime}
      aria-label={`${label} time`}
      onChange={(event) => onChange({ ...draft, [timeKey]: event.target.value })}
      onKeyDown={onKeyDown}
    />
  );
  const addTime = !showTime && !manyDays && !disabled && (
    <button type="button" className="schedule-add-time" onClick={() => setTimeAsked(true)}>
      Add a time
    </button>
  );
  if (oneDay) {
    // One day: the end day follows the first day.
    return (
      <div className="schedule-fields">
        <div className="schedule-row">
          <DayPicker value={draft.fromDay} disabled={disabled} autoFocus={autoFocus} onChange={(value) => onChange({ ...draft, fromDay: value, toDay: value })} onKeyDown={onKeyDown} />
          {showTime && (
            <>
              {time("From", "fromTime", true)}
              <span className="schedule-dash">–</span>
              {time("To", "toTime", false)}
            </>
          )}
        </div>
        {!disabled && (
          <span className="schedule-adds">
            {addTime}
            <button type="button" className="schedule-add-time" onClick={() => setRangeAsked(true)}>
              Add an end day
            </button>
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="schedule-fields">
      {row("From", "fromDay", "fromTime", true)}
      {row("To", "toDay", "toTime", false)}
      {hideEmptyTime && addTime}
    </div>
  );
}

/** A day: a text input (type the day) and a small month calendar (the button). */
function DayPicker({ value, disabled, autoFocus, onChange, onKeyDown }: { value: string; disabled: boolean; autoFocus: boolean; onChange(value: string): void; onKeyDown(event: React.KeyboardEvent): void }) {
  const day = dayOfText(value);
  const [month, setMonth] = useState<string | null>(null);
  return (
    <span className="schedule-day">
      <input
        className={`schedule-day-text${value !== "" && day === null ? " invalid" : ""}`}
        value={value}
        placeholder="YYYY-MM-DD"
        spellCheck={false}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="icon-button schedule-day-button"
        disabled={disabled}
        aria-label="Pick a day"
        onClick={() => setMonth((current) => (current !== null ? null : (day ?? new Date().toISOString().slice(0, 10)).slice(0, 7)))}
      >
        <CalendarDays size={14} />
      </button>
      {month !== null && (
        <MonthGrid
          month={month}
          selected={day}
          onMonth={setMonth}
          onPick={(picked) => {
            onChange(picked);
            setMonth(null);
          }}
        />
      )}
    </span>
  );
}

function MonthGrid({ month, selected, onMonth, onPick }: { month: string; selected: string | null; onMonth(month: string): void; onPick(day: string): void }) {
  const { days, offset } = monthDays(month);
  const shift = (count: number) => {
    const [year, number] = month.split("-").map(Number) as [number, number];
    const date = new Date(Date.UTC(year, number - 1 + count, 1));
    onMonth(date.toISOString().slice(0, 7));
  };
  return (
    <div className="schedule-month" role="menu" onMouseDown={(event) => event.stopPropagation()}>
      <div className="schedule-month-bar">
        <button type="button" className="icon-button" aria-label="Previous month" onClick={() => shift(-1)}>
          <ChevronLeft size={14} />
        </button>
        <span>{monthTitle(month)}</span>
        <button type="button" className="icon-button" aria-label="Next month" onClick={() => shift(1)}>
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="schedule-month-grid">
        {WEEKDAYS.map((name) => (
          <span key={name} className="schedule-weekday">
            {name}
          </span>
        ))}
        {Array.from({ length: offset }, (_, index) => (
          <span key={`empty-${index}`} />
        ))}
        {days.map((day) => (
          <button type="button" key={day} className={day === selected ? "active" : undefined} onClick={() => onPick(day)}>
            {Number(day.slice(8))}
          </button>
        ))}
      </div>
    </div>
  );
}

type DialogProps = { place: PlaceLink; onDone(schedule: CardSchedule | null): void };

/** "Days and time…" on a calendar card. */
export function ScheduleDialog({ place, onDone }: DialogProps) {
  const [draft, setDraft] = useState(() => draftOf(place));
  const result = scheduleOf(draft);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onDone(null);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDone]);
  const finish = () => typeof result !== "string" && onDone(result);
  return (
    <div className="dialog-backdrop" onMouseDown={() => onDone(null)}>
      <div className="dialog fields-dialog" role="dialog" aria-label="Days and time" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-title">Days and time</div>
        <div className="fields-row">
          <ScheduleFields draft={draft} onChange={setDraft} onEnter={finish} autoFocus />
          <span className="setting-help">{typeof result === "string" ? result : "Same day: a time is possible (empty: all day). More than one day: no time."}</span>
        </div>
        <div className="fields-buttons">
          <button onClick={() => onDone(null)}>Cancel</button>
          <button className="primary" disabled={typeof result === "string"} onClick={finish}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
