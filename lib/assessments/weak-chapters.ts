// The tutor drill-down's "weak chapters" (§8) - which chapters a student is
// struggling with, averaged across every result ever logged against them.
// Deliberately not lib/notifications/digest.ts's WeekInReview bestChapter /
// weakestChapter pair: that one is a moving 7-day snapshot built for a
// Thursday-only email section. This is an on-demand view a tutor opens
// whenever, so it looks at the whole history instead of one week of it -
// a different question, not a re-derivation of the same one.

import type { AssessmentChapterRow, AssessmentRow, ChapterRow, ResultRow } from "./list";

export type WeakChapterItem = {
  chapterId: string;
  chapterName: string;
  averagePercentage: number;
  resultCount: number;
};

const DEFAULT_LIMIT = 5;

/**
 * One bucket per chapter, averaging every result whose assessment links to
 * it (0017: an assessment can cover several chapters, so one result can
 * contribute to more than one bucket). Sorted worst-first; a tie goes to
 * whichever chapter has more results behind it, since one bad paper reads
 * less reliably than a pattern across several.
 */
export function weakestChapters(
  results: ResultRow[],
  assessments: AssessmentRow[],
  assessmentChapters: AssessmentChapterRow[],
  chapters: ChapterRow[],
  limit = DEFAULT_LIMIT,
): WeakChapterItem[] {
  const assessmentById = new Map(assessments.map((a) => [a.id, a]));
  const chapterById = new Map(chapters.map((c) => [c.id, c]));

  const chapterIdsByAssessment = new Map<string, string[]>();
  for (const link of assessmentChapters) {
    const ids = chapterIdsByAssessment.get(link.assessment_id) ?? [];
    ids.push(link.chapter_id);
    chapterIdsByAssessment.set(link.assessment_id, ids);
  }

  const buckets = new Map<string, { sum: number; count: number }>();
  for (const result of results) {
    const assessment = assessmentById.get(result.assessment_id);
    if (!assessment) continue;

    for (const chapterId of chapterIdsByAssessment.get(assessment.id) ?? []) {
      const bucket = buckets.get(chapterId) ?? { sum: 0, count: 0 };
      bucket.sum += result.percentage;
      bucket.count += 1;
      buckets.set(chapterId, bucket);
    }
  }

  const items: WeakChapterItem[] = [];
  for (const [chapterId, { sum, count }] of buckets) {
    const chapter = chapterById.get(chapterId);
    if (!chapter) continue; // orphaned by a stale read; skip rather than crash

    items.push({
      chapterId,
      chapterName: chapter.name,
      averagePercentage: Math.round((sum / count) * 10) / 10,
      resultCount: count,
    });
  }

  return items
    .sort((a, b) => a.averagePercentage - b.averagePercentage || b.resultCount - a.resultCount)
    .slice(0, limit);
}
