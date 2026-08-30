// The tutor roster (§8: "All linked students in one table, with tomorrow's
// load and an unlogged count per student — the primary signal on this
// screen"). A pure transform in the same shape as buildResultsList() and
// toWeeklySeries(): the page does every Supabase read, this only combines
// what's already been fetched per student into one sorted row per student.

import { computeTrend, type Trend } from "@/lib/assessments/trend";
import { addDays } from "@/lib/routines/schedule";
import { countUnlogged, type UnloggedAssessmentRow } from "@/lib/assessments/list";
import { itemsOnDate, type UpcomingItem } from "@/lib/assessments/upcoming";

export type RosterStudentInput = {
  studentId: string;
  studentName: string;
  assessments: UnloggedAssessmentRow[];
  upcoming: UpcomingItem[];
  /** Newest-first percentages, same order lib/assessments/trend.ts expects. */
  recentPercentages: number[];
};

export type RosterRow = {
  studentId: string;
  studentName: string;
  tomorrowCount: number;
  unloggedCount: number;
  trend: Trend;
};

/**
 * Sorted unlogged-count desc, then tomorrow's-load desc, then name - the same
 * tie-break composeTutorDigest() (lib/notifications/digest.ts) uses for the
 * nightly tutor email, so the roster a tutor opens in the morning orders
 * students the same way the digest they read the night before did.
 */
export function buildRoster(students: RosterStudentInput[], today: string): RosterRow[] {
  const tomorrow = addDays(today, 1);

  const rows: RosterRow[] = students.map((s) => ({
    studentId: s.studentId,
    studentName: s.studentName,
    tomorrowCount: itemsOnDate(s.upcoming, tomorrow).length,
    unloggedCount: countUnlogged(s.assessments, null, today),
    trend: computeTrend(s.recentPercentages),
  }));

  return rows.sort(
    (a, b) =>
      b.unloggedCount - a.unloggedCount ||
      b.tomorrowCount - a.tomorrowCount ||
      a.studentName.localeCompare(b.studentName),
  );
}
