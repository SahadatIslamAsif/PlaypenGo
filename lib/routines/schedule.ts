// Reading the routine as a calendar.
//
// Two helpers, both pure, both deliberately built in Phase 3 even though their
// screens come later. `nextClassDay` is §7.3's CWM rule stated as code:
//
//   "CWM prediction (chapter at p80 or p100, no result yet) -> D = the next
//    date on which that subject appears in the routine."
//
// The trap it exists to avoid is the weekend. §7.3 continues: "the advance
// alert fires on the evening of D-2, the final reminder on the evening of D-1 —
// calendar days, weekend included. Chemistry runs Sun/Mon/Tue, so a Sunday
// class produces alerts on Friday and Saturday evening." The routine's
// Sunday-to-Thursday week decides which day D is; it must not leak into the
// arithmetic that walks backwards from D.
//
// Everything is computed in the student's timezone, which §3.2 defaults to
// Asia/Dhaka. A server in UTC is six hours behind Dhaka, so "today" derived
// from the process clock is the previous day for a quarter of every day.

import type { RoutinePeriodRow } from "./grid";

export const DEFAULT_TIMEZONE = "Asia/Dhaka";

/** Calendar parts of an instant, as seen in `timeZone`. */
function partsIn(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    isoDate: `${get("year")}-${get("month")}-${get("day")}`,
    dayOfWeek: weekdays[get("weekday")] ?? 0,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/** The date in `timeZone`, as `YYYY-MM-DD`. */
export function localDate(now: Date, timeZone = DEFAULT_TIMEZONE): string {
  return partsIn(now, timeZone).isoDate;
}

/** Day of week in `timeZone`, 0=Sunday through 6=Saturday. */
export function localDayOfWeek(now: Date, timeZone = DEFAULT_TIMEZONE): number {
  return partsIn(now, timeZone).dayOfWeek;
}

/** Whether the routine has any period on this weekday — false on Fri/Sat. */
export function isSchoolDay(dayOfWeek: number): boolean {
  return dayOfWeek >= 0 && dayOfWeek <= 4;
}

/** Add whole calendar days to a `YYYY-MM-DD` string, timezone-free. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  // Noon UTC, so a DST shift in any zone cannot roll the date over.
  const at = new Date(Date.UTC(y, m - 1, d, 12));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Day of week of a `YYYY-MM-DD` string, 0=Sunday. */
export function dayOfWeekOf(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

export type PeriodsOnDay = {
  isoDate: string;
  dayOfWeek: number;
  periods: RoutinePeriodRow[];
};

/**
 * Every period on the given weekday, in period order — breaks included, since
 * the timeline renders them.
 */
export function periodsOnDay(
  rows: RoutinePeriodRow[],
  dayOfWeek: number,
): RoutinePeriodRow[] {
  return rows
    .filter((r) => r.day_of_week === dayOfWeek)
    .sort((a, b) => a.period_no - b.period_no);
}

/**
 * Today's periods in the student's timezone. Returns an empty list on Friday
 * and Saturday rather than throwing — a weekend is a legitimate answer, and
 * the caller renders "No classes today."
 */
export function todaysPeriods(
  rows: RoutinePeriodRow[],
  now: Date = new Date(),
  timeZone = DEFAULT_TIMEZONE,
): PeriodsOnDay {
  const { isoDate, dayOfWeek } = partsIn(now, timeZone);
  return {
    isoDate,
    dayOfWeek,
    periods: isSchoolDay(dayOfWeek) ? periodsOnDay(rows, dayOfWeek) : [],
  };
}

/**
 * The period happening right now, if any. Used by the dashboard timeline to
 * mark the current row; null outside school hours, which is most of the time
 * anyone is looking at this app.
 */
export function currentPeriod(
  rows: RoutinePeriodRow[],
  now: Date = new Date(),
  timeZone = DEFAULT_TIMEZONE,
): RoutinePeriodRow | null {
  const { dayOfWeek, minutes } = partsIn(now, timeZone);
  if (!isSchoolDay(dayOfWeek)) return null;

  return (
    periodsOnDay(rows, dayOfWeek).find((p) => {
      const start = toMinutes(p.start_time);
      const end = toMinutes(p.end_time);
      return start !== null && end !== null && minutes >= start && minutes < end;
    }) ?? null
  );
}

/**
 * §7.3: the next date on which `studentSubjectId` appears in the routine.
 *
 * Starts from the day after `from` — a CWM predicted today is about the next
 * time the class meets, not the one that has already happened. Only academic
 * periods count: a break column is never an answer.
 *
 * Returns null when the subject has no academic period at all, which is the
 * honest answer for a subject the routine never mentions and is exactly the
 * case `crosscheck.ts` warns about. Two weeks is well past the point where a
 * missing subject is a data problem rather than a scheduling one.
 */
export function nextClassDay(
  rows: RoutinePeriodRow[],
  studentSubjectId: string,
  from: string,
  horizonDays = 14,
): string | null {
  const meets = new Set(
    rows
      .filter((r) => r.is_academic && r.student_subject_id === studentSubjectId)
      .map((r) => r.day_of_week),
  );

  if (meets.size === 0) return null;

  for (let offset = 1; offset <= horizonDays; offset++) {
    const candidate = addDays(from, offset);
    if (meets.has(dayOfWeekOf(candidate))) return candidate;
  }

  return null;
}

/**
 * The two evenings §7.3 sends on: D-2 for the advance alert, D-1 for the final
 * reminder. Calendar days, weekend included — that is the whole point, and the
 * reason this is a named function rather than arithmetic inlined at the call
 * site in Phase 6.
 */
export function alertEvenings(targetDate: string): {
  advance: string;
  nightBefore: string;
} {
  return {
    advance: addDays(targetDate, -2),
    nightBefore: addDays(targetDate, -1),
  };
}

/** `08:15:00` or `08:15` -> minutes past midnight. */
function toMinutes(time: string | null): number | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** `08:15:00` -> `8:15 am`, for the timeline's time gutter. */
export function formatTime(time: string | null): string {
  const minutes = toMinutes(time);
  if (minutes === null) return "";
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour < 12 ? "am" : "pm";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minute).padStart(2, "0")} ${suffix}`;
}
