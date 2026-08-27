"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { assignCTDate, cancelCT } from "@/lib/assessments/actions";
import type { ChapterCT } from "@/lib/subjects/tree";
import { MiniCalendar } from "./mini-calendar";

// §8: "Assign / edit CT date on any chapter, with postpone." A bottom sheet,
// per the copy rule and the modal rule both — "Modals are bottom sheets."
// One sheet handles assign, edit and postpone, since all three are the same
// action (set scheduled_date); only Cancel is a distinct write.

export function CTDateSheet({
  open,
  onClose,
  studentId,
  studentSubjectId,
  chapterId,
  chapterName,
  ct,
  today,
  ctDates,
}: {
  open: boolean;
  onClose: () => void;
  studentId: string;
  studentSubjectId: string;
  chapterId: string;
  chapterName: string;
  ct: ChapterCT | null;
  today: string;
  ctDates: Set<string>;
}) {
  const [date, setDate] = useState(ct?.date ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isCancelled = ct?.status === "cancelled";

  function save() {
    if (!date) {
      setError("Pick a date.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await assignCTDate({
        studentId,
        studentSubjectId,
        chapterId,
        assessmentId: isCancelled ? null : (ct?.assessmentId ?? null),
        date,
      });
      if (result.error) setError(result.error);
      else onClose();
    });
  }

  function cancel() {
    if (!ct) return;
    setError(null);
    startTransition(async () => {
      const result = await cancelCT(ct.assessmentId);
      if (result.error) setError(result.error);
      else onClose();
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title="CT date">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{chapterName}</p>

        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-ink">Date</p>
          <MiniCalendar today={today} selected={date || null} ctDates={ctDates} onSelect={setDate} />
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex gap-2">
          {ct && !isCancelled ? (
            <Button
              type="button"
              variant="destructive"
              onClick={cancel}
              disabled={pending}
              className="flex-1"
            >
              Cancel CT
            </Button>
          ) : null}
          <Button type="button" onClick={save} disabled={pending} className="flex-1">
            {pending ? "Saving…" : ct && !isCancelled ? "Update date" : "Set date"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
