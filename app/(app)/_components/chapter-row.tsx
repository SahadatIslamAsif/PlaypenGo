"use client";

import { Trash2 } from "lucide-react";
import { useTransition } from "react";
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
}: {
  chapter: ChapterNode;
  editable: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function setStatus(status: ChapterStatus) {
    startTransition(() => {
      updateChapterStatus(chapter.id, status);
    });
  }

  if (!editable) {
    return (
      <div className="flex items-center justify-between py-2">
        <p className="text-sm text-body">{chapter.name}</p>
        <span className="text-xs text-muted">{READ_ONLY_LABEL[chapter.status]}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-body">{chapter.name}</p>
      <div className="flex items-center gap-2">
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
        <form action={deleteChapter}>
          <input type="hidden" name="chapter_id" value={chapter.id} />
          <button
            type="submit"
            aria-label="Delete chapter"
            className="flex h-9 w-9 items-center justify-center rounded-button text-muted transition-colors hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </form>
      </div>
    </div>
  );
}
