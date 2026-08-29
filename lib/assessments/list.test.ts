import { describe, expect, it } from "vitest";
import { countUnlogged, type UnloggedAssessmentRow } from "./list";

function row(partial: Partial<UnloggedAssessmentRow>): UnloggedAssessmentRow {
  return { student_subject_id: "phy", status: "scheduled", scheduled_date: null, ...partial };
}

describe("countUnlogged", () => {
  it("counts an 'occurred' CWM (confirmed via §7.6, not yet logged)", () => {
    expect(countUnlogged([row({ status: "occurred" })], null, "2026-08-20")).toBe(1);
  });

  it("counts a scheduled CT whose date has already passed", () => {
    const rows = [row({ status: "scheduled", scheduled_date: "2026-08-10" })];
    expect(countUnlogged(rows, null, "2026-08-20")).toBe(1);
  });

  it("does not count a scheduled CT that hasn't happened yet", () => {
    const rows = [row({ status: "scheduled", scheduled_date: "2026-08-25" })];
    expect(countUnlogged(rows, null, "2026-08-20")).toBe(0);
  });

  it("does not count 'logged' or 'predicted' rows - a result already exists, or nothing has happened", () => {
    const rows = [row({ status: "logged" }), row({ status: "predicted" }), row({ status: "cancelled" })];
    expect(countUnlogged(rows, null, "2026-08-20")).toBe(0);
  });

  it("scopes to the active subject filter, same as filterBySubject", () => {
    const rows = [
      row({ student_subject_id: "phy", status: "occurred" }),
      row({ student_subject_id: "chem", status: "occurred" }),
    ];
    expect(countUnlogged(rows, "phy", "2026-08-20")).toBe(1);
    expect(countUnlogged(rows, null, "2026-08-20")).toBe(2);
  });
});
