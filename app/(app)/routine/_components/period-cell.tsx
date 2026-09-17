"use client";

import { Trash2 } from "lucide-react";
import { useMemo } from "react";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import type { Cell } from "@/lib/routines/grid";
import { resolveSubject, type SubjectCandidate } from "@/lib/routines/resolve";

// One cell of the routine. The same component in both layouts: a row in the
// mobile day list, a table cell in the desktop week. §5.1's post-parse rule is
// what it implements — text that resolves shows the subject it matched, text
// that doesn't gets the picker — and it behaves identically whether a person
// typed the text or, from Phase 5, a parse filled it in.
//
// No per-cell "matched" chip and no manual break toggle: a resolved subject
// already reads correctly in the box itself, a wrong reading is fixed by
// retyping, and an unmatched cell is already surfaced centrally in the
// routine screen's "Worth a look" warnings (crosscheck.ts) rather than
// repeated on every cell. A break is set by is_academic — from the parse's
// own read (prompt.ts rule 1) or by typing "Break" (resolveSubject's
// isNonAcademic) — never by a dedicated button.

export function PeriodCell({
  cell,
  subjects,
  editable,
  layout,
  onChange,
  onCommit,
}: {
  cell: Cell;
  subjects: SubjectCandidate[];
  editable: boolean;
  layout: "row" | "cell";
  onChange: (patch: Partial<Cell>) => void;
  /** Fired on blur — the live-mode write. Draft mode leaves it undefined. */
  onCommit?: () => void;
}) {
  const items: ComboboxItem[] = useMemo(
    () =>
      subjects.map((s) => ({
        id: s.id,
        label: s.display_name,
        keywords: s.aliases,
      })),
    [subjects],
  );

  const matched = subjects.find((s) => s.id === cell.student_subject_id);
  const raw = cell.raw_text.trim();
  const hasContent = raw.length > 0 || cell.teacher_raw.trim().length > 0;

  // Clearing back to the same shape blankCell() produces, so a cleared cell
  // reads as an untyped one everywhere else in the app - the warnings, the
  // unresolved count, and gridToCommitPayload's own "no label and no subject
  // is a hole in the timetable, drop the row" rule (grid.ts). That last part
  // is what actually removes a wrongly-populated period on the next save,
  // not anything this function does directly.
  function handleClear() {
    onChange({ raw_text: "", teacher_raw: "", student_subject_id: null, is_academic: true });
    onCommit?.();
  }

  // Re-resolve as the text changes so a known short form binds itself without
  // the user opening the picker at all. This is the payoff of every alias the
  // routine has captured before now.
  function handleText(text: string) {
    const resolution = resolveSubject(text, subjects);
    onChange({
      raw_text: text,
      student_subject_id: resolution.subjectId,
      is_academic: resolution.isNonAcademic ? false : cell.is_academic,
    });
  }

  if (!editable) {
    return (
      <ReadOnlyCell cell={cell} label={matched?.display_name ?? null} layout={layout} />
    );
  }

  return (
    <div
      className={`flex min-w-0 flex-col ${layout === "row" ? "gap-2" : "gap-1.5"}`}
    >
      <Combobox
        value={cell.raw_text}
        items={items}
        onChange={handleText}
        onSelect={(item) =>
          onChange({
            // Keep what the picker matched as the cell text only when the cell
            // was blank. §5.1 keeps raw_text as the routine wrote it, and that
            // string is what the next parse's alias lookup is compared against.
            raw_text: cell.raw_text.trim() || item.label,
            student_subject_id: item.id,
            is_academic: true,
          })
        }
        onBlur={onCommit}
        placeholder={layout === "row" ? "Subject" : "—"}
        minChars={1}
        aria-label={`Period ${cell.period_no} subject`}
        inputClassName={layout === "cell" ? "h-9 px-2 text-[13px]" : ""}
      />

      {cell.is_academic ? (
        <Input
          value={cell.teacher_raw}
          onChange={(e) => onChange({ teacher_raw: e.target.value })}
          onBlur={onCommit}
          placeholder="Teacher"
          aria-label={`Period ${cell.period_no} teacher`}
          className={layout === "cell" ? "h-8 px-2 text-xs" : "h-10"}
        />
      ) : null}

      {hasContent ? (
        <button
          type="button"
          onClick={handleClear}
          aria-label={`Clear period ${cell.period_no}`}
          title="Clear this period"
          className="flex h-7 w-7 shrink-0 items-center justify-center self-end rounded-button text-muted transition-colors hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      ) : null}
    </div>
  );
}

function ReadOnlyCell({
  cell,
  label,
  layout,
}: {
  cell: Cell;
  label: string | null;
  layout: "row" | "cell";
}) {
  const text = cell.raw_text.trim();

  if (!text) {
    return <p className="text-sm text-muted">—</p>;
  }

  return (
    <div className={layout === "row" ? "flex flex-col gap-0.5" : ""}>
      <p
        className={`font-medium ${cell.is_academic ? "text-ink" : "text-muted"} ${
          layout === "cell" ? "text-[13px]" : "text-sm"
        }`}
      >
        {label ?? text}
      </p>
      {cell.teacher_raw ? (
        <p className="text-xs text-muted">{cell.teacher_raw}</p>
      ) : null}
    </div>
  );
}
