// Phase 5's payoff for resolve.test.ts's own claim: "these rules are what
// Phase 5's parse will be judged against." adaptRoutineParse() is the seam
// where a RawRoutineParse (§5.1's wire shape) becomes the same draft grid a
// hand-typed cell already produces - these tests check that seam alone, with
// no network and no database, mirroring resolve.test.ts's own reasoning for
// running without either.

import { describe, expect, it } from "vitest";
import type { SubjectCandidate } from "../resolve";
import { adaptRoutineParse } from "./adapt";
import type { RawRoutineParse, RawRoutinePeriod } from "./schema";

const subjects: SubjectCandidate[] = [
  { id: "phy", display_name: "Physics", aliases: ["Phy"] },
  { id: "env", display_name: "Env. Management", aliases: ["Env Mgt", "EM"] },
];

function period(overrides: Partial<RawRoutinePeriod>): RawRoutinePeriod {
  return {
    day: "SUN",
    period_no: 1,
    start: "08:15",
    end: "08:55",
    raw_text: "",
    teacher: null,
    matched_subject: null,
    is_academic: true,
    confidence: 0.9,
    ...overrides,
  };
}

function parse(periods: RawRoutinePeriod[]): RawRoutineParse {
  return { class_level: null, section: null, class_teacher: null, periods };
}

describe("adaptRoutineParse", () => {
  it("resolves a cell through raw_text the same way a typed cell would", () => {
    const grid = adaptRoutineParse(
      parse([period({ raw_text: "Phy", teacher: "Rakin" })]),
      subjects,
    );
    const cell = grid.cells[0][0];
    expect(cell.student_subject_id).toBe("phy");
    expect(cell.raw_text).toBe("Phy");
    expect(cell.teacher_raw).toBe("Rakin");
    expect(cell.id).toBeNull();
  });

  it("falls back to matched_subject only when raw_text resolves to nothing", () => {
    // A misread the model's visual context can still place, even though the
    // literal text matches no alias.
    const grid = adaptRoutineParse(
      parse([period({ raw_text: "Enviro Mgmt", matched_subject: "Env. Management" })]),
      subjects,
    );
    expect(grid.cells[0][0].student_subject_id).toBe("env");
  });

  it("never lets matched_subject override a raw_text resolution", () => {
    const grid = adaptRoutineParse(
      parse([period({ raw_text: "Phy", matched_subject: "Env. Management" })]),
      subjects,
    );
    expect(grid.cells[0][0].student_subject_id).toBe("phy");
  });

  it("leaves an unresolved cell with no subject rather than guessing", () => {
    const grid = adaptRoutineParse(
      parse([period({ raw_text: "Unknown Subject", matched_subject: null })]),
      subjects,
    );
    const cell = grid.cells[0][0];
    expect(cell.student_subject_id).toBeNull();
    expect(cell.raw_text).toBe("Unknown Subject");
  });

  it("treats a named non-academic period as non-academic even if the model marked it academic", () => {
    const grid = adaptRoutineParse(
      parse([period({ raw_text: "Assembly", is_academic: true, teacher: "Someone" })]),
      subjects,
    );
    const cell = grid.cells[0][0];
    expect(cell.is_academic).toBe(false);
    expect(cell.student_subject_id).toBeNull();
    expect(cell.teacher_raw).toBe("");
  });

  it("trusts the model's is_academic read for a vertical break column letter", () => {
    // "B" alone isn't in resolve.ts's own non-academic word list - only a
    // look across the whole column (which the model has, and resolveSubject
    // on one cell never does) can catch this.
    const grid = adaptRoutineParse(
      parse([period({ raw_text: "B", is_academic: false })]),
      subjects,
    );
    const cell = grid.cells[0][0];
    expect(cell.is_academic).toBe(false);
    expect(cell.student_subject_id).toBeNull();
  });

  it("stamps one period's time across every day, from whichever entry carries it", () => {
    const grid = adaptRoutineParse(
      parse([
        period({ day: "SUN", period_no: 1, start: "08:15", end: "08:55", raw_text: "Phy" }),
        period({ day: "MON", period_no: 1, start: "", end: "", raw_text: "Phy" }),
      ]),
      subjects,
    );
    expect(grid.columns[0]).toEqual({ period_no: 1, start_time: "08:15", end_time: "08:55" });
  });

  it("fills a day/period the parse never reported with a blank cell", () => {
    const grid = adaptRoutineParse(
      parse([period({ day: "SUN", period_no: 1, raw_text: "Phy" })]),
      subjects,
    );
    // Only SUN period 1 was reported; MON period 1 must still exist, blank.
    const monday = grid.cells[1][0];
    expect(monday.raw_text).toBe("");
    expect(monday.student_subject_id).toBeNull();
    expect(monday.id).toBeNull();
  });

  it("builds the column set from every distinct period_no across all days", () => {
    const grid = adaptRoutineParse(
      parse([
        period({ day: "SUN", period_no: 1, raw_text: "Phy" }),
        period({ day: "SUN", period_no: 2, raw_text: "Env Mgt" }),
      ]),
      subjects,
    );
    expect(grid.columns.map((c) => c.period_no)).toEqual([1, 2]);
  });
});
