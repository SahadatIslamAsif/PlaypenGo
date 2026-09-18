"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteChapter, renameChapter, updateChapterStatus } from "@/lib/subjects/actions";
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

// A two-track grid rather than flex: the name cell (`minmax(0,1fr)`) is free
// to wrap onto a second line for a long chapter name, and the control
// cluster - `sm:justify-self-end` - stays put in the same place on every row
// regardless, because it is constant width once nothing in it varies with
// content length. Applied to all four return branches below so rows stay
// aligned in every state.
const ROW_GRID = "grid grid-cols-1 gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3";
const CLUSTER = "flex shrink-0 items-center gap-2 sm:justify-self-end";

export function ChapterRow({
  chapter,
  editable,
}: {
  chapter: ChapterNode;
  editable: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(chapter.name);
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(chapter.status);

  function setStatus(status: ChapterStatus) {
    startTransition(async () => {
      setOptimisticStatus(status);
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

  function cancelRename() {
    setName(chapter.name);
    setRenaming(false);
  }

  function saveRename() {
    startTransition(async () => {
      const result = await renameChapter(chapter.id, name);
      setError(result.error);
      if (!result.error) setRenaming(false);
    });
  }

  if (!editable) {
    return (
      <div className={ROW_GRID}>
        <p className={`text-sm ${chapter.syllabus_removed_at ? "text-muted" : "text-body"}`}>
          {chapter.name}
        </p>
        <div className={CLUSTER}>
          <span className="text-xs text-muted">{READ_ONLY_LABEL[chapter.status]}</span>
        </div>
        {chapter.syllabus_removed_at ? (
          <p className="text-xs text-muted sm:col-span-2">No longer in the syllabus</p>
        ) : null}
      </div>
    );
  }

  if (renaming) {
    return (
      <div className={ROW_GRID}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className="h-9 min-w-0"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              saveRename();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              cancelRename();
            }
          }}
        />
        <div className={CLUSTER}>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={saveRename}
            className="h-9 shrink-0 px-3"
          >
            Save
          </Button>
          <button
            type="button"
            onClick={cancelRename}
            className="shrink-0 text-xs font-medium text-muted"
          >
            Cancel
          </button>
        </div>
        {error ? <p className="text-xs text-danger sm:col-span-2">{error}</p> : null}
      </div>
    );
  }

  // A re-import's parsed_name no longer covers this chapter (0029) — flagged,
  // not deleted. No progress taps: marking progress against a chapter the
  // syllabus dropped is exactly what this state exists to prevent. Rename
  // and delete stay — the human's call, made visible instead of made for them.
  if (chapter.syllabus_removed_at) {
    return (
      <div className={ROW_GRID}>
        <div>
          <p className="text-sm text-muted">{chapter.name}</p>
          <p className="text-xs text-muted">No longer in the syllabus</p>
        </div>
        <div className={CLUSTER}>
          <span className="text-xs text-muted">{READ_ONLY_LABEL[chapter.status]}</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => setRenaming(true)}
            aria-label="Rename chapter"
            className="flex h-9 w-9 items-center justify-center rounded-button text-muted transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
          >
            <Pencil className="h-4 w-4" strokeWidth={1.5} />
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
        {error ? <p className="text-xs text-danger sm:col-span-2">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className={ROW_GRID}>
      <p className="text-sm text-body">{chapter.name}</p>
      <div className={CLUSTER}>
        <div className="flex overflow-hidden rounded-button border border-hairline">
          {SEGMENTS.map((seg) => (
            <button
              key={seg.value}
              type="button"
              disabled={pending}
              onClick={() => setStatus(seg.value)}
              className={`h-9 min-w-11 px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                optimisticStatus === seg.value
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
          onClick={() => setStatus(optimisticStatus === "not_taught" ? "not_started" : "not_taught")}
          className={`h-9 rounded-button border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            optimisticStatus === "not_taught"
              ? "border-accent bg-accent text-shell"
              : "border-hairline bg-surface text-muted hover:text-ink"
          }`}
        >
          Not taught
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setRenaming(true)}
          aria-label="Rename chapter"
          className="flex h-9 w-9 items-center justify-center rounded-button text-muted transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
        >
          <Pencil className="h-4 w-4" strokeWidth={1.5} />
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
      {error ? <p className="text-xs text-danger sm:col-span-2">{error}</p> : null}
    </div>
  );
}
