export type ChapterStatus = "not_started" | "p80" | "p100" | "not_taught";

export type ChapterCT = {
  assessmentId: string;
  date: string | null;
  status: string;
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
  chapter_id: string | null;
  scheduled_date: string | null;
  status: string;
};

export function buildSubjectTree(
  subjects: SubjectRow[],
  papers: PaperRow[],
  chapters: ChapterRow[],
  ctAssessments: CTAssessmentRow[] = [],
): SubjectNode[] {
  // Multiple CT assessments could in principle exist for the same chapter
  // over time (one cancelled, one rescheduled). The chapter row shows the
  // last one in the array, which the caller is expected to have ordered
  // newest-first if more than one is live for the same chapter.
  const ctByChapter = new Map<string, CTAssessmentRow>();
  for (const a of ctAssessments) {
    if (a.chapter_id) ctByChapter.set(a.chapter_id, a);
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
            .map((c) => toChapterNode(c, ctByChapter.get(c.id))),
        }));

      const subjectChapters = chapters
        .filter((c) => c.student_subject_id === subject.id && c.paper_id === null)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((c) => toChapterNode(c, ctByChapter.get(c.id)));

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

function toChapterNode(chapter: ChapterRow, ct: CTAssessmentRow | undefined): ChapterNode {
  return {
    id: chapter.id,
    name: chapter.name,
    status: chapter.status as ChapterStatus,
    sort_order: chapter.sort_order,
    ct: ct ? { assessmentId: ct.id, date: ct.scheduled_date, status: ct.status } : null,
  };
}
