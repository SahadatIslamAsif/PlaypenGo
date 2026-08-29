"use client";

import { Plus } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addChapter, type ActionState } from "@/lib/subjects/actions";

const initialState: ActionState = { error: null };

export function AddChapterInline({
  studentSubjectId,
  paperId,
}: {
  studentSubjectId: string;
  paperId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(addChapter, initialState);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 py-2 text-xs font-medium text-accent"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        Add chapter
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 py-2">
      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="student_subject_id" value={studentSubjectId} />
        {paperId ? <input type="hidden" name="paper_id" value={paperId} /> : null}
        <Input name="name" placeholder="Chapter name" autoFocus className="h-9" required />
        <Button type="submit" variant="secondary" disabled={pending} className="h-9 shrink-0 px-3">
          Save
        </Button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="shrink-0 text-xs font-medium text-muted"
        >
          Done
        </button>
      </form>
      {state.error ? <p className="text-xs text-danger">{state.error}</p> : null}
    </div>
  );
}
