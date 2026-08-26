import { describe, expect, it } from "vitest";
import { crosscheckRoutine } from "./crosscheck";
import {
  buildRoutineGrid,
  emptyRoutineGrid,
  fillColumn,
  gridToCommitPayload,
  setCell,
  type RoutinePeriodRow,
} from "./grid";

const subjects = [
  { id: "phy", display_name: "Physics" },
  { id: "chem", display_name: "Chemistry" },
];

const columns = [
  { period_no: 1, start_time: "08:15", end_time: "08:55" },
  { period_no: 2, start_time: "10:55", end_time: "11:25" },
];

/** A grid with Physics every day in period 1 and nothing in period 2. */
function physicsWeek() {
  let grid = emptyRoutineGrid(columns);
  for (const day of [0, 1, 2, 3, 4] as const) {
    grid = setCell(grid, day, 0, {
      raw_text: "Physics",
      student_subject_id: "phy",
      is_academic: true,
    });
  }
  return grid;
}

describe("crosscheckRoutine", () => {
  it("warns about a subject with no period — §7.3 could never predict it", () => {
    const warnings = crosscheckRoutine(physicsWeek(), subjects);
    expect(warnings.filter((w) => w.kind === "subject_missing")).toHaveLength(1);
    expect(warnings[0].message).toContain("Chemistry");
  });

  it("warns about text that matched no subject, and says where", () => {
    const grid = setCell(physicsWeek(), 2, 1, {
      raw_text: "Env. Mgt",
      is_academic: true,
    });
    const warning = crosscheckRoutine(grid, subjects).find(
      (w) => w.kind === "unresolved_cell",
    );

    expect(warning?.message).toContain("Tue period 2");
    expect(warning?.cell).toEqual({ day: 2, columnIndex: 1 });
  });

  it("does not chase a cell that is already matched", () => {
    const grid = setCell(physicsWeek(), 0, 1, {
      raw_text: "Chem",
      student_subject_id: "chem",
      is_academic: true,
    });
    expect(
      crosscheckRoutine(grid, subjects).filter((w) => w.kind === "unresolved_cell"),
    ).toHaveLength(0);
  });

  it("does not chase a named non-academic period", () => {
    // 'Games' is not a subject and is not a mistake either.
    const grid = setCell(physicsWeek(), 0, 1, { raw_text: "Games", is_academic: true });
    expect(
      crosscheckRoutine(grid, subjects).filter((w) => w.kind === "unresolved_cell"),
    ).toHaveLength(0);
  });

  it("flags a vertical BREAK column still marked as lessons", () => {
    // The case the warning exists for: §5.1 rule 1 spelled down the column, but
    // is_academic left true, which would put five phantom lessons into §7.3.
    let grid = physicsWeek();
    ["B", "R", "E", "A", "K"].forEach((letter, day) => {
      grid = setCell(grid, day as 0 | 1 | 2 | 3 | 4, 1, {
        raw_text: letter,
        is_academic: true,
      });
    });

    expect(
      crosscheckRoutine(grid, subjects).filter((w) => w.kind === "break_column"),
    ).toHaveLength(1);
  });

  it("stops flagging it once the column is marked as a break", () => {
    let grid = physicsWeek();
    ["B", "R", "E", "A", "K"].forEach((letter, day) => {
      grid = setCell(grid, day as 0 | 1 | 2 | 3 | 4, 1, {
        raw_text: letter,
        is_academic: true,
      });
    });
    grid = fillColumn(grid, 1, "Break");

    expect(
      crosscheckRoutine(grid, subjects).filter((w) => w.kind === "break_column"),
    ).toHaveLength(0);
  });

  it("flags the sample's Shafiul/Shafiur as one teacher", () => {
    let grid = physicsWeek();
    grid = setCell(grid, 0, 0, { teacher_raw: "Shafiul" });
    grid = setCell(grid, 1, 0, { teacher_raw: "Shafiul" });
    grid = setCell(grid, 2, 0, { teacher_raw: "Shafiur" });

    const warning = crosscheckRoutine(grid, subjects).find(
      (w) => w.kind === "teacher_variants",
    );
    expect(warning?.message).toContain("Shafiul and Shafiur");
  });

  it("is silent on a complete, consistent routine", () => {
    let grid = physicsWeek();
    for (const day of [0, 1, 2, 3, 4] as const) {
      grid = setCell(grid, day, 0, { teacher_raw: "Shafiul" });
      grid = setCell(grid, day, 1, {
        raw_text: "Chemistry",
        student_subject_id: "chem",
        teacher_raw: "Rakin",
        is_academic: true,
      });
    }
    expect(crosscheckRoutine(grid, subjects)).toEqual([]);
  });
});

describe("grid round-trip", () => {
  const rows: RoutinePeriodRow[] = [
    {
      id: "r1",
      day_of_week: 0,
      period_no: 1,
      start_time: "08:15:00",
      end_time: "08:55:00",
      raw_text: "Phy",
      teacher_raw: "Shafiul",
      student_subject_id: "phy",
      is_academic: true,
    },
    {
      id: "r2",
      day_of_week: 2,
      period_no: 3,
      start_time: "11:25:00",
      end_time: "12:05:00",
      raw_text: "B",
      teacher_raw: null,
      student_subject_id: null,
      is_academic: false,
    },
  ];

  it("builds a full rectangle from a ragged week", () => {
    const grid = buildRoutineGrid(rows);
    // Two distinct period numbers become two columns; every day gets both.
    expect(grid.columns.map((c) => c.period_no)).toEqual([1, 3]);
    expect(grid.cells).toHaveLength(5);
    expect(grid.cells.every((row) => row.length === 2)).toBe(true);
  });

  it("trims the seconds Postgres adds, for the time input", () => {
    expect(buildRoutineGrid(rows).columns[0].start_time).toBe("08:15");
  });

  it("keeps the committed row id so live edits can patch one cell", () => {
    expect(buildRoutineGrid(rows).cells[0][0].id).toBe("r1");
    expect(buildRoutineGrid(rows).cells[1][0].id).toBeNull();
  });

  it("sends only filled cells, stamping the column's times onto each", () => {
    const payload = gridToCommitPayload(buildRoutineGrid(rows), "routine-1", null);
    expect(payload.periods).toHaveLength(2);
    expect(payload.periods[0]).toMatchObject({
      day_of_week: 0,
      period_no: 1,
      start_time: "08:15",
      raw_text: "Phy",
      teacher_raw: "Shafiul",
      is_academic: true,
    });
  });

  it("drops blanks rather than committing empty cells", () => {
    const payload = gridToCommitPayload(emptyRoutineGrid(columns), "routine-1", null);
    expect(payload.periods).toEqual([]);
  });

  it("marks a whole column as a break in one call — §5.1 rules 1 and 2", () => {
    const grid = fillColumn(physicsWeek(), 1, "Break");
    expect(grid.cells.every((row) => row[1].is_academic === false)).toBe(true);
    expect(grid.cells.every((row) => row[1].raw_text === "Break")).toBe(true);
  });

  it("clears the subject when a lesson column becomes a break", () => {
    const grid = fillColumn(physicsWeek(), 0, "Break");
    expect(grid.cells.every((row) => row[0].student_subject_id === null)).toBe(true);
  });
});
