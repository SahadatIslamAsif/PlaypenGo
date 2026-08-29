// Reading the routine as a calendar.
//
// These helpers are pure and were built in Phase 3 even though their screens
// come later. `nextClassDays` is §7.3's window rule stated as code:
//
//   "Once a chapter reaches p80 or p100 with no result yet, open a window on
//    the next 4 class occurrences of that subject, read straight off the
//    routine — four occurrences, not four calendar days and not a fixed number
//    of weeks."
//
// That sentence replaced an earlier single-guess model, and the shape of these
// functions still shows the seam: `nextClassDay` was written against the old
// model, when a CWM had exactly one predicted date. It survives because the
// dashboard's "Coming up" list genuinely does want the first occurrence and
// nothing more (`lib/assessments/upcoming.ts`) — but it is now the count-of-one
// case of `nextClassDays`, not a rule of its own.
//
// The trap they exist to avoid is the weekend. §7.3: the advance alert fires
// two evenings out and the night-before alert the evening before, "both
// calendar days, weekend included — the routine only decides which day the
// class itself falls on, never which evenings the student is reachable".
// Chemistry runs Sun/Mon/Tue, so a Sunday class produces alerts on Friday and
// Saturday evening. The routine's Sunday-to-Thursday week decides which days
// the occurrences are; it must not leak into the arithmetic that walks
// backwards from one.
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
 * §7.3: the next `count` dates on which `studentSubjectId` appears in the
 * routine — the occurrences a window watches.
 *
 * Starts from the day after `from` — a window opened today is about the next
 * times the class meets, not one that has already happened. Only academic
 * periods count: a break column is never an occurrence.
 *
 * Returns fewer than `count` dates, empty list included, rather than throwing.
 * A subject the routine never mentions has no occurrences at all, which is the
 * honest answer and exactly the case `crosscheck.ts` warns about; a subject
 * that meets rarely may run out of horizon. Both are real, and a caller that
 * gets three dates back opens a three-occurrence window rather than refusing to
 * open one.
 *
 * The horizon scales with `count` so the default is the same two weeks per
 * occurrence the single-date version always had. A subject meeting once a week
 * needs four weeks to yield four occurrences; a fixed 14 would silently
 * truncate its window to two.
 */
export function nextClassDays(
  rows: RoutinePeriodRow[],
  studentSubjectId: string,
  from: string,
  count: number,
  horizonDays = count * 14,
): string[] {
  const meets = new Set(
    rows
      .filter((r) => r.is_academic && r.student_subject_id === studentSubjectId)
      .map((r) => r.day_of_week),
  );

  const found: string[] = [];
  if (meets.size === 0 || count <= 0) return found;

  for (let offset = 1; offset <= horizonDays && found.length < count; offset++) {
    const candidate = addDays(from, offset);
    if (meets.has(dayOfWeekOf(candidate))) found.push(candidate);
  }

  return found;
}

/**
 * The first of those occurrences, or null.
 *
 * The dashboard's "Coming up" list wants one date per predicted CWM, not a
 * window — see `lib/assessments/upcoming.ts`. Kept as a named function because
 * that is a genuinely different question from "what is this window watching",
 * and reading `nextClassDays(...)[0] ?? null` at the call site would blur them.
 */
export function nextClassDay(
  rows: RoutinePeriodRow[],
  studentSubjectId: string,
  from: string,
  horizonDays = 14,
): string | null {
  return nextClassDays(rows, studentSubjectId, from, 1, horizonDays)[0] ?? null;
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
