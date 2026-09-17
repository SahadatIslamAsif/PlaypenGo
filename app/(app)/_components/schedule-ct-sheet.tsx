"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { saveCT } from "@/lib/assessments/actions";
import { MiniCalendar } from "./mini-calendar";

// §8's "Schedule a CT", moved up from a per-chapter affordance to the
// subject: a CT stops belonging to any single chapter once it can span
// several (0017's assessment_chapters). One sheet handles create, postpone
// and rename, since all three save through the same save_ct() call (0031) —
// only the entry's assessment_id differs. Two entry points open it: the
// subject card's "Schedule a CT" trigger (create) and a scheduled row in
// Results' CT section (edit, pre-filled).
//
// Flat chapter/paper arrays rather than a nested SubjectNode, so both entry
// points can feed it without reshaping data: the subject card already has a
// full SubjectNode to flatten, and Results only ever has the flat
// subjects/papers/chapters arrays it already fetched for the manual-entry
// sheet.
//
// MiniCalendar derives its view month from `selected` on mount only, so this
// component must remount (via a `key` from the caller) when switching which
// CT it edits, or the calendar's month won't follow.

export type CTChapterOption = { id: string; name: string; paperId: string | null };
export type CTPaperOption = { id: string; name: string };

export type EditingCT = {
  assessmentId: string;
  name: string | null;
  scheduledDate: string | null;
  chapterIds: string[];
};

export function ScheduleCTSheet({
  open,
  onClose,
  studentId,
  subjectId,
  subjectName,
  chapters,
  papers,
  defaultName,
  today,
  ctDates,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  studentId: string;
  subjectId: string;
  subjectName: string;
  /** Every chapter belonging to this subject - subject-level (paperId null)
   *  and paper-level alike. */
  chapters: CTChapterOption[];
  papers: CTPaperOption[];
  /** Proposed name for a brand-new CT - "CT " + the subject's next number. */
  defaultName: string;
  today: string;
  ctDates: Set<string>;
  editing?: EditingCT | null;
}) {
  const [name, setName] = useState(editing?.name ?? defaultName);
  const [date, setDate] = useState<string | null>(editing?.scheduledDate ?? null);
  const [chapterIds, setChapterIds] = useState<string[]>(editing?.chapterIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const groups = [
    { paperId: null as string | null, paperName: null as string | null },
    ...papers.map((p) => ({ paperId: p.id as string | null, paperName: p.name })),
  ]
    .map((g) => ({ ...g, chapters: chapters.filter((c) => c.paperId === g.paperId) }))
    .filter((g) => g.chapters.length > 0);

  function toggleChapter(id: string) {
    setChapterIds((ids) => (ids.includes(id) ? ids.filter((c) => c !== id) : [...ids, id]));
  }

  function save() {
    if (!date) {
      setError("Pick a date.");
      return;
    }
    if (chapterIds.length === 0) {
      setError("Choose at least one chapter.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await saveCT(studentId, {
        assessment_id: editing?.assessmentId ?? null,
        student_subject_id: subjectId,
        name,
        scheduled_date: date,
        chapter_ids: chapterIds,
      });
      if (result.error) setError(result.error);
      else onClose();
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title={editing ? "Edit CT" : "Schedule a CT"}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{subjectName}</p>

        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-ink">Name</p>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-ink">Date</p>
          <MiniCalendar today={today} selected={date} ctDates={ctDates} onSelect={setDate} />
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-ink">Chapters covered</p>
          <div className="flex max-h-56 flex-col gap-3 overflow-y-auto">
            {groups.map((group) => (
              <div key={group.paperId ?? "subject"} className="flex flex-col gap-2">
                {group.paperName ? (
                  <p className="text-xs font-semibold text-muted">{group.paperName}</p>
                ) : null}
                {group.chapters.map((chapter) => (
                  <label key={chapter.id} className="flex items-center gap-2 text-sm text-body">
                    <input
                      type="checkbox"
                      checked={chapterIds.includes(chapter.id)}
                      onChange={() => toggleChapter(chapter.id)}
                      className="h-4 w-4 rounded border-hairline accent-[color:var(--accent)]"
                    />
                    {chapter.name}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <Button type="button" onClick={save} disabled={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Schedule CT"}
        </Button>
      </div>
    </Sheet>
  );
}
