"use client";

import { CalendarClock, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { CTDateSheet } from "./ct-date-sheet";
import { deleteChapter, updateChapterStatus } from "@/lib/subjects/actions";
import type { ChapterNode, ChapterStatus } from "@/lib/subjects/tree";

const SEGMENTS: { value: ChapterStatus; label: string }[] = [
  { value: "not_started", label: "0%" },
  { value: "p80", label: "80%" },
  { value: "p100", label: "100%" },
];

const READ_ONLY_LABEL: Record<ChapterStatus, string> = {
  not_started: "Not started",
  p80: "80%",
  p100: "100%",
  not_taught: "Not taught",
};

export function ChapterRow({
  chapter,
  editable,
  studentId,
  studentSubjectId,
  today,
  ctDates,
}: {
  chapter: ChapterNode;
  editable: boolean;
  studentId: string;
  studentSubjectId: string;
  today: string;
  ctDates: Set<string>;
}) {
  const [pending, startTransition] = useTransition();
  const [ctOpen, setCtOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeCT = chapter.ct && chapter.ct.status !== "cancelled" ? chapter.ct : null;

  function setStatus(status: ChapterStatus) {
    startTransition(async () => {
      const result = await updateChapterStatus(chapter.id, status);
      setError(result.error);
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteChapter(chapter.id);
      setError(result.error);
    });
  }

  if (!editable) {
    return (
      <div className="flex items-center justify-between gap-2 py-2">
        <p className="text-sm text-body">{chapter.name}</p>
        <div className="flex items-center gap-2">
          {activeCT?.date ? (
            <span className="inline-flex items-center gap-1 rounded-pill bg-tint-sage px-2 py-1 text-xs text-tint-ink">
              <CalendarClock className="h-3 w-3" strokeWidth={1.5} />
              {formatCTDate(activeCT.date)}
            </span>
          ) : null}
          <span className="text-xs text-muted">{READ_ONLY_LABEL[chapter.status]}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 py-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-body">{chapter.name}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCtOpen(true)}
            className={`inline-flex h-9 items-center gap-1 rounded-pill px-2.5 text-xs font-medium transition-colors ${
              activeCT?.date
                ? "bg-tint-sage text-tint-ink"
                : "border border-hairline bg-surface text-muted hover:text-ink"
            }`}
          >
            <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.5} />
            {activeCT?.date ? formatCTDate(activeCT.date) : "CT date"}
          </button>
          <div className="flex overflow-hidden rounded-button border border-hairline">
            {SEGMENTS.map((seg) => (
              <button
                key={seg.value}
                type="button"
                disabled={pending}
                onClick={() => setStatus(seg.value)}
                className={`h-9 min-w-11 px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  chapter.status === seg.value
                    ? "bg-ink text-shell"
                    : "bg-surface text-body hover:bg-surface-sunk"
                }`}
              >
                {seg.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => setStatus(chapter.status === "not_taught" ? "not_started" : "not_taught")}
            className={`h-9 rounded-button border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              chapter.status === "not_taught"
                ? "border-accent bg-accent text-shell"
                : "border-hairline bg-surface text-muted hover:text-ink"
            }`}
          >
            Not taught
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={remove}
            aria-label="Delete chapter"
            className="flex h-9 w-9 items-center justify-center rounded-button text-muted transition-colors hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <CTDateSheet
          open={ctOpen}
          onClose={() => setCtOpen(false)}
          studentId={studentId}
          studentSubjectId={studentSubjectId}
          chapterId={chapter.id}
          chapterName={chapter.name}
          ct={activeCT}
          today={today}
          ctDates={ctDates}
        />
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

function formatCTDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
