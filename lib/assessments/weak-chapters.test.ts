import { describe, expect, it } from "vitest";
import type { AssessmentChapterRow, AssessmentRow, ChapterRow, ResultRow } from "./list";
import { weakestChapters } from "./weak-chapters";

function assessment(partial: Partial<AssessmentRow>): AssessmentRow {
  return {
    id: "a1",
    student_subject_id: "phy",
    paper_id: null,
    type: "CWM",
    status: "logged",
    scheduled_date: null,
    occurred_date: null,
    ...partial,
  };
}

function result(partial: Partial<ResultRow>): ResultRow {
  return {
    id: "r1",
    assessment_id: "a1",
    raw_obtained: 10,
    raw_total: 15,
    converted: 10,
    percentage: 66.7,
    paper_missing: false,
    entry_mode: "manual",
    logged_at: "2026-08-01T00:00:00Z",
    ...partial,
  };
}

const chapters: ChapterRow[] = [
  { id: "c1", name: "Friction" },
  { id: "c2", name: "Momentum" },
];

describe("weakestChapters", () => {
  it("averages percentage per chapter and sorts worst-first", () => {
    const assessments = [
      assessment({ id: "a1" }),
      assessment({ id: "a2" }),
    ];
    const results = [
      result({ id: "r1", assessment_id: "a1", percentage: 90 }),
      result({ id: "r2", assessment_id: "a2", percentage: 40 }),
    ];
    const links: AssessmentChapterRow[] = [
      { assessment_id: "a1", chapter_id: "c1" },
      { assessment_id: "a2", chapter_id: "c2" },
    ];

    const items = weakestChapters(results, assessments, links, chapters);
    expect(items.map((i) => i.chapterId)).toEqual(["c2", "c1"]);
    expect(items[0].averagePercentage).toBe(40);
  });

  it("averages several results linked to the same chapter", () => {
    const assessments = [assessment({ id: "a1" }), assessment({ id: "a2" })];
    const results = [
      result({ id: "r1", assessment_id: "a1", percentage: 80 }),
      result({ id: "r2", assessment_id: "a2", percentage: 60 }),
    ];
    const links: AssessmentChapterRow[] = [
      { assessment_id: "a1", chapter_id: "c1" },
      { assessment_id: "a2", chapter_id: "c1" },
    ];

    const items = weakestChapters(results, assessments, links, chapters);
    expect(items).toHaveLength(1);
    expect(items[0].averagePercentage).toBe(70);
    expect(items[0].resultCount).toBe(2);
  });

  it("respects the limit", () => {
    const many: ChapterRow[] = Array.from({ length: 8 }, (_, i) => ({
      id: `c${i}`,
      name: `Chapter ${i}`,
    }));
    const assessments = many.map((c, i) => assessment({ id: `a${i}` }));
    const results = many.map((c, i) => result({ id: `r${i}`, assessment_id: `a${i}`, percentage: 50 + i }));
    const links: AssessmentChapterRow[] = many.map((c, i) => ({
      assessment_id: `a${i}`,
      chapter_id: c.id,
    }));

    expect(weakestChapters(results, assessments, links, many, 3)).toHaveLength(3);
  });

  it("skips a result whose assessment or chapter is missing rather than crashing", () => {
    const results = [result({ id: "r1", assessment_id: "missing" })];
    expect(weakestChapters(results, [], [], chapters)).toEqual([]);
  });
});
