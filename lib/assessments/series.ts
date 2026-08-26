// Results -> a weekly percentage series, one line per subject.
//
// CLAUDE.md: "Charts always plot percentage so CT and CWM sit on one axis."
// This is the only chart data format in the app, so it plots percentage and
// never converted — a CT and a CWM logged the same week land on the same
// axis, which is the whole reason charts read percentage at all.
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
  /** Average percentage across every result logged for the subject that week. */
  percentage: number;
};

export type SubjectSeries = {
  subjectId: string;
  subjectName: string;
  points: WeeklyPoint[];
};

/** The Sunday on or before `isoDate`. */
function weekStartOf(isoDate: string): string {
  return addDays(isoDate, -dayOfWeekOf(isoDate));
}

/**
 * One series per subject that has at least one result, points ordered oldest
 * to newest — the order a line chart draws in. A week with no result for a
 * subject simply has no point; the chart connects across the gap rather than
 * plotting a false zero.
 */
export function toWeeklySeries(
  results: ResultRow[],
  assessments: AssessmentRow[],
  subjects: SubjectRow[],
): SubjectSeries[] {
  const assessmentById = new Map(assessments.map((a) => [a.id, a]));
  const subjectById = new Map(subjects.map((s) => [s.id, s]));

  // subjectId -> weekStart -> running sum/count, so several results in the
  // same week average rather than overplot.
  const buckets = new Map<string, Map<string, { sum: number; count: number }>>();

  for (const result of results) {
    const assessment = assessmentById.get(result.assessment_id);
    if (!assessment) continue;

    const date = assessment.occurred_date ?? assessment.scheduled_date;
    if (!date) continue;

    const subjectId = assessment.student_subject_id;
    const week = weekStartOf(date);

    if (!buckets.has(subjectId)) buckets.set(subjectId, new Map());
    const bySubject = buckets.get(subjectId)!;

    const bucket = bySubject.get(week) ?? { sum: 0, count: 0 };
    bucket.sum += result.percentage;
    bucket.count += 1;
    bySubject.set(week, bucket);
  }

  const series: SubjectSeries[] = [];

  for (const [subjectId, bySubject] of buckets) {
    const points = [...bySubject.entries()]
      .map(([weekStart, { sum, count }]) => ({
        weekStart,
        percentage: Math.round((sum / count) * 10) / 10,
      }))
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

    series.push({
      subjectId,
      subjectName: subjectById.get(subjectId)?.display_name ?? "Unknown subject",
      points,
    });
  }

  return series.sort((a, b) => a.subjectName.localeCompare(b.subjectName));
}

/**
 * The mobile rule: "last 6 weeks only" (design system, mobile charts). Keeps
 * whichever of the last 6 week-buckets actually have points — it does not pad
 * in empty weeks, since the line chart draws between existing points anyway.
 */
export function lastNWeeks(series: SubjectSeries, weeks: number, now: string): SubjectSeries {
  const cutoff = weekStartOf(addDays(now, -7 * weeks));
  return {
    ...series,
    points: series.points.filter((p) => p.weekStart >= cutoff),
  };
}
