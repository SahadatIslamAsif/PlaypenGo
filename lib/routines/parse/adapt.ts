// The only place RawRoutineParse's wire shape (schema.ts, snake_case, §5.1's
// JSON exactly) gets translated into the RoutineGrid the editor already
// works in (lib/routines/grid.ts) - the same draft shape a student fills in
// by hand. RoutineScreen's own header comment names this exactly: "draft...
// is the shape §5.1's parse review needs: Phase 5 fills the same state from
// Gemini and the human confirms it. Nothing else changes." This function is
// that fill.
//
// Subject resolution runs through resolveSubject() - the same function a
// typed cell's onChange already calls - not through the model's own
// matched_subject first. That is deliberate, not an oversight: resolve.ts's
// header explains why resolution lives in exactly one place ("A human typing
// 'Phy' and Gemini reading 'Phy' off a photograph must resolve to the same
// subject"), and lib/scans/parse/adapt.ts already takes the identical
// posture toward its own header_subject_raw. matched_subject is used only as
// a fallback when raw-text resolution finds nothing - the model's visual
// read catching a misspelling or an unfamiliar short form a plain string
// match couldn't.

import { blankCell, DAYS, type Cell, type DayOfWeek, type PeriodColumn, type RoutineGrid } from "../grid";
import { resolveSubject, type SubjectCandidate } from "../resolve";
import type { RawRoutineParse, RawRoutinePeriod } from "./schema";

const DAY_INDEX: Record<RawRoutinePeriod["day"], DayOfWeek> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
};

/** Postgres-shaped "08:15:00" or a model's "8:15" both collapse to "08:15" -
 *  grid.ts's own trimSeconds handles the DB side; this is the parse side. */
function normaliseTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

/**
 * §5.1's raw parse -> a draft RoutineGrid. Every cell's `id` is null - "Null
 * until the cell has been committed" (grid.ts) - since nothing here has
 * touched the database. The student reviews and corrects this exact grid;
 * "Save routine" is what commits it, same as a hand-typed one.
 */
export function adaptRoutineParse(
  raw: RawRoutineParse,
  candidates: SubjectCandidate[],
): RoutineGrid {
  const periodNos = [...new Set(raw.periods.map((p) => p.period_no))].sort((a, b) => a - b);

  // Times live on the column, not the cell (grid.ts's own header comment) -
  // the first period entry that carries a time stamps the whole column, same
  // as buildRoutineGrid() does for committed rows.
  const columns: PeriodColumn[] = periodNos.map((periodNo) => {
    const timed = raw.periods.find((p) => p.period_no === periodNo && (p.start || p.end));
    return {
      period_no: periodNo,
      start_time: normaliseTime(timed?.start),
      end_time: normaliseTime(timed?.end),
    };
  });

  const byKey = new Map(raw.periods.map((p) => [`${DAY_INDEX[p.day]}:${p.period_no}`, p]));

  const cells = DAYS.map((day) =>
    columns.map((column) => {
      const period = byKey.get(`${day}:${column.period_no}`);
      // A cell the model never reported (a genuinely missing entry, not a
      // blank one - those still get a periods[] row per the prompt) renders
      // the same blank the editor already shows for an untyped cell.
      if (!period) return blankCell(day, column.period_no);
      return adaptCell(day, column.period_no, period, candidates);
    }),
  );

  return { columns, cells };
}

function adaptCell(
  day: DayOfWeek,
  periodNo: number,
  period: RawRoutinePeriod,
  candidates: SubjectCandidate[],
): Cell {
  const rawText = period.raw_text ?? "";
  const primary = resolveSubject(rawText, candidates);

  // The model's matched_subject only gets a turn when raw-text resolution
  // came up with neither a subject nor a non-academic read - it never
  // overrides a resolution resolve.ts already made confidently.
  const fallback =
    !primary.subjectId && !primary.isNonAcademic && period.matched_subject
      ? resolveSubject(period.matched_subject, candidates)
      : null;

  // Either signal is enough: resolve.ts's own word list (rule 2's named
  // periods), or the model's is_academic read (rule 1's vertical break
  // column, which only a look at all five day-cells of one column can
  // actually catch - resolveSubject() has no way to see that from one cell).
  const isNonAcademic = primary.isNonAcademic || !period.is_academic;

  return {
    id: null,
    day_of_week: day,
    period_no: periodNo,
    raw_text: rawText,
    // A non-academic cell carries neither a teacher nor a subject - the same
    // pair grid.ts's fillColumn() clears when a column is marked a break by
    // hand, kept consistent here so a parsed break and a hand-marked one
    // look identical to the rest of the app.
    teacher_raw: isNonAcademic ? "" : (period.teacher ?? ""),
    student_subject_id: isNonAcademic ? null : (primary.subjectId ?? fallback?.subjectId ?? null),
    is_academic: !isNonAcademic,
  };
}
