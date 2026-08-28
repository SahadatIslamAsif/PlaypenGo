"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { saveManualResult } from "@/lib/assessments/actions";
import { previewMarks, type AssessmentType } from "@/lib/assessments/marks";

// §5.3's manual fallback, as a bottom sheet ("Modals are bottom sheets").
// Fields: subject, paper, type, chapter, obtained, total, and a "Paper not
// returned" checkbox — plus a date, which §5.3's list doesn't name but which
// a student logging a paper from earlier in the week genuinely needs.
//
// The live conversion preview (§6, made visible before the save button is
// even pressed) is the point of the whole app in miniature.

export type SubjectOption = { id: string; display_name: string };
export type PaperOption = { id: string; student_subject_id: string; name: string };
export type ChapterOption = { id: string; student_subject_id: string; paper_id: string | null; name: string };

export function ManualEntrySheet({
  open,
  onClose,
  studentId,
  subjects,
  papers,
  chapters,
  today,
}: {
  open: boolean;
  onClose: () => void;
  studentId: string;
  subjects: SubjectOption[];
  papers: PaperOption[];
  chapters: ChapterOption[];
  today: string;
}) {
  const [subjectId, setSubjectId] = useState("");
  const [paperId, setPaperId] = useState("");
  const [type, setType] = useState<AssessmentType>("CWM");
  const [chapterId, setChapterId] = useState("");
  const [obtained, setObtained] = useState("");
  const [total, setTotal] = useState("");
  const [paperMissing, setPaperMissing] = useState(false);
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const subjectPapers = useMemo(
    () => papers.filter((p) => p.student_subject_id === subjectId),
    [papers, subjectId],
  );

  const availableChapters = useMemo(() => {
    if (!subjectId) return [];
    if (subjectPapers.length > 0) {
      return paperId ? chapters.filter((c) => c.paper_id === paperId) : [];
    }
    return chapters.filter((c) => c.student_subject_id === subjectId && c.paper_id === null);
  }, [chapters, subjectId, subjectPapers, paperId]);

  const preview =
    obtained !== "" && total !== ""
      ? previewMarks(Number(obtained), Number(total), type)
      : null;

  function reset() {
    setSubjectId("");
    setPaperId("");
    setType("CWM");
    setChapterId("");
    setObtained("");
    setTotal("");
    setPaperMissing(false);
    setDate(today);
    setError(null);
  }

  function close() {
    reset();
    onClose();
  }

  function save() {
    if (!subjectId) {
      setError("Choose a subject.");
      return;
    }
    if (obtained === "" || total === "") {
      setError("Enter both marks.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await saveManualResult(studentId, {
        student_subject_id: subjectId,
        paper_id: paperId || null,
        chapter_ids: chapterId ? [chapterId] : [],
        type,
        occurred_date: date,
        raw_obtained: Number(obtained),
        raw_total: Number(total),
        paper_missing: paperMissing,
      });
      if (result.error) setError(result.error);
      else close();
    });
  }

  return (
    <Sheet open={open} onClose={close} title="Log a result">
      <div className="flex flex-col gap-4">
        <Field label="Subject" htmlFor="me_subject">
          <Select
            id="me_subject"
            value={subjectId}
            onChange={(e) => {
              setSubjectId(e.target.value);
              setPaperId("");
              setChapterId("");
            }}
          >
            <option value="">Choose a subject</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name}
              </option>
            ))}
          </Select>
        </Field>

        {subjectPapers.length > 0 ? (
          <Field label="Paper" htmlFor="me_paper">
            <Select
              id="me_paper"
              value={paperId}
              onChange={(e) => {
                setPaperId(e.target.value);
                setChapterId("");
              }}
            >
              <option value="">Choose a paper</option>
              {subjectPapers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Field label="Type" htmlFor="me_type">
          <div className="flex overflow-hidden rounded-button border border-hairline">
            {(["CWM", "CT"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`h-11 flex-1 text-sm font-medium transition-colors ${
                  type === t ? "bg-ink text-shell" : "bg-surface text-body hover:bg-surface-sunk"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </Field>

        {availableChapters.length > 0 ? (
          <Field label="Chapter (optional)" htmlFor="me_chapter">
            <Select id="me_chapter" value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
              <option value="">No chapter</option>
              {availableChapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Obtained" htmlFor="me_obtained">
            <Input
              id="me_obtained"
              inputMode="numeric"
              value={obtained}
              onChange={(e) => setObtained(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="12"
            />
          </Field>
          <Field label="Total" htmlFor="me_total">
            <Input
              id="me_total"
              inputMode="numeric"
              value={total}
              onChange={(e) => setTotal(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="15"
            />
          </Field>
        </div>

        {preview ? (
          <p className="text-sm text-body">
            {preview.converted !== null ? `${preview.converted.toFixed(1)} / ${preview.scale}` : "—"}
            {preview.percentage !== null ? ` · ${preview.percentage}%` : ""}
          </p>
        ) : null}

        <Field label="Date" htmlFor="me_date">
          <input
            id="me_date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-11 w-full rounded-button border border-hairline bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-body">
          <input
            type="checkbox"
            checked={paperMissing}
            onChange={(e) => setPaperMissing(e.target.checked)}
            className="h-4 w-4 rounded border-hairline accent-[color:var(--accent)]"
          />
          Paper not returned
        </label>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <Button type="button" onClick={save} disabled={pending} className="w-full">
          {pending ? "Saving…" : "Save result"}
        </Button>
      </div>
    </Sheet>
  );
}
