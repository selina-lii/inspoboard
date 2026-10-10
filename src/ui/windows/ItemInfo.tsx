// Item times, one on each line: created, modified, opened (shown), and the date that the user types (edited).
// They show only if the setting "Show item dates" is on.
// An item on a calendar shows its days and time ("From", "To") in place of the date: they set the date.

import { setItemDate } from "../../core/actions";
import { uiLocale } from "../i18n/i18n";
import { setCardSchedule } from "../../core/groups";
import type { Id, PlaceLink } from "../../core/types";
import { useEffect, useState } from "react";
import { draftOf, ScheduleFields, scheduleOf } from "../dialogs/ScheduleFields";
import { CommitField } from "../app/fields";
import { useRunCommand, useSession, useSessionState, useStoreRevision } from "../app/sessionContext";

export function ItemInfo({ itemId }: { itemId: Id }) {
  const session = useSession();
  const { readOnly } = useSessionState();
  const runCommand = useRunCommand();
  useStoreRevision();
  const item = session.store.get("items", itemId);
  if (item === undefined) return null;
  const onCalendar = session.graph.parentsOf(itemId).find((place) => place.outline !== undefined && place.day !== undefined);
  return (
    <dl className="item-info">
      <dt>Created</dt>
      <dd>{formatTime(item.created)}</dd>
      <dt>Modified</dt>
      <dd>{formatTime(item.modified ?? item.created)}</dd>
      <dt>Opened</dt>
      <dd>{formatTime(session.openedAt(itemId))}</dd>
      {onCalendar !== undefined ? (
        <>
          <dt>Days</dt>
          <dd>
            <CalendarDays place={onCalendar} disabled={readOnly} />
          </dd>
        </>
      ) : (
      <>
      <dt>Date</dt>
      <dd>
        <CommitField
          className="item-date-input"
          value={item.date ?? ""}
          placeholder="Your own date, for example 1998-05"
          disabled={readOnly}
          onCommit={(date) => runCommand(setItemDate(session.context, itemId, date))}
        />
      </dd>
      </>
      )}
    </dl>
  );
}

/** The days and time of a calendar card. A valid change saves after a short pause (typing does not save each key). */
function CalendarDays({ place, disabled }: { place: PlaceLink; disabled: boolean }) {
  const session = useSession();
  const runCommand = useRunCommand();
  const [draft, setDraft] = useState(() => draftOf(place));
  useEffect(() => setDraft(draftOf(place)), [place]);
  const result = scheduleOf(draft);
  useEffect(() => {
    if (typeof result === "string") return;
    const timer = window.setTimeout(() => runCommand(setCardSchedule(session.context, place.id, result)), 700);
    return () => window.clearTimeout(timer);
    // The result is new on each render: the draft is the real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  return (
    <div className="item-schedule">
      <ScheduleFields draft={draft} onChange={setDraft} disabled={disabled} hideEmptyTime />
      {typeof result === "string" && <span className="setting-help">{result}</span>}
    </div>
  );
}

function formatTime(iso: string | undefined): string {
  if (iso === undefined) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(uiLocale(), { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
