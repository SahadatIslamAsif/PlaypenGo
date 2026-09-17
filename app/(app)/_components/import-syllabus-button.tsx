"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

const ACCEPTED_TYPES = "application/pdf,image/jpeg,image/png,image/webp";

type CommitResult = {
  subjects_committed: number;
  papers_committed: number;
  chapters_committed: number;
  chapters_deleted: number;
  chapters_flagged: number;
};

/**
 * §5.2's syllabus import - one file in, straight through
 * commit_syllabus_tree, no review screen. The subjects screen's own add /
 * rename / delete affordances are the correction path for whatever this
 * gets wrong (§5.2, "Why this parse skips the review screen").
 */
export function ImportSyllabusButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  function handleFile(file: File) {
    setError(null);
    setSummary(null);

    startTransition(async () => {
      const formData = new FormData();
      formData.append("file", file);

      let body: { error?: string; result?: CommitResult };
      try {
        const response = await fetch("/api/syllabus/import", { method: "POST", body: formData });
        body = await response.json();
        if (!response.ok) {
          setError(body.error ?? "The import failed.");
          return;
        }
      } catch {
        setError("The import failed. Check your connection and try again.");
        return;
      }

      const result = body.result;
      if (!result) {
        setError("The import failed.");
        return;
      }

      const parts = [
        `${result.subjects_committed} ${result.subjects_committed === 1 ? "subject" : "subjects"}`,
        `${result.chapters_committed} ${result.chapters_committed === 1 ? "chapter" : "chapters"}`,
      ];
      let text = parts.join(", ") + " committed";
      if (result.chapters_flagged > 0) {
        text += ` — ${result.chapters_flagged} no longer in the syllabus, flagged for review`;
      }
      if (result.chapters_deleted > 0) {
        text += ` (${result.chapters_deleted} removed automatically, nothing to review)`;
      }
      setSummary(text + ".");

      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) handleFile(file);
        }}
      />
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
        className="w-full"
      >
        <Upload className="h-4 w-4" strokeWidth={1.5} />
        {pending ? "Reading the syllabus…" : "Import syllabus"}
      </Button>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {summary ? <p className="text-xs text-muted">{summary}</p> : null}
    </div>
  );
}
