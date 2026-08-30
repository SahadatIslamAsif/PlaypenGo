import { describe, expect, it } from "vitest";
import type { UpcomingItem } from "@/lib/assessments/upcoming";
import { buildRoster, type RosterStudentInput } from "./roster";

function item(partial: Partial<UpcomingItem>): UpcomingItem {
  return {
    kind: "scheduled_ct",
    date: "2026-08-30",
    subjectId: "phy",
    subjectName: "Physics",
    assessmentId: "a1",
    chapterIds: [],
    ...partial,
  };
}

function student(partial: Partial<RosterStudentInput>): RosterStudentInput {
  return {
    studentId: "s1",
    studentName: "Alex",
    assessments: [],
    upcoming: [],
    recentPercentages: [],
    ...partial,
  };
}

describe("buildRoster", () => {
  it("counts only items falling on tomorrow", () => {
    const rows = buildRoster(
      [
        student({
          upcoming: [
            item({ date: "2026-08-30" }), // tomorrow
            item({ date: "2026-08-30" }), // tomorrow
            item({ date: "2026-09-02" }), // later in the week
          ],
        }),
      ],
      "2026-08-29",
    );
    expect(rows[0].tomorrowCount).toBe(2);
  });

  it("sorts unlogged count first - the primary signal per §8", () => {
    const rows = buildRoster(
      [
        student({ studentId: "low", studentName: "Low", assessments: [] }),
        student({
          studentId: "high",
          studentName: "High",
          assessments: [{ student_subject_id: "phy", status: "occurred", scheduled_date: null }],
        }),
      ],
      "2026-08-29",
    );
    expect(rows.map((r) => r.studentId)).toEqual(["high", "low"]);
  });

  it("breaks an unlogged tie on tomorrow's load, then name", () => {
    const rows = buildRoster(
      [
        student({ studentId: "z", studentName: "Zara", upcoming: [item({ date: "2026-08-30" })] }),
        student({ studentId: "a", studentName: "Amir", upcoming: [] }),
      ],
      "2026-08-29",
    );
    expect(rows.map((r) => r.studentId)).toEqual(["z", "a"]);
  });

  it("computes trend from each student's own recent percentages", () => {
    const rows = buildRoster(
      [student({ recentPercentages: [90, 88, 92, 60, 58, 62] })],
      "2026-08-29",
    );
    expect(rows[0].trend).toBe("up");
  });
});
