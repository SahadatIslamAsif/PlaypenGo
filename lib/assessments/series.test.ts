import { describe, expect, it } from "vitest";
import type { AssessmentRow, ResultRow, SubjectRow } from "./list";
import { lastNWeeks, toWeeklySeries } from "./series";

const subjects: SubjectRow[] = [
  { id: "phy", display_name: "Physics" },
  { id: "chem", display_name: "Chemistry" },
];

function assessment(
  id: string,
  subjectId: string,
  date: string,
  type: "CT" | "CWM" = "CWM",
): AssessmentRow {
  return {
    id,
    student_subject_id: subjectId,
    paper_id: null,
    chapter_id: null,
    type,
    status: "logged",
    scheduled_date: type === "CT" ? date : null,
    occurred_date: date,
  };
}

function result(id: string, assessmentId: string, percentage: number): ResultRow {
  const raw = { raw_obtained: percentage, raw_total: 100, converted: percentage, percentage };
  return {
    id,
    assessment_id: assessmentId,
    ...raw,
    paper_missing: false,
    entry_mode: "manual",
    logged_at: "2026-08-01T00:00:00Z",
  };
}

describe("toWeeklySeries", () => {
  it("buckets a result into the week containing its date, plotting percentage", () => {
    // 2026-08-30 is a Sunday.
    const assessments = [assessment("a1", "phy", "2026-08-31")]; // Monday, same week
    const results = [result("r1", "a1", 80)];

    const series = toWeeklySeries(results, assessments, subjects);
    expect(series).toHaveLength(1);
    expect(series[0].subjectId).toBe("phy");
    expect(series[0].points).toEqual([{ weekStart: "2026-08-30", percentage: 80 }]);
  });

  it("averages several results landing in the same week rather than overplotting", () => {
    const assessments = [
      assessment("a1", "phy", "2026-08-30"), // Sunday
      assessment("a2", "phy", "2026-09-01"), // Tuesday, same week
    ];
    const results = [result("r1", "a1", 80), result("r2", "a2", 60)];

    const series = toWeeklySeries(results, assessments, subjects);
    expect(series[0].points).toEqual([{ weekStart: "2026-08-30", percentage: 70 }]);
  });

  it("plots CT and CWM on the same axis - percentage, never converted", () => {
    // A CWM's converted figure (out of 15) and a CT's (out of 25) are not
    // comparable; percentage is. Mix the two types in one week.
    const assessments = [
      assessment("a1", "phy", "2026-08-30", "CWM"),
      assessment("a2", "phy", "2026-08-31", "CT"),
    ];
    const results = [result("r1", "a1", 90), result("r2", "a2", 70)];

    const series = toWeeklySeries(results, assessments, subjects);
    expect(series[0].points).toEqual([{ weekStart: "2026-08-30", percentage: 80 }]);
  });

  it("keeps subjects in separate series", () => {
    const assessments = [assessment("a1", "phy", "2026-08-30"), assessment("a2", "chem", "2026-08-30")];
    const results = [result("r1", "a1", 80), result("r2", "a2", 40)];

    const series = toWeeklySeries(results, assessments, subjects);
    expect(series.map((s) => s.subjectName)).toEqual(["Chemistry", "Physics"]);
  });

  it("orders points oldest to newest within a series", () => {
    const assessments = [
      assessment("a1", "phy", "2026-09-06"),
      assessment("a2", "phy", "2026-08-30"),
    ];
    const results = [result("r1", "a1", 50), result("r2", "a2", 90)];

    const series = toWeeklySeries(results, assessments, subjects);
    expect(series[0].points.map((p) => p.weekStart)).toEqual(["2026-08-30", "2026-09-06"]);
  });

  it("skips a result whose assessment is missing rather than crashing", () => {
    const results = [result("r1", "does-not-exist", 80)];
    expect(toWeeklySeries(results, [], subjects)).toEqual([]);
  });

  it("skips an assessment with no date at all", () => {
    const assessments: AssessmentRow[] = [
      { ...assessment("a1", "phy", "2026-08-30"), occurred_date: null, scheduled_date: null },
    ];
    const results = [result("r1", "a1", 80)];
    expect(toWeeklySeries(results, assessments, subjects)).toEqual([]);
  });
});

describe("lastNWeeks", () => {
  it("keeps only points within the trailing window", () => {
    const series = {
      subjectId: "phy",
      subjectName: "Physics",
      points: [
        { weekStart: "2026-07-05", percentage: 40 },
        { weekStart: "2026-08-16", percentage: 60 },
        { weekStart: "2026-08-30", percentage: 90 },
      ],
    };

    // "now" = 2026-09-01, 6 weeks back excludes the July point.
    const trimmed = lastNWeeks(series, 6, "2026-09-01");
    expect(trimmed.points.map((p) => p.weekStart)).toEqual(["2026-08-16", "2026-08-30"]);
  });
});
