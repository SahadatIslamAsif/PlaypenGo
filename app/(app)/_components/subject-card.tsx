"use client";

import { ChevronDown, Trash2 } from "lucide-react";
import { useState } from "react";
import { deleteSubject, deletePaper } from "@/lib/subjects/actions";
import type { SubjectNode } from "@/lib/subjects/tree";
import { AddChapterInline } from "./add-chapter-inline";
import { AddPaperInline } from "./add-paper-inline";
import { ChapterRow } from "./chapter-row";

export function SubjectCard({
  subject,
  editable,
  studentId,
}: {
  subject: SubjectNode;
  editable: boolean;
  studentId: string;
}) {
  const [expanded, setExpanded] = useState(false);
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
                <ChapterRow key={chapter.id} chapter={chapter} editable={editable} studentId={studentId} studentSubjectId={subject.id} />
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
                {editable ? (
                  <form action={deletePaper}>
                    <input type="hidden" name="paper_id" value={paper.id} />
                    <button
                      type="submit"
                      aria-label={`Delete ${paper.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-button text-muted hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  </form>
                ) : null}
              </div>
              <div className="divide-y divide-hairline">
                {paper.chapters.map((chapter) => (
                  <ChapterRow key={chapter.id} chapter={chapter} editable={editable} studentId={studentId} studentSubjectId={subject.id} />
                ))}
              </div>
              {editable ? (
                <AddChapterInline studentSubjectId={subject.id} paperId={paper.id} />
              ) : null}
            </div>
          ))}

          {editable ? (
            <div className="mt-2 flex items-center justify-between border-t border-hairline pt-2">
              <AddPaperInline studentSubjectId={subject.id} />
              <form action={deleteSubject}>
                <input type="hidden" name="student_subject_id" value={subject.id} />
                <button
                  type="submit"
                  className="py-2 text-xs font-medium text-muted hover:text-red-600"
                >
                  Delete subject
                </button>
              </form>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
