export type ChapterStatus = "not_started" | "p80" | "p100" | "not_taught";

export type ChapterCT = {
  assessmentId: string;
  date: string | null;
  status: string;
  /** Every chapter this same CT covers (0017) - a CT often spans 2-3. */
  chapterIds: string[];
};

export type ChapterNode = {
  id: string;
  name: string;
  status: ChapterStatus;
  sort_order: number;
  /** The chapter's CT assessment, if one has been assigned (§8). */
  ct: ChapterCT | null;
};

export type PaperNode = {
  id: string;
  name: string;
  sort_order: number;
  chapters: ChapterNode[];
};

export type SubjectNode = {
  id: string;
  display_name: string;
  teacher_name: string | null;
  sort_order: number;
  chapters: ChapterNode[];
  papers: PaperNode[];
};

type SubjectRow = {
  id: string;
  display_name: string;
  teacher_name: string | null;
  sort_order: number;
};

type PaperRow = {
  id: string;
  student_subject_id: string;
  name: string;
  sort_order: number;
};

type ChapterRow = {
  id: string;
  student_subject_id: string;
  paper_id: string | null;
  name: string;
  status: string;
  sort_order: number;
};

export type CTAssessmentRow = {
  id: string;
  scheduled_date: string | null;
  status: string;
};

// 0017: assessments carries no chapter_id column any more - which chapters a
// CT covers lives in assessment_chapters, joined in here the same way
// lib/assessments/list.ts joins it for results.
export type CTChapterLinkRow = { assessment_id: string; chapter_id: string };

export function buildSubjectTree(
  subjects: SubjectRow[],
  papers: PaperRow[],
  chapters: ChapterRow[],
  ctAssessments: CTAssessmentRow[] = [],
  ctChapterLinks: CTChapterLinkRow[] = [],
): SubjectNode[] {
  const ctById = new Map(ctAssessments.map((a) => [a.id, a]));

  // Multiple CT assessments could in principle exist for the same chapter
  // over time (one cancelled, one rescheduled). The chapter row shows the
  // last one in the array, which the caller is expected to have ordered
  // newest-first if more than one is live for the same chapter.
  const ctByChapter = new Map<string, CTAssessmentRow>();
  const chapterIdsByAssessment = new Map<string, string[]>();
  for (const link of ctChapterLinks) {
    const ct = ctById.get(link.assessment_id);
    if (!ct) continue; // a link to a non-CT (or absent) assessment - not this tree's concern
    ctByChapter.set(link.chapter_id, ct);
    const ids = chapterIdsByAssessment.get(link.assessment_id) ?? [];
    ids.push(link.chapter_id);
    chapterIdsByAssessment.set(link.assessment_id, ids);
  }

  return subjects
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((subject) => {
      const subjectPapers = papers
        .filter((p) => p.student_subject_id === subject.id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((paper) => ({
          id: paper.id,
          name: paper.name,
          sort_order: paper.sort_order,
          chapters: chapters
            .filter((c) => c.paper_id === paper.id)
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((c) => toChapterNode(c, ctByChapter.get(c.id), chapterIdsByAssessment)),
        }));

      const subjectChapters = chapters
        .filter((c) => c.student_subject_id === subject.id && c.paper_id === null)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((c) => toChapterNode(c, ctByChapter.get(c.id), chapterIdsByAssessment));

      return {
        id: subject.id,
        display_name: subject.display_name,
        teacher_name: subject.teacher_name,
        sort_order: subject.sort_order,
        chapters: subjectChapters,
        papers: subjectPapers,
      };
    });
}

function toChapterNode(
  chapter: ChapterRow,
  ct: CTAssessmentRow | undefined,
  chapterIdsByAssessment: Map<string, string[]>,
): ChapterNode {
  return {
    id: chapter.id,
    name: chapter.name,
    status: chapter.status as ChapterStatus,
    sort_order: chapter.sort_order,
    ct: ct
      ? {
          assessmentId: ct.id,
          date: ct.scheduled_date,
          status: ct.status,
          chapterIds: chapterIdsByAssessment.get(ct.id) ?? [],
        }
      : null,
  };
}
