import { describe, expect, it } from "vitest";
import type { RoutinePeriodRow } from "@/lib/routines/grid";
import type { AssessmentRow } from "./list";
import { buildUpcoming, itemsOnDate, type ChapterReadyRow, type SubjectRow } from "./upcoming";

const subjects: SubjectRow[] = [
  { id: "phy", display_name: "Physics" },
  { id: "chem", display_name: "Chemistry" },
];

function period(
  day: number,
  subjectId: string | null,
  isAcademic = true,
): RoutinePeriodRow {
  return {
    id: `${day}-${subjectId ?? "break"}`,
    day_of_week: day,
    period_no: 1,
    start_time: null,
    end_time: null,
    raw_text: null,
    teacher_raw: null,
    student_subject_id: subjectId,
    is_academic: isAcademic,
  };
}

function assessment(partial: Partial<AssessmentRow> & { id: string }): AssessmentRow {
  return {
    student_subject_id: "phy",
    paper_id: null,
    chapter_id: null,
    type: "CT",
    status: "scheduled",
    scheduled_date: null,
    occurred_date: null,
    ...partial,
  };
}

function chapter(partial: Partial<ChapterReadyRow> & { id: string }): ChapterReadyRow {
  return { student_subject_id: "phy", status: "p100", ...partial };
}

// Chemistry on Sunday, Monday, Tuesday — §7.3's worked example.
const routine: RoutinePeriodRow[] = [
  period(0, "chem"),
  period(1, "chem"),
  period(2, "chem"),
  period(3, "phy"),
];

describe("buildUpcoming — scheduled CTs", () => {
  it("lists a scheduled CT on its own date", () => {
    const items = buildUpcoming(
      [assessment({ id: "a1", type: "CT", status: "scheduled", scheduled_date: "2026-09-01" })],
      [],
      routine,
      subjects,
      "2026-08-30",
    );
    expect(items).toEqual([
      {
        kind: "scheduled_ct",
        date: "2026-09-01",
        subjectId: "phy",
        subjectName: "Physics",
        assessmentId: "a1",
        chapterId: null,
      },
    ]);
  });

  it("ignores a CT that has already been logged - it is history, not upcoming", () => {
    const items = buildUpcoming(
      [assessment({ id: "a1", type: "CT", status: "logged", scheduled_date: "2026-09-01" })],
      [],
      routine,
      subjects,
      "2026-08-30",
    );
    expect(items).toEqual([]);
  });

  it("ignores a cancelled CT", () => {
    const items = buildUpcoming(
      [assessment({ id: "a1", type: "CT", status: "cancelled", scheduled_date: "2026-09-01" })],
      [],
      routine,
      subjects,
      "2026-08-30",
    );
    expect(items).toEqual([]);
  });
});

describe("buildUpcoming — predicted CWMs, §7.3", () => {
  it("predicts a CWM on the next day the subject meets", () => {
    const items = buildUpcoming(
      [],
      [chapter({ id: "c1", student_subject_id: "chem", status: "p100" })],
      routine,
      subjects,
      "2026-08-30", // Sunday; Chemistry's next class is Monday
    );
    expect(items).toEqual([
      {
        kind: "predicted_cwm",
        date: "2026-08-31",
        subjectId: "chem",
        subjectName: "Chemistry",
        assessmentId: null,
        chapterId: "c1",
      },
    ]);
  });

  it("predicts for p80 as well as p100", () => {
    const items = buildUpcoming(
      [],
      [chapter({ id: "c1", student_subject_id: "chem", status: "p80" })],
      routine,
      subjects,
      "2026-08-30",
    );
    expect(items).toHaveLength(1);
  });

  it("does not predict for not_started or not_taught", () => {
    const items = buildUpcoming(
      [],
      [
        chapter({ id: "c1", status: "not_started" }),
        chapter({ id: "c2", status: "not_taught" }),
      ],
      routine,
      subjects,
      "2026-08-30",
    );
    expect(items).toEqual([]);
  });

  it("skips a chapter whose subject has no academic period at all", () => {
    // crosscheck.ts's warning case: nextClassDay returns null, so there is
    // nothing to show rather than a fabricated date.
    const items = buildUpcoming(
      [],
      [chapter({ id: "c1", student_subject_id: "unrouted", status: "p100" })],
      routine,
      subjects,
      "2026-08-30",
    );
    expect(items).toEqual([]);
  });

  it("does not double up a chapter that already has an open CWM assessment", () => {
    // The prediction became a real row (e.g. via §7.6's confirmation); the
    // chapter must not also appear as a bare prediction.
    const items = buildUpcoming(
      [
        assessment({
          id: "a1",
          type: "CWM",
          status: "occurred",
          student_subject_id: "chem",
          chapter_id: "c1",
        }),
      ],
      [chapter({ id: "c1", student_subject_id: "chem", status: "p100" })],
      routine,
      subjects,
      "2026-08-30",
    );
    expect(items).toEqual([]);
  });

  it("predicts again once the open assessment is logged", () => {
    const items = buildUpcoming(
      [
        assessment({
          id: "a1",
          type: "CWM",
          status: "logged",
          student_subject_id: "chem",
          chapter_id: "c1",
        }),
      ],
      [chapter({ id: "c1", student_subject_id: "chem", status: "p100" })],
      routine,
      subjects,
      "2026-08-30",
    );
    expect(items).toHaveLength(1);
  });
});

describe("buildUpcoming — merge order", () => {
  it("sorts CTs and predicted CWMs together by date", () => {
    const items = buildUpcoming(
      [assessment({ id: "a1", type: "CT", status: "scheduled", scheduled_date: "2026-09-02" })],
      [chapter({ id: "c1", student_subject_id: "chem", status: "p100" })],
      routine,
      subjects,
      "2026-08-30", // predicted Chemistry lands 2026-08-31, before the CT
    );
    expect(items.map((i) => i.date)).toEqual(["2026-08-31", "2026-09-02"]);
  });

  it("is not truncated - §7.4 requires Tomorrow and Day after to show everything", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      assessment({
        id: `a${i}`,
        type: "CT",
        status: "scheduled",
        scheduled_date: "2026-09-01",
      }),
    );
    expect(buildUpcoming(many, [], routine, subjects, "2026-08-30")).toHaveLength(8);
  });
});

describe("itemsOnDate", () => {
  it("filters to exactly one calendar date", () => {
    const items = buildUpcoming(
      [
        assessment({ id: "a1", type: "CT", status: "scheduled", scheduled_date: "2026-09-01" }),
        assessment({ id: "a2", type: "CT", status: "scheduled", scheduled_date: "2026-09-02" }),
      ],
      [],
      routine,
      subjects,
      "2026-08-30",
    );
    expect(itemsOnDate(items, "2026-09-01")).toHaveLength(1);
  });
});
