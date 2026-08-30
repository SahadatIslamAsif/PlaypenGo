// §7.4 section 7's per-subject week-in-review: subject averages, best and
// weakest chapter, syllabus coverage. Pulled out of
// lib/notifications/engine.tsx's loadWeekInReview() (the Supabase-fetching
// wrapper stays there) so the aggregation itself is unit-testable and so the
// tutor drill-down's "This week" card (Phase 7) can compute the same shape
// on demand rather than only on the Thursday digest's schedule - Thursday is
// an email cadence, not a rule about when the numbers are allowed to exist.

import type { WeekInReview } from "./digest";

export type WeekResultRow = {
  percentage: number;
  studentSubjectId: string;
  /** Every chapter the result's assessment links to (0017: many-to-many). */
  chapterNames: string[];
};

export type WeekChapterRow = {
  studentSubjectId: string;
  status: string; // 'not_started' | 'p80' | 'p100' | 'not_taught'
};

export function buildWeekInReview(
  results: WeekResultRow[],
  chapters: WeekChapterRow[],
  subjectNames: Map<string, string>,
): WeekInReview | null {
  const bySubject = new Map<string, number[]>();
  for (const row of results) {
    bySubject.set(row.studentSubjectId, [
      ...(bySubject.get(row.studentSubjectId) ?? []),
      row.percentage,
    ]);
  }

  const subjectAverages = [...bySubject.entries()]
    .map(([subjectId, values]) => ({
      subject: subjectNames.get(subjectId) ?? "That subject",
      percentage: values.reduce((sum, v) => sum + v, 0) / values.length,
      count: values.length,
    }))
    .sort((a, b) => b.percentage - a.percentage);

  const coverageBySubject = new Map<string, { done: number; total: number }>();
  for (const chapter of chapters) {
    // 'not_taught' is the teacher shrinking the syllabus (§8), not a gap in
    // the student's coverage — it counts toward neither side of the fraction.
    if (chapter.status === "not_taught") continue;
    const entry = coverageBySubject.get(chapter.studentSubjectId) ?? { done: 0, total: 0 };
    entry.total += 1;
    if (chapter.status === "p80" || chapter.status === "p100") entry.done += 1;
    coverageBySubject.set(chapter.studentSubjectId, entry);
  }

  const coverage = [...coverageBySubject.entries()]
    .map(([subjectId, c]) => ({ subject: subjectNames.get(subjectId) ?? "That subject", ...c }))
    .filter((c) => c.total > 0)
    .sort((a, b) => a.subject.localeCompare(b.subject));

  if (subjectAverages.length === 0 && coverage.length === 0) return null;

  // A chapter's score is the mean of the results filed against it, because
  // 0017 made the link many-to-many: one CT can span three chapters and
  // carries ONE combined mark, so that mark counts toward each of them.
  // Crude — the paper does not say which chapter lost the marks — but it is
  // the only honest reading of a combined score.
  const byChapter = new Map<string, number[]>();
  for (const row of results) {
    for (const name of row.chapterNames) {
      byChapter.set(name, [...(byChapter.get(name) ?? []), row.percentage]);
    }
  }

  const ranked = [...byChapter.entries()]
    .map(([chapter, values]) => ({
      chapter,
      percentage: values.reduce((sum, v) => sum + v, 0) / values.length,
    }))
    .sort((a, b) => b.percentage - a.percentage);

  // One chapter is not a best and a weakest at once - with a single chapter
  // there is nothing to compare, so reporting the same line under both
  // headings would read as a bug (and be one).
  const hasSpread = ranked.length > 1;

  return {
    subjectAverages,
    bestChapter: hasSpread ? ranked[0] : null,
    weakestChapter: hasSpread ? ranked[ranked.length - 1] : null,
    coverage,
  };
}
