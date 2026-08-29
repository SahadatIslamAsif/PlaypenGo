// §7.3's date arithmetic. The weekend cases are the reason this file exists:
// the routine's week is Sunday-Thursday, the alert calendar is all seven days,
// and conflating them is a silent bug that would send the student a Chemistry
// reminder on the wrong two evenings.

import { describe, expect, it } from "vitest";
import type { RoutinePeriodRow } from "./grid";
import {
  addDays,
  alertEvenings,
  currentPeriod,
  dayOfWeekOf,
  formatTime,
  localDate,
  localDayOfWeek,
  nextClassDay,
  nextClassDays,
  todaysPeriods,
} from "./schedule";

function period(
  partial: Partial<RoutinePeriodRow> & { day_of_week: number; period_no: number },
): RoutinePeriodRow {
  return {
    id: `${partial.day_of_week}-${partial.period_no}`,
    start_time: null,
    end_time: null,
    raw_text: null,
    teacher_raw: null,
    student_subject_id: null,
    is_academic: true,
    ...partial,
  };
}

// Chemistry on Sunday, Monday and Tuesday — the exact example §7.3 works
// through. Physics on Wednesday only. A break column that is not a lesson.
const rows: RoutinePeriodRow[] = [
  period({ day_of_week: 0, period_no: 1, student_subject_id: "chem", start_time: "08:15:00", end_time: "08:55:00" }),
  period({ day_of_week: 0, period_no: 2, raw_text: "B", is_academic: false, start_time: "10:55:00", end_time: "11:25:00" }),
  period({ day_of_week: 1, period_no: 1, student_subject_id: "chem" }),
  period({ day_of_week: 2, period_no: 1, student_subject_id: "chem" }),
  period({ day_of_week: 3, period_no: 1, student_subject_id: "phy" }),
  // Games on Wednesday, filed against no subject.
  period({ day_of_week: 3, period_no: 2, raw_text: "Games", is_academic: false }),
];

describe("date arithmetic", () => {
  it("walks calendar days across a month boundary", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("handles a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("reads the weekday of a date", () => {
    // 2026-08-30 is a Sunday.
    expect(dayOfWeekOf("2026-08-30")).toBe(0);
    expect(dayOfWeekOf("2026-09-04")).toBe(5); // Friday
  });
});

describe("nextClassDay — §7.3", () => {
  it("finds the next day the subject meets", () => {
    // Sunday 2026-08-30 -> Chemistry meets again on Monday.
    expect(nextClassDay(rows, "chem", "2026-08-30")).toBe("2026-08-31");
  });

  it("never returns the day it starts from", () => {
    // A CWM predicted on a Chemistry day is about the NEXT Chemistry class.
    const next = nextClassDay(rows, "chem", "2026-08-31");
    expect(next).not.toBe("2026-08-31");
    expect(next).toBe("2026-09-01");
  });

  it("steps over the Friday-Saturday weekend", () => {
    // Tuesday 2026-09-01 is Chemistry's last day of the week. The next one is
    // the following Sunday — Wednesday and Thursday have no Chemistry, and
    // Friday and Saturday have no school at all.
    expect(nextClassDay(rows, "chem", "2026-09-01")).toBe("2026-09-06");
  });

  it("resolves from within the weekend itself", () => {
    // Friday 2026-09-04: the student is home, and the answer is Sunday.
    expect(nextClassDay(rows, "chem", "2026-09-04")).toBe("2026-09-06");
    expect(nextClassDay(rows, "phy", "2026-09-04")).toBe("2026-09-09");
  });

  it("ignores non-academic periods", () => {
    // Nothing is filed against the break or Games rows, but a subject that only
    // ever appeared in one must not produce a class day.
    expect(nextClassDay(rows, "games", "2026-08-30")).toBeNull();
  });

  it("returns null for a subject the routine never mentions", () => {
    // The case crosscheck.ts warns about: no routine period means §7.3 has no
    // date to predict, and saying so beats inventing one.
    expect(nextClassDay(rows, "biology", "2026-08-30")).toBeNull();
  });

  it("returns null past the horizon rather than searching forever", () => {
    const sparse = [period({ day_of_week: 4, period_no: 1, student_subject_id: "art" })];
    expect(nextClassDay(sparse, "art", "2026-08-30", 3)).toBeNull();
    expect(nextClassDay(sparse, "art", "2026-08-30", 7)).toBe("2026-09-03");
  });
});

describe("alertEvenings — §7.3", () => {
  it("puts a Sunday class's alerts on Friday and Saturday evening", () => {
    // The worked example from the spec: "Chemistry runs Sun/Mon/Tue, so a
    // Sunday class produces alerts on Friday and Saturday evening — the two
    // evenings the student is home and free."
    expect(alertEvenings("2026-09-06")).toEqual({
      advance: "2026-09-04",
      nightBefore: "2026-09-05",
    });
    expect(dayOfWeekOf("2026-09-04")).toBe(5); // Friday
    expect(dayOfWeekOf("2026-09-05")).toBe(6); // Saturday
  });

  it("crosses a month boundary backwards", () => {
    expect(alertEvenings("2026-09-01")).toEqual({
      advance: "2026-08-30",
      nightBefore: "2026-08-31",
    });
  });
});

describe("timezone handling", () => {
  it("reports the Dhaka date, not the server's UTC date", () => {
    // 22:00 UTC is already 04:00 the next morning in Dhaka. A server in UTC
    // that trusted its own clock would show the wrong day's periods every
    // evening — which is exactly when the digest runs.
    const instant = new Date("2026-08-30T22:00:00Z");
    expect(localDate(instant, "Asia/Dhaka")).toBe("2026-08-31");
    expect(localDate(instant, "UTC")).toBe("2026-08-30");
  });

  it("reports the Dhaka weekday across the same boundary", () => {
    const instant = new Date("2026-08-30T22:00:00Z"); // Sunday in UTC
    expect(localDayOfWeek(instant, "Asia/Dhaka")).toBe(1); // already Monday
    expect(localDayOfWeek(instant, "UTC")).toBe(0);
  });
});

describe("todaysPeriods", () => {
  it("returns the day's periods, breaks included", () => {
    // 2026-08-30 09:00 Dhaka = Sunday morning.
    const result = todaysPeriods(rows, new Date("2026-08-30T03:00:00Z"), "Asia/Dhaka");
    expect(result.isoDate).toBe("2026-08-30");
    expect(result.dayOfWeek).toBe(0);
    expect(result.periods).toHaveLength(2);
  });

  it("is empty on the weekend rather than throwing", () => {
    const result = todaysPeriods(rows, new Date("2026-09-04T03:00:00Z"), "Asia/Dhaka");
    expect(result.dayOfWeek).toBe(5);
    expect(result.periods).toEqual([]);
  });
});

describe("currentPeriod", () => {
  it("finds the period in progress", () => {
    // 08:30 Dhaka on a Sunday = 02:30 UTC.
    const now = new Date("2026-08-30T02:30:00Z");
    expect(currentPeriod(rows, now, "Asia/Dhaka")?.period_no).toBe(1);
  });

  it("is null between periods and outside school hours", () => {
    expect(currentPeriod(rows, new Date("2026-08-30T04:00:00Z"), "Asia/Dhaka")).toBeNull();
    expect(currentPeriod(rows, new Date("2026-08-30T16:00:00Z"), "Asia/Dhaka")).toBeNull();
  });

  it("is null on the weekend", () => {
    expect(currentPeriod(rows, new Date("2026-09-04T02:30:00Z"), "Asia/Dhaka")).toBeNull();
  });
});

describe("formatTime", () => {
  it("renders the time gutter's 12-hour labels", () => {
    expect(formatTime("08:15:00")).toBe("8:15 am");
    expect(formatTime("13:25")).toBe("1:25 pm");
    expect(formatTime("12:05:00")).toBe("12:05 pm");
    expect(formatTime(null)).toBe("");
  });
});

describe("nextClassDays — §7.3's window", () => {
  it("returns the next four occurrences of a subject that meets Sun/Mon/Tue", () => {
    // From Sunday 2026-08-30: Mon 31, Tue 1, then the following Sun 6, Mon 7.
    // Four *occurrences*, not four calendar days and not a fixed number of
    // weeks — the Wed/Thu/Fri/Sat gap in the middle is simply not counted.
    expect(nextClassDays(rows, "chem", "2026-08-30", 4)).toEqual([
      "2026-08-31",
      "2026-09-01",
      "2026-09-06",
      "2026-09-07",
    ]);
  });

  it("scales its horizon with the count, so a weekly subject still fills a window", () => {
    // Physics meets Wednesdays only: four occurrences span four weeks. The old
    // fixed 14-day horizon would have truncated this window to two.
    expect(nextClassDays(rows, "phy", "2026-08-30", 4)).toEqual([
      "2026-09-02",
      "2026-09-09",
      "2026-09-16",
      "2026-09-23",
    ]);
  });

  it("returns fewer than asked rather than nothing when the horizon runs out", () => {
    expect(nextClassDays(rows, "phy", "2026-08-30", 4, 10)).toEqual([
      "2026-09-02",
      "2026-09-09",
    ]);
  });

  it("returns an empty list for a subject the routine never mentions", () => {
    expect(nextClassDays(rows, "biology", "2026-08-30", 4)).toEqual([]);
  });

  it("never counts a non-academic period as an occurrence", () => {
    expect(nextClassDays(rows, "games", "2026-08-30", 4)).toEqual([]);
  });

  it("agrees with nextClassDay on the count-of-one case", () => {
    expect(nextClassDays(rows, "chem", "2026-09-01", 1)).toEqual([
      nextClassDay(rows, "chem", "2026-09-01"),
    ]);
  });
});
