// §5.1's cross-check, as a pure function over the draft grid.
//
//   "Cross-check against the syllabus if both exist: a routine subject absent
//    from the syllabus is probably non-academic or a misread; a syllabus
//    subject absent from the routine means the parse dropped a cell. Surface
//    both as warnings on the review screen."
//
// Warnings, never errors. Every one of these has a legitimate shape — a subject
// really can be dropped for a term, a cell really can say something the
// catalogue has never heard of — so nothing here blocks a save. The screen
// shows them; the human decides.
//
// It runs against the draft grid rather than committed rows, so the same
// warnings appear while typing and, from Phase 5, over whatever the parse
// produced.

import type { RoutineGrid } from "./grid";
import { DAY_SHORT, type DayOfWeek } from "./grid";
import { groupTeacherNames, isBreakColumn, isNonAcademicText } from "./resolve";

export type Warning = {
  kind: "unresolved_cell" | "subject_missing" | "teacher_variants" | "break_column";
  message: string;
  /** Where to scroll on tap, when the warning is about one cell. */
  cell?: { day: DayOfWeek; columnIndex: number };
};

export type CrosscheckSubject = {
  id: string;
  display_name: string;
};

export function crosscheckRoutine(
  grid: RoutineGrid,
  subjects: CrosscheckSubject[],
): Warning[] {
  const warnings: Warning[] = [];

  // ---------------------------------------------------------------- cells ---
  // An academic cell with text but no subject. §5.1 says this renders as a
  // dropdown; the warning is what makes it findable in a forty-cell grid.
  grid.cells.forEach((row, day) => {
    row.forEach((cell, columnIndex) => {
      const raw = cell.raw_text.trim();
      if (!raw || !cell.is_academic || cell.student_subject_id) return;
      if (isNonAcademicText(raw)) return;

      warnings.push({
        kind: "unresolved_cell",
        message: `${DAY_SHORT[day as DayOfWeek]} period ${cell.period_no}: "${raw}" isn't matched to a subject yet.`,
        cell: { day: day as DayOfWeek, columnIndex },
      });
    });
  });

  // -------------------------------------------------------------- columns ---
  // §5.1 rule 1. A column that reads as a break but is still marked academic is
  // the single most likely thing to be wrong about a freshly typed grid, and
  // left alone it would put a phantom lesson into §7.3's predictions.
  grid.columns.forEach((column, columnIndex) => {
    const texts = grid.cells.map((row) => row[columnIndex]?.raw_text ?? "");
    const marked = grid.cells.every(
      (row) => !row[columnIndex] || !row[columnIndex].is_academic,
    );
    if (marked) return;

    if (isBreakColumn(texts)) {
      warnings.push({
        kind: "break_column",
        message: `Period ${column.period_no} looks like a break. Mark the column as a break so it isn't counted as a lesson.`,
      });
    }
  });

  // ------------------------------------------------------------- subjects ---
  // The other direction: a subject on the tree that never meets. §7.3 cannot
  // predict a CWM date for it, so its chapters would sit at 100% and never
  // produce an alert — a silent failure this warning turns into a visible one.
  const scheduled = new Set(
    grid.cells
      .flat()
      .filter((c) => c.is_academic && c.student_subject_id)
      .map((c) => c.student_subject_id),
  );

  for (const subject of subjects) {
    if (scheduled.has(subject.id)) continue;
    warnings.push({
      kind: "subject_missing",
      message: `${subject.display_name} is in your subjects but has no period in the routine.`,
    });
  }

  // -------------------------------------------------------------- teachers ---
  // §5.1 rule 4 — flagged for review, never merged silently.
  const teachers = grid.cells
    .flat()
    .filter((c) => c.is_academic)
    .map((c) => c.teacher_raw);

  for (const group of groupTeacherNames(teachers)) {
    warnings.push({
      kind: "teacher_variants",
      message: `${group.variants.join(" and ")} look like the same teacher. Use one spelling if they are.`,
    });
  }

  return warnings;
}
