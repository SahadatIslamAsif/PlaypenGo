// Flat routine_periods rows <-> the day x period grid the editor works in.
// The pure analogue of lib/subjects/tree.ts, and the same reason for existing:
// the database stores one row per cell, the screen thinks in columns.
//
// Times live on the column, not the cell. A Playpen routine is a bell schedule
// — period 3 starts at 09:40 whatever day it is — so the editor asks for the
// schedule once and stamps it onto all five rows on the way out. The rows still
// carry their own start/end, which keeps a one-off day variation representable
// even though nothing in the UI produces one yet.

// §5.1 rule 6. Friday and Saturday are the weekend and never appear on a
// routine. This is NOT the calendar §7.3 sends alerts on — that one deliberately
// includes the weekend, because those are the evenings the student is free.
export const DAYS = [0, 1, 2, 3, 4] as const;
export type DayOfWeek = (typeof DAYS)[number];

export const DAY_LABELS: Record<DayOfWeek, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
};

export const DAY_SHORT: Record<DayOfWeek, string> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
};

export type RoutinePeriodRow = {
  id: string;
  day_of_week: number;
  period_no: number;
  start_time: string | null;
  end_time: string | null;
  raw_text: string | null;
  teacher_raw: string | null;
  student_subject_id: string | null;
  is_academic: boolean;
};

export type RoutineRow = {
  id: string;
  session_label: string;
  image_path: string | null;
  is_active: boolean;
};

export type PeriodColumn = {
  period_no: number;
  start_time: string | null;
  end_time: string | null;
};

export type Cell = {
  /** Null until the cell has been committed — a draft cell has no row yet. */
  id: string | null;
  day_of_week: DayOfWeek;
  period_no: number;
  raw_text: string;
  teacher_raw: string;
  student_subject_id: string | null;
  is_academic: boolean;
};

export type RoutineGrid = {
  columns: PeriodColumn[];
  /** cells[day][columnIndex] — always fully populated, blanks included. */
  cells: Cell[][];
};

/** The default Playpen day: eight periods with a break after the third. */
export const DEFAULT_COLUMNS: PeriodColumn[] = [
  { period_no: 1, start_time: "08:15", end_time: "08:55" },
  { period_no: 2, start_time: "08:55", end_time: "09:35" },
  { period_no: 3, start_time: "09:35", end_time: "10:15" },
  { period_no: 4, start_time: "10:15", end_time: "10:55" },
  { period_no: 5, start_time: "10:55", end_time: "11:25" },
  { period_no: 6, start_time: "11:25", end_time: "12:05" },
  { period_no: 7, start_time: "12:05", end_time: "12:45" },
  { period_no: 8, start_time: "12:45", end_time: "13:25" },
];

function blankCell(day: DayOfWeek, periodNo: number): Cell {
  return {
    id: null,
    day_of_week: day,
    period_no: periodNo,
    raw_text: "",
    teacher_raw: "",
    student_subject_id: null,
    is_academic: true,
  };
}

export function emptyRoutineGrid(
  columns: PeriodColumn[] = DEFAULT_COLUMNS,
): RoutineGrid {
  return {
    columns: columns.map((c) => ({ ...c })),
    cells: DAYS.map((day) => columns.map((c) => blankCell(day, c.period_no))),
  };
}

/**
 * Rows -> grid. The column set is the union of every period_no present, so a
 * routine whose Thursday is short still renders a full rectangle with blanks
 * rather than a ragged one the editor would have to special-case.
 *
 * Column times are taken from the first row that carries them, since the whole
 * week shares one bell schedule.
 */
export function buildRoutineGrid(rows: RoutinePeriodRow[]): RoutineGrid {
  if (rows.length === 0) return emptyRoutineGrid();

  const periodNos = [...new Set(rows.map((r) => r.period_no))].sort(
    (a, b) => a - b,
  );

  const columns: PeriodColumn[] = periodNos.map((periodNo) => {
    const timed = rows.find(
      (r) => r.period_no === periodNo && (r.start_time || r.end_time),
    );
    return {
      period_no: periodNo,
      start_time: trimSeconds(timed?.start_time ?? null),
      end_time: trimSeconds(timed?.end_time ?? null),
    };
  });

  const byKey = new Map(rows.map((r) => [`${r.day_of_week}:${r.period_no}`, r]));

  const cells = DAYS.map((day) =>
    columns.map((column) => {
      const row = byKey.get(`${day}:${column.period_no}`);
      if (!row) return blankCell(day, column.period_no);
      return {
        id: row.id,
        day_of_week: day,
        period_no: column.period_no,
        raw_text: row.raw_text ?? "",
        teacher_raw: row.teacher_raw ?? "",
        student_subject_id: row.student_subject_id,
        is_academic: row.is_academic,
      };
    }),
  );

  return { columns, cells };
}

/**
 * Grid -> the payload commit_routine_grid() expects.
 *
 * Empty cells are dropped rather than sent as blanks. The RPC treats the
 * payload as authoritative and deletes anything missing from it, so an untouched
 * cell that was never filled in simply never becomes a row.
 */
export function gridToCommitPayload(
  grid: RoutineGrid,
  routineId: string,
  imagePath: string | null,
) {
  const times = new Map(grid.columns.map((c) => [c.period_no, c]));

  const periods = grid.cells.flat().flatMap((cell) => {
    const raw = cell.raw_text.trim();
    // A cell with neither a label nor a subject is a hole in the timetable.
    if (!raw && !cell.student_subject_id) return [];

    const column = times.get(cell.period_no);
    return [
      {
        day_of_week: cell.day_of_week,
        period_no: cell.period_no,
        start_time: column?.start_time ?? null,
        end_time: column?.end_time ?? null,
        raw_text: raw,
        teacher_raw: cell.teacher_raw.trim() || null,
        student_subject_id: cell.student_subject_id,
        is_academic: cell.is_academic,
      },
    ];
  });

  return { routine_id: routineId, image_path: imagePath, periods };
}

/** Postgres hands back `08:15:00`; the editor's time input wants `08:15`. */
function trimSeconds(time: string | null): string | null {
  if (!time) return null;
  const match = /^(\d{2}:\d{2})/.exec(time);
  return match ? match[1] : time;
}

export function setCell(
  grid: RoutineGrid,
  day: DayOfWeek,
  columnIndex: number,
  patch: Partial<Cell>,
): RoutineGrid {
  return {
    columns: grid.columns,
    cells: grid.cells.map((row, d) =>
      d !== day
        ? row
        : row.map((cell, c) => (c === columnIndex ? { ...cell, ...patch } : cell)),
    ),
  };
}

/**
 * Mark a whole column non-academic and label it — the BREAK column of §5.1
 * rule 1, or Games / E.C.A. / Assembly / Library from rule 2. One tap rather
 * than five, because these always run right across the week.
 */
export function fillColumn(
  grid: RoutineGrid,
  columnIndex: number,
  label: string,
): RoutineGrid {
  return {
    columns: grid.columns,
    cells: grid.cells.map((row) =>
      row.map((cell, c) =>
        c === columnIndex
          ? {
              ...cell,
              raw_text: label,
              teacher_raw: "",
              student_subject_id: null,
              is_academic: false,
            }
          : cell,
      ),
    ),
  };
}

export function addColumn(grid: RoutineGrid): RoutineGrid {
  const last = grid.columns[grid.columns.length - 1];
  const periodNo = last ? last.period_no + 1 : 1;
  return {
    columns: [
      ...grid.columns,
      { period_no: periodNo, start_time: null, end_time: null },
    ],
    cells: grid.cells.map((row, day) => [
      ...row,
      blankCell(DAYS[day], periodNo),
    ]),
  };
}

export function removeColumn(grid: RoutineGrid, columnIndex: number): RoutineGrid {
  return {
    columns: grid.columns.filter((_, c) => c !== columnIndex),
    cells: grid.cells.map((row) => row.filter((_, c) => c !== columnIndex)),
  };
}

export function setColumnTime(
  grid: RoutineGrid,
  columnIndex: number,
  patch: Partial<PeriodColumn>,
): RoutineGrid {
  return {
    columns: grid.columns.map((c, i) =>
      i === columnIndex ? { ...c, ...patch } : c,
    ),
    cells: grid.cells,
  };
}
