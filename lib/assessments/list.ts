// Flat assessment+result rows -> the results list. The pure-transform pattern
// from lib/subjects/tree.ts and lib/routines/grid.ts: hand-written row types
// narrowed to the selected columns, not the generated Tables<> type.

export type AssessmentType = "CT" | "CWM";

export type AssessmentRow = {
  id: string;
  student_subject_id: string;
  paper_id: string | null;
  type: AssessmentType;
  status: string;
  scheduled_date: string | null;
  occurred_date: string | null;
};

// 0017: an assessment can cover several chapters (a CT often spans 2-3 in one
// paper, one combined mark) - the link lives in its own table rather than a
// scalar column, so every consumer joins through this row shape instead of
// reading assessment.chapter_id directly.
export type AssessmentChapterRow = { assessment_id: string; chapter_id: string };

export type ResultRow = {
  id: string;
  assessment_id: string;
  raw_obtained: number;
  raw_total: number;
  converted: number;
  percentage: number;
  paper_missing: boolean;
  entry_mode: "ocr" | "manual";
  logged_at: string;
};

export type SubjectRow = { id: string; display_name: string };
export type PaperRow = { id: string; name: string };
export type ChapterRow = { id: string; name: string };

export type ResultListItem = {
  resultId: string;
  assessmentId: string;
  subjectId: string;
  subjectName: string;
  paperName: string | null;
  chapterNames: string[];
  type: AssessmentType;
  date: string;
  rawObtained: number;
  rawTotal: number;
  converted: number;
  percentage: number;
  paperMissing: boolean;
  entryMode: "ocr" | "manual";
};

/**
 * Joins results to their assessment and the subject/paper/chapter names, and
 * sorts newest first. Every join is a plain Map lookup rather than a nested
 * loop — the same shape as buildSubjectTree()'s filters, chosen here for O(1)
 * lookups instead since a student's result history is the one list in the app
 * expected to grow into the hundreds.
 */
export function buildResultsList(
  results: ResultRow[],
  assessments: AssessmentRow[],
  subjects: SubjectRow[],
  papers: PaperRow[],
  chapters: ChapterRow[],
  assessmentChapters: AssessmentChapterRow[] = [],
): ResultListItem[] {
  const assessmentById = new Map(assessments.map((a) => [a.id, a]));
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const paperById = new Map(papers.map((p) => [p.id, p]));
  const chapterById = new Map(chapters.map((c) => [c.id, c]));

  const chapterIdsByAssessment = new Map<string, string[]>();
  for (const link of assessmentChapters) {
    const list = chapterIdsByAssessment.get(link.assessment_id) ?? [];
    list.push(link.chapter_id);
    chapterIdsByAssessment.set(link.assessment_id, list);
  }

  const items: ResultListItem[] = [];

  for (const result of results) {
    const assessment = assessmentById.get(result.assessment_id);
    if (!assessment) continue; // orphaned by a stale read; skip rather than crash

    const subject = subjectById.get(assessment.student_subject_id);

    items.push({
      resultId: result.id,
      assessmentId: assessment.id,
      subjectId: assessment.student_subject_id,
      subjectName: subject?.display_name ?? "Unknown subject",
      paperName: assessment.paper_id ? (paperById.get(assessment.paper_id)?.name ?? null) : null,
      chapterNames: (chapterIdsByAssessment.get(assessment.id) ?? [])
        .map((id) => chapterById.get(id)?.name)
        .filter((name): name is string => name !== undefined),
      type: assessment.type,
      date: assessment.occurred_date ?? assessment.scheduled_date ?? result.logged_at.slice(0, 10),
      rawObtained: result.raw_obtained,
      rawTotal: result.raw_total,
      converted: result.converted,
      percentage: result.percentage,
      paperMissing: result.paper_missing,
      entryMode: result.entry_mode,
    });
  }

  return items.sort((a, b) => b.date.localeCompare(a.date));
}

export function filterBySubject(
  items: ResultListItem[],
  subjectId: string | null,
): ResultListItem[] {
  if (!subjectId) return items;
  return items.filter((item) => item.subjectId === subjectId);
}
