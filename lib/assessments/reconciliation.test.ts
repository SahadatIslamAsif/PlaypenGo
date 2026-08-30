import { describe, expect, it } from "vitest";
import type { AssessmentRow, ResultRow, SubjectRow } from "./list";
import { buildReconciliation } from "./reconciliation";

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

const subjects: SubjectRow[] = [
  { id: "phy", display_name: "Physics" },
  { id: "chem", display_name: "Chemistry" },
];

describe("buildReconciliation", () => {
  it("includes every active subject, even one with nothing logged", () => {
    const rows = buildReconciliation([], [], subjects);
    expect(rows).toEqual([
      { subjectId: "chem", subjectName: "Chemistry", cwmAverage: null, cwmCount: 0, ctAverage: null, ctCount: 0 },
      { subjectId: "phy", subjectName: "Physics", cwmAverage: null, cwmCount: 0, ctAverage: null, ctCount: 0 },
    ]);
  });

  it("averages CWM and CT converted marks separately", () => {
    const assessments = [
      assessment({ id: "a1", type: "CWM" }),
      assessment({ id: "a2", type: "CT" }),
    ];
    const results = [
      result({ id: "r1", assessment_id: "a1", converted: 12 }),
      result({ id: "r2", assessment_id: "a2", converted: 20 }),
    ];
    const rows = buildReconciliation(results, assessments, subjects);
    const phy = rows.find((r) => r.subjectId === "phy");
    expect(phy?.cwmAverage).toBe(12);
    expect(phy?.cwmCount).toBe(1);
    expect(phy?.ctAverage).toBe(20);
    expect(phy?.ctCount).toBe(1);
  });

  it("averages several results of the same type for one subject", () => {
    const assessments = [assessment({ id: "a1" }), assessment({ id: "a2" })];
    const results = [
      result({ id: "r1", assessment_id: "a1", converted: 10 }),
      result({ id: "r2", assessment_id: "a2", converted: 14 }),
    ];
    const rows = buildReconciliation(results, assessments, subjects);
    expect(rows.find((r) => r.subjectId === "phy")?.cwmAverage).toBe(12);
  });

  it("sorts alphabetically by subject name, not by data present", () => {
    const rows = buildReconciliation([], [], subjects);
    expect(rows.map((r) => r.subjectName)).toEqual(["Chemistry", "Physics"]);
  });

  it("skips a result whose assessment is missing rather than crashing", () => {
    const results = [result({ id: "r1", assessment_id: "missing" })];
    expect(buildReconciliation(results, [], subjects)).toEqual([
      { subjectId: "chem", subjectName: "Chemistry", cwmAverage: null, cwmCount: 0, ctAverage: null, ctCount: 0 },
      { subjectId: "phy", subjectName: "Physics", cwmAverage: null, cwmCount: 0, ctAverage: null, ctCount: 0 },
    ]);
  });
});
