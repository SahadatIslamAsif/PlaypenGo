// Coverage for the CT-date attachment buildSubjectTree() gained in Phase 4
// (§8: "Assign / edit CT date on any chapter"). The tree-building logic
// itself predates the vitest layer; this file does not attempt to backfill
// full coverage for it, only the new behavior.

import { describe, expect, it } from "vitest";
import { buildSubjectTree } from "./tree";

const subjects = [{ id: "phy", display_name: "Physics", teacher_name: null, sort_order: 0 }];
const chapters = [
  { id: "c1", student_subject_id: "phy", paper_id: null, name: "1.1", status: "p100", sort_order: 0 },
  { id: "c2", student_subject_id: "phy", paper_id: null, name: "1.2", status: "not_started", sort_order: 1 },
];

describe("buildSubjectTree — CT dates", () => {
  it("leaves ct null for a chapter with no assessment", () => {
    const [subject] = buildSubjectTree(subjects, [], chapters);
    expect(subject.chapters[0].ct).toBeNull();
  });

  it("attaches the assessment id and date to the matching chapter only", () => {
    const [subject] = buildSubjectTree(
      subjects,
      [],
      chapters,
      [{ id: "a1", scheduled_date: "2026-09-10", status: "scheduled" }],
      [{ assessment_id: "a1", chapter_id: "c1" }],
    );
    expect(subject.chapters[0].ct).toEqual({
      assessmentId: "a1",
      date: "2026-09-10",
      status: "scheduled",
      chapterIds: ["c1"],
    });
    expect(subject.chapters[1].ct).toBeNull();
  });

  it("carries the assessment's status through - e.g. cancelled", () => {
    const [subject] = buildSubjectTree(
      subjects,
      [],
      chapters,
      [{ id: "a1", scheduled_date: null, status: "cancelled" }],
      [{ assessment_id: "a1", chapter_id: "c1" }],
    );
    expect(subject.chapters[0].ct).toEqual({
      assessmentId: "a1",
      date: null,
      status: "cancelled",
      chapterIds: ["c1"],
    });
  });

  it("attaches CT dates to chapters under a paper too", () => {
    const papers = [{ id: "p1", student_subject_id: "phy", name: "Math D", sort_order: 0 }];
    const paperChapters = [
      { id: "c3", student_subject_id: "phy", paper_id: "p1", name: "2.1", status: "p80", sort_order: 0 },
    ];
    const [subject] = buildSubjectTree(
      subjects,
      papers,
      paperChapters,
      [{ id: "a2", scheduled_date: "2026-09-15", status: "scheduled" }],
      [{ assessment_id: "a2", chapter_id: "c3" }],
    );
    expect(subject.papers[0].chapters[0].ct).toEqual({
      assessmentId: "a2",
      date: "2026-09-15",
      status: "scheduled",
      chapterIds: ["c3"],
    });
  });

  it("ignores an assessment with no chapter link at all", () => {
    const [subject] = buildSubjectTree(
      subjects,
      [],
      chapters,
      [{ id: "a3", scheduled_date: "2026-09-10", status: "scheduled" }],
      [],
    );
    expect(subject.chapters.every((c) => c.ct === null)).toBe(true);
  });

  it("0017: a CT spanning several chapters lists every one of them on each chapter's ct", () => {
    const [subject] = buildSubjectTree(
      subjects,
      [],
      chapters,
      [{ id: "a1", scheduled_date: "2026-09-10", status: "scheduled" }],
      [
        { assessment_id: "a1", chapter_id: "c1" },
        { assessment_id: "a1", chapter_id: "c2" },
      ],
    );
    expect(subject.chapters[0].ct?.chapterIds).toEqual(["c1", "c2"]);
    expect(subject.chapters[1].ct?.chapterIds).toEqual(["c1", "c2"]);
  });
});
