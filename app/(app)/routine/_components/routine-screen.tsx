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
import { adaptRoutineParse } from "@/lib/routines/parse/adapt";
import type { RawRoutineParse } from "@/lib/routines/parse/schema";
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
  const [parsing, setParsing] = useState(false);
  const [pending, startTransition] = useTransition();

  const warnings = useMemo(
    () => crosscheckRoutine(grid, subjects.map((s) => ({ id: s.id, display_name: s.display_name }))),
    [grid, subjects],
  );

  // An academic cell saved with no subject attached isn't a cosmetic issue
  // the way the other warning kinds are - it silently drops that weekday
  // from every subject-keyed read of the routine (nextClassDay(), §7.3's CWM
  // windows, "Coming up"), which is a wrong alert date, not a missing one.
  // The other three warning kinds stay advisory (crosscheck.ts's own header:
  // "nothing here blocks a save") because each has a legitimate shape - a
  // subject really can sit out a term, a break column really can get typed
  // out instead of drawn vertically.
  const unresolvedCount = warnings.filter((w) => w.kind === "unresolved_cell").length;

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

  /**
   * §5.1's step-2 parse, triggered right after a photo lands in the routines
   * bucket, whether this is the first photo or a replacement of an
   * already-committed routine's. The caller has already switched to draft
   * mode - "draft... is the shape §5.1's parse review needs" (this file's own
   * header comment) - so the result is always reviewed before Save routine
   * writes anything. A failed parse leaves the draft grid and photo exactly
   * as they were - nothing here is destructive on error - and the committed
   * routine underneath is untouched until the review is actually saved.
   */
  function parseAndFillGrid(path: string) {
    setError(null);
    setParsing(true);
    void (async () => {
      try {
        const response = await fetch("/api/routines/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imagePath: path,
            subjectNames: subjects.map((s) => s.display_name),
          }),
        });
        const body = (await response.json()) as { raw?: RawRoutineParse; error?: string };
        if (!response.ok || !body.raw) {
          setError(body.error ?? "The routine photo couldn't be read.");
          return;
        }
        setGrid(adaptRoutineParse(body.raw, subjects));
      } catch {
        setError("The routine photo couldn't be read. Check your connection and try again.");
      } finally {
        setParsing(false);
      }
    })();
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

  const status = parsing
    ? "Reading your routine…"
    : pending
      ? "Saving…"
      : saved
        ? "Saved"
        : mode === "draft"
          ? "Not saved yet"
          : null;

  return (
    <div className="flex flex-col gap-4 pb-nav-clear lg:pb-0">
      {/* ------------------------------------------------------------ head --- */}
      {/* Sticky: Save routine / Cancel live here, not after the grid, so
          they're still on screen after scrolling past a change made near the
          top of a long table — no scrolling to the bottom to save a top-row
          edit. */}
      <Card className="sticky top-0 z-20 flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-xl font-semibold text-ink">Routine</h1>
            <p className="text-xs text-muted">
              {sessionLabel}
              {status ? ` · ${status}` : ""}
            </p>
          </div>

          {editable ? (
            <div className="flex flex-wrap items-center gap-2">
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
              ) : (
                <>
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
                    disabled={pending || parsing || unresolvedCount > 0}
                    title={
                      parsing
                        ? "Wait for the photo to finish reading"
                        : unresolvedCount > 0
                          ? "Resolve every unmatched period before saving"
                          : undefined
                    }
                  >
                    {pending ? "Saving…" : "Save routine"}
                  </Button>
                </>
              )}
            </div>
          ) : null}
        </div>

        {mode === "draft" && unresolvedCount > 0 ? (
          <p className="text-xs text-danger">
            {unresolvedCount === 1
              ? "One period isn't matched to a subject yet. Pick one, or type \"Break\" if it's a break period, before saving."
              : `${unresolvedCount} periods aren't matched to a subject yet. Pick one for each, or type "Break" for a break period, before saving.`}
          </p>
        ) : null}

        <RoutinePhoto
          studentId={studentId}
          routineId={routineId}
          signedUrl={signedUrl}
          editable={editable}
          onUploaded={(path) => {
            setImagePath(path);
            // Always re-read the new photo, even over an already-committed
            // routine. It used to skip straight to commitAll(grid, path) in
            // live mode, treating a photo replacement as a bare admin action
            // that couldn't itself carry new information — but a re-uploaded
            // photo is exactly the case where the printed routine actually
            // changed and the parse most needs to run. That path silently
            // re-saved the *old* grid under the *new* photo and never called
            // Gemini, so the grid stopped matching the picture beside it.
            // Parsing here and dropping into draft mode (§5.1's review step)
            // means every upload gets read and reviewed the same way,
            // whether it's the first photo or the fifth.
            setMode("draft");
            parseAndFillGrid(path);
          }}
        />

        {error ? <p className="text-sm text-danger">{error}</p> : null}
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

                {/* The design system's timeline shape: time gutter, tinted
                    card, 3px accent bar down the left edge. The card is
                    `--surface` rather than a tint fill because tints stay pale
                    in both themes by design, and this one holds inputs, which
                    are surface-coloured and do invert — a pale card full of
                    dark inputs is neither theme. */}
                <div
                  className={`relative flex-1 overflow-hidden rounded-tint border border-hairline p-3 pl-4 ${
                    cell.is_academic ? "bg-surface" : "bg-surface-sunk"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute inset-y-0 left-0 w-[3px] rounded-full ${
                      cell.is_academic ? "bg-accent" : "bg-hairline"
                    }`}
                  />
                  <PeriodCell
                    cell={cell}
                    subjects={subjects}
                    editable={editable && mode === "draft"}
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
                    <td
                      key={day}
                      className="overflow-hidden border-b border-hairline px-2 py-2"
                    >
                      <PeriodCell
                        cell={grid.cells[day][columnIndex]}
                        subjects={subjects}
                        editable={editable && mode === "draft"}
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
