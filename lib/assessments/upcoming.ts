// "Coming up": scheduled CTs plus predicted CWMs, merged into one ordered
// list. Returns data, not markup — Phase 6's digest (§7.4's "Tomorrow" and
// "Day after" sections) reuses this exact function rather than re-deriving
// the same merge.
//
// A predicted CWM is a chapter sitting at p80 or p100 with no result yet
// (§7.3). Its target date is resolved through nextClassDay() from
// lib/routines/schedule.ts — the same function Phase 3 built and tested
// against the Friday/Saturday weekend, reused rather than re-implemented.

import { nextClassDay } from "@/lib/routines/schedule";
import type { RoutinePeriodRow } from "@/lib/routines/grid";
import type { AssessmentChapterRow, AssessmentRow } from "./list";

export type ChapterReadyRow = {
  id: string;
  student_subject_id: string;
  status: "not_started" | "p80" | "p100" | "not_taught";
};

export type SubjectRow = { id: string; display_name: string };

export type UpcomingItem = {
  kind: "scheduled_ct" | "predicted_cwm";
  date: string;
  subjectId: string;
  subjectName: string;
  assessmentId: string | null;
  // 0017: an assessment can cover several chapters, so this is every chapter
  // the CT/CWM is linked to rather than a single id.
  chapterIds: string[];
};

/**
 * Scheduled CTs, as-is. §3.2: scheduled_date is CT-only, so this is a plain
 * filter, not a computation.
 */
function scheduledCTs(
  assessments: AssessmentRow[],
  subjects: SubjectRow[],
  assessmentChapters: AssessmentChapterRow[],
): UpcomingItem[] {
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const chapterIdsByAssessment = new Map<string, string[]>();
  for (const link of assessmentChapters) {
    const ids = chapterIdsByAssessment.get(link.assessment_id) ?? [];
    ids.push(link.chapter_id);
    chapterIdsByAssessment.set(link.assessment_id, ids);
  }

  return assessments
    .filter((a) => a.type === "CT" && a.status === "scheduled" && a.scheduled_date)
    .map((a) => ({
      kind: "scheduled_ct" as const,
      date: a.scheduled_date as string,
      subjectId: a.student_subject_id,
      subjectName: subjectById.get(a.student_subject_id)?.display_name ?? "Unknown subject",
      assessmentId: a.id,
      chapterIds: chapterIdsByAssessment.get(a.id) ?? [],
    }));
}

/**
 * §7.3: a chapter at p80/p100 with no logged result yet predicts a CWM on the
 * next day that subject meets. A subject with an existing 'predicted' or
 * 'occurred' assessment for the same chapter is skipped — the prediction has
 * already become a real assessment row, and showing both would duplicate it.
 */
function predictedCWMs(
  chapters: ChapterReadyRow[],
  assessments: AssessmentRow[],
  assessmentChapters: AssessmentChapterRow[],
  routinePeriods: RoutinePeriodRow[],
  subjects: SubjectRow[],
  from: string,
): UpcomingItem[] {
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const openCwmIds = new Set(
    assessments
      .filter((a) => a.type === "CWM" && a.status !== "logged" && a.status !== "cancelled")
      .map((a) => a.id),
  );
  const chapterHasOpenAssessment = new Set(
    assessmentChapters
      .filter((link) => openCwmIds.has(link.assessment_id))
      .map((link) => link.chapter_id),
  );

  const items: UpcomingItem[] = [];

  for (const chapter of chapters) {
    if (chapter.status !== "p80" && chapter.status !== "p100") continue;
    if (chapterHasOpenAssessment.has(chapter.id)) continue;

    const date = nextClassDay(routinePeriods, chapter.student_subject_id, from);
    if (!date) continue;

    items.push({
      kind: "predicted_cwm",
      date,
      subjectId: chapter.student_subject_id,
      subjectName: subjectById.get(chapter.student_subject_id)?.display_name ?? "Unknown subject",
      assessmentId: null,
      chapterIds: [chapter.id],
    });
  }

  return items;
}

/**
 * The merged, date-sorted list. §7.4: "Tomorrow and Day after are never
 * truncated" — this function does not truncate either; that cap (§7.4's "up
 * to 5, then +N more" for the rest of the week) is a rendering decision for
 * the caller, not something baked into the data.
 */
export function buildUpcoming(
  assessments: AssessmentRow[],
  chapters: ChapterReadyRow[],
  assessmentChapters: AssessmentChapterRow[],
  routinePeriods: RoutinePeriodRow[],
  subjects: SubjectRow[],
  from: string,
): UpcomingItem[] {
  const items = [
    ...scheduledCTs(assessments, subjects, assessmentChapters),
    ...predictedCWMs(chapters, assessments, assessmentChapters, routinePeriods, subjects, from),
  ];

  return items.sort(
    (a, b) => a.date.localeCompare(b.date) || a.subjectName.localeCompare(b.subjectName),
  );
}

/** Items falling on exactly one calendar date — §7.4's "Tomorrow" section. */
export function itemsOnDate(items: UpcomingItem[], date: string): UpcomingItem[] {
  return items.filter((item) => item.date === date);
}
