"use client";

import { Ban, Check } from "lucide-react";
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
  const unresolved = raw.length > 0 && cell.is_academic && !cell.student_subject_id;

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
    <div className={layout === "row" ? "flex flex-col gap-2" : "flex flex-col gap-1.5"}>
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

      <div className="flex items-center justify-between gap-2">
        {matched ? (
          <span className="inline-flex items-center gap-1 text-xs text-accent">
            <Check className="h-3.5 w-3.5" strokeWidth={2} />
            {matched.display_name}
          </span>
        ) : unresolved ? (
          <span className="text-xs text-muted">Not matched yet</span>
        ) : (
          <span />
        )}

        <button
          type="button"
          onClick={() => {
            onChange({
              is_academic: !cell.is_academic,
              student_subject_id: cell.is_academic ? null : cell.student_subject_id,
              teacher_raw: cell.is_academic ? "" : cell.teacher_raw,
            });
            onCommit?.();
          }}
          aria-pressed={!cell.is_academic}
          title={cell.is_academic ? "Mark as a break" : "Mark as a lesson"}
          className={`inline-flex items-center gap-1 rounded-pill px-2 py-1 text-xs transition-colors ${
            cell.is_academic
              ? "text-muted hover:text-ink"
              : "bg-surface-sunk font-medium text-ink"
          }`}
        >
          <Ban className="h-3.5 w-3.5" strokeWidth={1.5} />
          Break
        </button>
      </div>
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
