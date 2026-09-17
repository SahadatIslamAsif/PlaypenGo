"use client";

import { CalendarClock, ChevronDown, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { deleteSubject, deletePaper } from "@/lib/subjects/actions";
import type { SubjectNode } from "@/lib/subjects/tree";
import { AddChapterInline } from "./add-chapter-inline";
import { AddPaperInline } from "./add-paper-inline";
import { ChapterRow } from "./chapter-row";
import { ScheduleCTSheet } from "./schedule-ct-sheet";

export function SubjectCard({
  subject,
  editable,
  studentId,
  today,
  ctDates,
  ctCount,
}: {
  subject: SubjectNode;
  editable: boolean;
  studentId: string;
  today: string;
  ctDates: Set<string>;
  ctCount: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const totalChapters =
    subject.chapters.length + subject.papers.reduce((n, p) => n + p.chapters.length, 0);

  return (
    <div className="rounded-card border border-hairline bg-surface shadow-soft">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <p className="text-sm font-semibold text-ink">{subject.display_name}</p>
          <p className="text-xs text-muted">
            {subject.teacher_name ? `${subject.teacher_name} · ` : ""}
            {totalChapters} {totalChapters === 1 ? "chapter" : "chapters"}
          </p>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
          strokeWidth={1.5}
        />
      </button>

      {expanded ? (
        <div className="border-t border-hairline px-4 py-3">
          {subject.chapters.length || (subject.papers.length === 0 && editable) ? (
            <div className="divide-y divide-hairline">
              {subject.chapters.map((chapter) => (
                <ChapterRow key={chapter.id} chapter={chapter} editable={editable} />
              ))}
            </div>
          ) : null}

          {editable && subject.papers.length === 0 ? (
            <AddChapterInline studentSubjectId={subject.id} />
          ) : null}

          {subject.papers.map((paper) => (
            <div key={paper.id} className="mt-3 rounded-tint bg-surface-sunk p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-ink">{paper.name}</p>
                {editable ? <DeletePaperButton paperId={paper.id} paperName={paper.name} /> : null}
              </div>
              <div className="divide-y divide-hairline">
                {paper.chapters.map((chapter) => (
                  <ChapterRow key={chapter.id} chapter={chapter} editable={editable} />
                ))}
              </div>
              {editable ? (
                <AddChapterInline studentSubjectId={subject.id} paperId={paper.id} />
              ) : null}
            </div>
          ))}

          {editable ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-2">
              <div className="flex items-center gap-2">
                <AddPaperInline studentSubjectId={subject.id} />
                <button
                  type="button"
                  onClick={() => setScheduling(true)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-pill border border-hairline bg-surface px-3 text-xs font-medium text-muted transition-colors hover:text-ink"
                >
                  <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Schedule a CT
                </button>
              </div>
              <DeleteSubjectButton subjectId={subject.id} />
            </div>
          ) : null}
        </div>
      ) : null}

      {editable ? (
        <ScheduleCTSheet
          key={scheduling ? "open" : "closed"}
          open={scheduling}
          onClose={() => setScheduling(false)}
          studentId={studentId}
          subjectId={subject.id}
          subjectName={subject.display_name}
          chapters={[
            ...subject.chapters.map((c) => ({ id: c.id, name: c.name, paperId: null })),
            ...subject.papers.flatMap((p) =>
              p.chapters.map((c) => ({ id: c.id, name: c.name, paperId: p.id })),
            ),
          ]}
          papers={subject.papers.map((p) => ({ id: p.id, name: p.name }))}
          defaultName={`CT ${ctCount + 1}`}
          today={today}
          ctDates={ctDates}
        />
      ) : null}
    </div>
  );
}

function DeletePaperButton({ paperId, paperName }: { paperId: string; paperName: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        aria-label={`Delete ${paperName}`}
        onClick={() =>
          startTransition(async () => {
            const result = await deletePaper(paperId);
            setError(result.error);
          })
        }
        className="flex h-7 w-7 items-center justify-center rounded-button text-muted transition-colors hover:text-danger disabled:opacity-60"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

function DeleteSubjectButton({ subjectId }: { subjectId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteSubject(subjectId);
            setError(result.error);
          })
        }
        className="py-2 text-xs font-medium text-muted transition-colors hover:text-danger disabled:opacity-60"
      >
        Delete subject
      </button>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
