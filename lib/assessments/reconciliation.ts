// §6's end-of-semester reconciliation view: "a table of the app's logged
// results beside a column for the portal's published figures, so anything
// the app missed is visible at the meeting." The portal has no API - its
// figures only exist as whatever the tutor reads off it in the room - so
// this only computes the app's own side; the portal column is a plain input
// the caller renders next to it, typed in live and never persisted (see the
// reconciliation page for why: CLAUDE.md's tutor write surface is
// `results_update` only, and a semester-end comparison column is not a
// correction to a logged mark).

import type { AssessmentRow, ResultRow, SubjectRow } from "./list";

export type ReconciliationRow = {
  subjectId: string;
  subjectName: string;
  /** Average percentage across every logged CWM for this subject, on the
   * §6 scale (out of 15) - null with nothing logged yet. */
  cwmAverage: number | null;
  cwmCount: number;
  /** Same, for CT (out of 25). */
  ctAverage: number | null;
  ctCount: number;
};

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10;
}

/**
 * One row per active subject, alphabetical - not sorted by anything the
 * tutor logged, since the point is spotting a subject that's missing
 * entirely, and an unlogged subject has no data to sort by.
 */
export function buildReconciliation(
  results: ResultRow[],
  assessments: AssessmentRow[],
  subjects: SubjectRow[],
): ReconciliationRow[] {
  const assessmentById = new Map(assessments.map((a) => [a.id, a]));

  const cwmBySubject = new Map<string, number[]>();
  const ctBySubject = new Map<string, number[]>();

  for (const result of results) {
    const assessment = assessmentById.get(result.assessment_id);
    if (!assessment) continue;

    const bucket = assessment.type === "CT" ? ctBySubject : cwmBySubject;
    bucket.set(assessment.student_subject_id, [
      ...(bucket.get(assessment.student_subject_id) ?? []),
      result.converted,
    ]);
  }

  return subjects
    .map((subject) => {
      const cwmValues = cwmBySubject.get(subject.id) ?? [];
      const ctValues = ctBySubject.get(subject.id) ?? [];
      return {
        subjectId: subject.id,
        subjectName: subject.display_name,
        cwmAverage: average(cwmValues),
        cwmCount: cwmValues.length,
        ctAverage: average(ctValues),
        ctCount: ctValues.length,
      };
    })
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName));
}
