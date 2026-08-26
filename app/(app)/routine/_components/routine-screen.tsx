"use client";

import { AlertTriangle, Clock, Pencil } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BellSchedule } from "./bell-schedule";
import { PeriodCell } from "./period-cell";
import { RoutinePhoto } from "./routine-photo";
import { commitRoutineGrid, updateRoutinePeriod } from "@/lib/routines/actions";
import { crosscheckRoutine } from "@/lib/routines/crosscheck";
import {
  addColumn,
  DAY_LABELS,
  DAY_SHORT,
  DAYS,
  gridToCommitPayload,
  removeColumn,
  setCell,
  setColumnTime,
  type DayOfWeek,
  type RoutineGrid,
} from "@/lib/routines/grid";
import { formatTime } from "@/lib/routines/schedule";
import type { SubjectCandidate } from "@/lib/routines/resolve";

// The routine editor, in two modes.
//
//   draft — the whole grid is local until "Save routine". This is setup, and it
//           is the shape §5.1's parse review needs: Phase 5 fills the same
//           state from Gemini and the human confirms it. Nothing else changes.
//   live  — a committed routine, edited a cell at a time. Correcting one cell
//           should not re-send forty, and should not be a chance to clobber
//           an edit made on another device between load and save.
//
// Guardians get this screen with `editable` false — the identical shell with
// every control removed, per the design system's guardian rule.

type Mode = "live" | "draft";

export function RoutineScreen({
  studentId,
  sessionLabel,
  editable,
  routineId,
  initialGrid,
  initialImagePath,
  signedUrl,
  subjects,
  hasCommittedRoutine,
}: {
  studentId: string;
  sessionLabel: string;
  editable: boolean;
  routineId: string;
  initialGrid: RoutineGrid;
  initialImagePath: string | null;
  signedUrl: string | null;
  subjects: SubjectCandidate[];
  hasCommittedRoutine: boolean;
}) {
  const [grid, setGrid] = useState(initialGrid);
  const [mode, setMode] = useState<Mode>(hasCommittedRoutine ? "live" : "draft");
  const [imagePath, setImagePath] = useState(initialImagePath);
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(DAYS[0]);
  const [bellOpen, setBellOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const warnings = useMemo(
    () => crosscheckRoutine(grid, subjects.map((s) => ({ id: s.id, display_name: s.display_name }))),
    [grid, subjects],
  );

  function commitAll(next: RoutineGrid = grid, path = imagePath) {
    setError(null);
    startTransition(async () => {
      const result = await commitRoutineGrid(
        studentId,
        gridToCommitPayload(next, routineId, path),
        sessionLabel,
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      setMode("live");
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    });
  }

  function updateCell(day: DayOfWeek, columnIndex: number, patch: Parameters<typeof setCell>[3]) {
    setGrid((current) => setCell(current, day, columnIndex, patch));
  }

  /**
   * Live mode's write. A cell that already has a row takes the single-cell RPC;
   * one that never existed — a blank the student is filling in now — has no id
   * to patch, so it falls back to the whole-grid commit. That commit is
   * idempotent, so the fallback is always safe rather than a special case to
   * get right.
   */
  function commitCell(day: DayOfWeek, columnIndex: number) {
    if (mode !== "live") return;

    const cell = grid.cells[day]?.[columnIndex];
    if (!cell) return;

    if (!cell.id) {
      if (cell.raw_text.trim()) commitAll();
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await updateRoutinePeriod(cell.id!, {
        raw_text: cell.raw_text.trim() || null,
        teacher_raw: cell.teacher_raw.trim() || null,
        student_subject_id: cell.student_subject_id,
        is_academic: cell.is_academic,
      });
      if (result.error) setError(result.error);
      else {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2000);
      }
    });
  }

  const status = pending
    ? "Saving…"
    : saved
      ? "Saved"
      : mode === "draft"
        ? "Not saved yet"
        : null;

  return (
    <div className="flex flex-col gap-4 pb-24">
      {/* ------------------------------------------------------------ head --- */}
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-xl font-semibold text-ink">Routine</h1>
            <p className="text-xs text-muted">
              {sessionLabel}
              {status ? ` · ${status}` : ""}
            </p>
          </div>

          {editable ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setBellOpen(true)}
                disabled={mode === "live"}
                title={
                  mode === "live"
                    ? "Choose Edit routine first to change the period times"
                    : undefined
                }
              >
                <Clock className="h-4 w-4" strokeWidth={1.5} />
                Period times
              </Button>

              {mode === "live" ? (
                <Button type="button" variant="secondary" onClick={() => setMode("draft")}>
                  <Pencil className="h-4 w-4" strokeWidth={1.5} />
                  Edit routine
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <RoutinePhoto
          studentId={studentId}
          routineId={routineId}
          signedUrl={signedUrl}
          editable={editable}
          onUploaded={(path) => {
            setImagePath(path);
            // Recording the photo means committing the grid with it — routines
            // is student-only at the table level, so a direct update would
            // write nothing at all for a tutor.
            commitAll(grid, path);
          }}
        />

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </Card>

      {/* -------------------------------------------------------- warnings --- */}
      {editable && warnings.length > 0 ? (
        <Card className="flex flex-col gap-2 bg-tint-sage">
          <p className="flex items-center gap-2 text-sm font-semibold text-tint-ink">
            <AlertTriangle className="h-4 w-4" strokeWidth={1.5} />
            Worth a look
          </p>
          <ul className="flex flex-col gap-1">
            {warnings.map((warning, i) => (
              <li key={i} className="text-xs text-tint-ink/80">
                {warning.message}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ------------------------------------------------- mobile day list --- */}
      <div className="lg:hidden">
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {DAYS.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => setSelectedDay(day)}
              aria-pressed={selectedDay === day}
              className={`shrink-0 rounded-pill px-4 py-2 text-sm font-medium transition-colors ${
                selectedDay === day
                  ? "bg-ink text-shell"
                  : "border border-hairline bg-surface text-muted hover:text-ink"
              }`}
            >
              {DAY_SHORT[day]}
            </button>
          ))}
        </div>

        <ul className="flex flex-col gap-3">
          {grid.columns.map((column, columnIndex) => {
            const cell = grid.cells[selectedDay][columnIndex];
            return (
              <li key={column.period_no} className="flex gap-3">
                <div className="w-14 shrink-0 pt-1">
                  <p className="text-xs font-medium text-ink">P{column.period_no}</p>
                  <p className="text-xs text-muted">{formatTime(column.start_time)}</p>
                </div>

                <div
                  className={`flex-1 rounded-tint p-3 ${
                    cell.is_academic ? "bg-tint-mint" : "bg-surface-sunk"
                  }`}
                >
                  <PeriodCell
                    cell={cell}
                    subjects={subjects}
                    editable={editable}
                    layout="row"
                    onChange={(patch) => updateCell(selectedDay, columnIndex, patch)}
                    onCommit={() => commitCell(selectedDay, columnIndex)}
                  />
                </div>
              </li>
            );
          })}
        </ul>

        {grid.columns.length === 0 ? (
          <EmptyPeriods editable={editable} onAdd={() => setGrid(addColumn(grid))} />
        ) : null}
      </div>

      {/* ---------------------------------------------------- desktop week --- */}
      {/* Periods are rows and days are columns — five columns fit the shell,
          eight would not, and this is the orientation the printed routine uses
          anyway. */}
      <div className="hidden lg:block">
        <Card className="p-0">
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr>
                <th className="w-20 border-b border-hairline px-3 py-2 text-left text-xs font-medium text-muted">
                  Period
                </th>
                {DAYS.map((day) => (
                  <th
                    key={day}
                    className="border-b border-hairline px-2 py-2 text-left text-xs font-medium text-muted"
                  >
                    {DAY_LABELS[day]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.columns.map((column, columnIndex) => (
                <tr key={column.period_no} className="align-top">
                  <th
                    scope="row"
                    className="border-b border-hairline px-3 py-2 text-left"
                  >
                    <span className="block text-sm font-medium text-ink">
                      {column.period_no}
                    </span>
                    <span className="block text-xs font-normal text-muted">
                      {formatTime(column.start_time)}
                    </span>
                  </th>

                  {DAYS.map((day) => (
                    <td key={day} className="border-b border-hairline px-2 py-2">
                      <PeriodCell
                        cell={grid.cells[day][columnIndex]}
                        subjects={subjects}
                        editable={editable}
                        layout="cell"
                        onChange={(patch) => updateCell(day, columnIndex, patch)}
                        onCommit={() => commitCell(day, columnIndex)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {grid.columns.length === 0 ? (
            <EmptyPeriods editable={editable} onAdd={() => setGrid(addColumn(grid))} />
          ) : null}
        </Card>
      </div>

      {/* ------------------------------------------------------- save bar --- */}
      {editable && mode === "draft" ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-surface/95 px-4 py-3 backdrop-blur [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            {hasCommittedRoutine ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setGrid(initialGrid);
                  setMode("live");
                }}
                disabled={pending}
              >
                Cancel
              </Button>
            ) : null}
            <Button
              type="button"
              onClick={() => commitAll()}
              disabled={pending}
              className="flex-1"
            >
              {pending ? "Saving…" : "Save routine"}
            </Button>
          </div>
        </div>
      ) : null}

      <BellSchedule
        open={bellOpen}
        columns={grid.columns}
        onClose={() => setBellOpen(false)}
        onChangeTime={(index, patch) =>
          setGrid((current) => setColumnTime(current, index, patch))
        }
        onAdd={() => setGrid((current) => addColumn(current))}
        onRemove={(index) => setGrid((current) => removeColumn(current, index))}
      />
    </div>
  );
}

function EmptyPeriods({
  editable,
  onAdd,
}: {
  editable: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3 p-5">
      <p className="text-sm text-muted">
        {editable
          ? "No periods yet. Add one to start building the week."
          : "No routine has been added yet."}
      </p>
      {editable ? (
        <Button type="button" variant="secondary" onClick={onAdd}>
          Add a period
        </Button>
      ) : null}
    </div>
  );
}
