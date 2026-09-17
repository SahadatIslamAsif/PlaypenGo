// Results -> a weekly percentage series, one CT line and one CWM line per
// subject.
//
// CLAUDE.md: "Charts always plot percentage so CT and CWM sit on one axis."
// This is the only chart data format in the app, so it plots percentage and
// never converted — that's what makes a CT and a CWM comparable on one axis
// at all. They no longer collapse into a single averaged line, though: a CT
// and a CWM the same week measure different things, and averaging them
// together hid that. They're kept as two lines sharing that one axis
// instead.
//
// Weeks are anchored to Sunday, matching the routine's own week (§5.1 rule 6:
// the school week is Sunday-Thursday). Date arithmetic reuses addDays() and
// dayOfWeekOf() from lib/routines/schedule.ts rather than a second
// implementation of the same rules.

import { addDays, dayOfWeekOf } from "@/lib/routines/schedule";
import type { AssessmentRow, ResultRow, SubjectRow } from "./list";

export type WeeklyPoint = {
  /** ISO date of the Sunday that starts this week. */
  weekStart: string;
  /** Average percentage across every result of this type logged that week. */
  percentage: number;
};

export type SubjectSeries = {
  subjectId: string;
  subjectName: string;
  ctPoints: WeeklyPoint[];
  cwmPoints: WeeklyPoint[];
};

/** The Sunday on or before `isoDate`. */
function weekStartOf(isoDate: string): string {
  return addDays(isoDate, -dayOfWeekOf(isoDate));
}

type Bucket = { sum: number; count: number };

function toPoints(byWeek: Map<string, Bucket>): WeeklyPoint[] {
  return [...byWeek.entries()]
    .map(([weekStart, { sum, count }]) => ({
      weekStart,
      percentage: Math.round((sum / count) * 10) / 10,
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/**
 * One series per subject that has at least one result, points ordered oldest
 * to newest — the order a line chart draws in. A week with no result of a
 * given type simply has no point in that type's line; the chart connects
 * across the gap rather than plotting a false zero, and the other type's
 * line is untouched by the gap.
 */
export function toWeeklySeries(
  results: ResultRow[],
  assessments: AssessmentRow[],
  subjects: SubjectRow[],
): SubjectSeries[] {
  const assessmentById = new Map(assessments.map((a) => [a.id, a]));
  const subjectById = new Map(subjects.map((s) => [s.id, s]));

  // subjectId -> 'CT' | 'CWM' -> weekStart -> running sum/count, so several
  // results of the same type in the same week average rather than overplot.
  const buckets = new Map<string, { CT: Map<string, Bucket>; CWM: Map<string, Bucket> }>();

  for (const result of results) {
    const assessment = assessmentById.get(result.assessment_id);
    if (!assessment) continue;

    const date = assessment.occurred_date ?? assessment.scheduled_date;
    if (!date) continue;

    const subjectId = assessment.student_subject_id;
    const week = weekStartOf(date);

    if (!buckets.has(subjectId)) {
      buckets.set(subjectId, { CT: new Map(), CWM: new Map() });
    }
    const byType = buckets.get(subjectId)!;
    const byWeek = assessment.type === "CT" ? byType.CT : byType.CWM;

    const bucket = byWeek.get(week) ?? { sum: 0, count: 0 };
    bucket.sum += result.percentage;
    bucket.count += 1;
    byWeek.set(week, bucket);
  }

  const series: SubjectSeries[] = [];

  for (const [subjectId, byType] of buckets) {
    series.push({
      subjectId,
      subjectName: subjectById.get(subjectId)?.display_name ?? "Unknown subject",
      ctPoints: toPoints(byType.CT),
      cwmPoints: toPoints(byType.CWM),
    });
  }

  return series.sort((a, b) => a.subjectName.localeCompare(b.subjectName));
}

/**
 * The mobile rule: "last 6 weeks only" (design system, mobile charts). Keeps
 * whichever of the last 6 week-buckets actually have points, independently
 * for each type — it does not pad in empty weeks, since the line chart draws
 * between existing points anyway.
 */
export function lastNWeeks(series: SubjectSeries, weeks: number, now: string): SubjectSeries {
  const cutoff = weekStartOf(addDays(now, -7 * weeks));
  return {
    ...series,
    ctPoints: series.ctPoints.filter((p) => p.weekStart >= cutoff),
    cwmPoints: series.cwmPoints.filter((p) => p.weekStart >= cutoff),
  };
}
