export type ChapterStatus = "not_started" | "p80" | "p100" | "not_taught";

export type ChapterNode = {
  id: string;
  name: string;
  status: ChapterStatus;
  sort_order: number;
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

export function buildSubjectTree(
  subjects: SubjectRow[],
  papers: PaperRow[],
  chapters: ChapterRow[],
): SubjectNode[] {
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
            .map(toChapterNode),
        }));

      const subjectChapters = chapters
        .filter((c) => c.student_subject_id === subject.id && c.paper_id === null)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(toChapterNode);

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

function toChapterNode(chapter: ChapterRow): ChapterNode {
  return {
    id: chapter.id,
    name: chapter.name,
    status: chapter.status as ChapterStatus,
    sort_order: chapter.sort_order,
  };
}
