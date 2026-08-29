"use client";

import { AlertTriangle, X } from "lucide-react";
import { useMemo, useState, type FocusEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { previewMarks, type AssessmentType } from "@/lib/assessments/marks";
import { matchCentreLine, type ChapterCandidate } from "@/lib/scans/centre-line";
import { deriveConfidence, type Agreement } from "@/lib/scans/confidence";
import { laterPageCandidates, resolveMarks } from "@/lib/scans/ladder";
import { namesMatch } from "@/lib/scans/match";
import {
  resolveInferredChapterId,
  toCentreLineText,
  toHeaderMarks,
  toMarkCandidates,
} from "@/lib/scans/parse/adapt";
import type { RawParse } from "@/lib/scans/parse/schema";
import { attachScanJobToResult, confirmScanJob, type ConfirmEntry } from "@/lib/scans/actions";

// §5.3's verification modal. Every value shown here comes from lib/scans/'s
// own resolution layer, called once, up front - this component reads the
// results, it doesn't re-derive them: the ellipse ladder for the marks,
// matchCentreLine + resolveInferredChapterId for the chapter, namesMatch
// for the mismatch warning, deriveConfidence for what gets highlighted.
//
// "Every field editable, always" (§5.3) - a field's own confidence never
// gates whether it can be changed, only whether it starts out flagged for
// a second look.

export type SubjectOption = { id: string; display_name: string };

export function ReviewScreen({
  jobId,
  rawParse,
  pageImages,
  seededChapters,
  subjectOptions,
  profileName,
  matchedSubjectId,
  subjectAgreement,
  typeAgreement,
}: {
  jobId: string;
  rawParse: RawParse;
  /** One signed URL per page, same order as rawParse.pages. An empty string
   * stands in for a page whose image couldn't be loaded. */
  pageImages: string[];
  seededChapters: ChapterCandidate[];
  subjectOptions: SubjectOption[];
  profileName: string;
  /** resolveSubject's read of header.subject_raw against this student's
   * actual subject list (page.tsx) - null when nothing matched. */
  matchedSubjectId: string | null;
  /** "Parsed subject vs the routine's subject for that weekday" (§5.3),
   * computed in page.tsx from a real routine fetch. */
  subjectAgreement: Agreement;
  /** "Visual type vs scheduled CT" (§5.3). "unknown" covers both "no CT is
   * scheduled for this subject/date" (the ordinary case - CWMs are never
   * scheduled) and "the visual read itself was unreadable" - neither is
   * evidence of a mismatch, so neither highlights. */
  typeAgreement: Agreement;
}) {
  // ---------------------------------------------------------------------
  // Derived once from the parse - lib/scans/'s own functions, not redone
  // by hand here.
  const markCandidates = useMemo(() => toMarkCandidates(rawParse), [rawParse]);
  const headerMarks = useMemo(() => toHeaderMarks(rawParse), [rawParse]);
  const ladder = useMemo(
    () => resolveMarks(markCandidates, headerMarks),
    [markCandidates, headerMarks],
  );
  const laterCandidates = useMemo(() => laterPageCandidates(markCandidates), [markCandidates]);

  const centreLineText = useMemo(() => toCentreLineText(rawParse), [rawParse]);
  const centreLineResult = useMemo(
    () => matchCentreLine(centreLineText, seededChapters),
    [centreLineText, seededChapters],
  );
  const inferredChapterId = useMemo(
    () => resolveInferredChapterId(rawParse, seededChapters),
    [rawParse, seededChapters],
  );

  const nameMatches =
    rawParse.header.student_name === null ||
    namesMatch(rawParse.header.student_name, profileName);

  // "header total vs ellipse denominator" (§5.3) - the one agreement
  // signal this static preview can compute without a routine fetch or a
  // scheduled-CT lookup (subject/type would need those; not built yet).
  const page1EllipseTotal = rawParse.mark_candidates.find((c) => c.page === 1)?.value_total ?? null;
  const marksAgreement: Agreement =
    headerMarks.totalMarksField !== null && page1EllipseTotal !== null
      ? headerMarks.totalMarksField === page1EllipseTotal
        ? "agree"
        : "disagree"
      : "unknown";
  const marksConfidence = deriveConfidence(rawParse.confidence.marks, marksAgreement);
  const subjectConfidence = deriveConfidence(rawParse.confidence.subject, subjectAgreement);
  const chapterConfidence = deriveConfidence(rawParse.confidence.chapter, "unknown");
  // No raw confidence.type exists to fall back to (schema.ts's
  // RawConfidence only reports subject/marks/chapter, per §5.3's own
  // prompt) - "unknown" (no scheduled CT to compare against) simply never
  // highlights, rather than deriveConfidence judging a score that was
  // never asked for.
  const typeConfidence =
    typeAgreement === "unknown" ? { highlighted: false } : deriveConfidence(1, typeAgreement);

  // ---------------------------------------------------------------------
  // Editable state - seeded from the derived values above, never read
  // from again after the first render. Every one of these can change
  // freely regardless of confidence.
  const [obtained, setObtained] = useState(ladder.obtained !== null ? String(ladder.obtained) : "");
  const [total, setTotal] = useState(ladder.total !== null ? String(ladder.total) : "");
  const [type, setType] = useState<AssessmentType>(rawParse.body_type_hint === "CT" ? "CT" : "CWM");
  const [subjectId, setSubjectId] = useState(matchedSubjectId ?? subjectOptions[0]?.id ?? "");
  const [date, setDate] = useState(rawParse.header.date ?? "");
  // "Never auto-select a chapter below the confidence threshold" - pre-
  // ticked exactly when the suggestion clears deriveConfidence's own bar,
  // i.e. exactly when it would not be highlighted below.
  const [chapterIds, setChapterIds] = useState<string[]>(
    inferredChapterId && !chapterConfidence.highlighted ? [inferredChapterId] : [],
  );
  const [nameConfirmed, setNameConfirmed] = useState(false);
  const [zoomedPage, setZoomedPage] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // §5.3's duplicate offer: set when confirmScanJob's own duplicate check
  // (student + subject + occurred_date + raw score) finds a hit. Nothing
  // has been written yet at that point - this is a fork in the road, not an
  // error.
  const [duplicateResultId, setDuplicateResultId] = useState<string | null>(null);

  const preview =
    obtained !== "" && total !== "" ? previewMarks(Number(obtained), Number(total), type) : null;

  function toggleChapter(id: string) {
    setChapterIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  function buildEntry(): ConfirmEntry {
    return {
      studentSubjectId: subjectId,
      paperId: null,
      type,
      // Editable, so this is whatever the field reads by Save, not the
      // original parse - "every field editable, always" (§5.3).
      occurredDate: date,
      rawObtained: Number(obtained),
      rawTotal: Number(total),
      chapterIds,
      // The recorded fact, not gated on nameConfirmed - the checkbox is an
      // acknowledgement, not a second vote on what actually happened.
      nameMismatch: !nameMatches,
      parsedStudentName: !nameMatches ? rawParse.header.student_name : null,
      ocrConfidence: rawParse.confidence,
    };
  }

  async function handleSave() {
    if (saving) return;
    if (!subjectId) {
      setSaveError("Choose a subject.");
      return;
    }
    if (obtained === "" || total === "") {
      setSaveError("Enter both marks.");
      return;
    }

    setSaving(true);
    setSaveError(null);

    const result = await confirmScanJob(jobId, buildEntry());

    if (result.error) {
      setSaving(false);
      setSaveError(result.error);
      return;
    }

    if (result.duplicateResultId) {
      // Nothing was written - confirmScanJob stopped before the RPC. Back
      // to live so the duplicate prompt below can offer the choice.
      setSaving(false);
      setDuplicateResultId(result.duplicateResultId);
      return;
    }

    // Success leaves `saving` true rather than resetting it: confirmScanJob
    // just changed this job's status, and calling a Server Action from a
    // Client Component refreshes this route's server tree automatically -
    // page.tsx re-renders into its own 'confirmed' branch (the real success
    // view, reading the saved result back from the DB) and replaces this
    // component outright. Flipping the button back to live between now and
    // then would just risk a double-submit for no visible benefit.
  }

  async function attachToDuplicate() {
    if (saving || !duplicateResultId) return;
    setSaving(true);
    setSaveError(null);

    const entry = buildEntry();
    const result = await attachScanJobToResult(jobId, duplicateResultId, entry);

    if (result.error) {
      setSaving(false);
      setSaveError(result.error);
      return;
    }
    // Same reasoning as handleSave's own success path - page.tsx's
    // 'confirmed' branch takes over next.
  }

  async function saveAsNewAnyway() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);

    const result = await confirmScanJob(jobId, buildEntry(), { allowDuplicate: true });

    if (result.error) {
      setSaving(false);
      setSaveError(result.error);
      return;
    }
  }

  const zoomedImage = zoomedPage !== null ? pageImages[zoomedPage - 1] : null;

  return (
    <div className="flex flex-col gap-5 pb-nav-clear lg:pb-0">
      {/* ---------------------------------------------------- thumbnail strip - pinned top, never side-by-side --- */}
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-xl font-semibold text-ink">Check the result</h1>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {rawParse.pages.map((page) => (
            <button
              key={page.page}
              type="button"
              onClick={() => setZoomedPage(page.page)}
              aria-label={`Open page ${page.page} full screen`}
              className="h-20 w-20 shrink-0 overflow-hidden rounded-tint border border-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {pageImages[page.page - 1] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={pageImages[page.page - 1]}
                  alt={`Page ${page.page}`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-surface-sunk text-xs text-muted">
                  Page {page.page}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------------------------------------------- marks --- */}
      <Card className={highlightClass(marksConfidence.highlighted)}>
        <p className="mb-3 text-sm font-semibold text-ink">Marks</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Obtained" htmlFor="rv_obtained">
            <Input
              id="rv_obtained"
              inputMode="numeric"
              value={obtained}
              onChange={(e) => setObtained(e.target.value.replace(/[^0-9.]/g, ""))}
              onFocus={scrollIntoViewOnFocus}
            />
          </Field>
          <Field label="Total" htmlFor="rv_total">
            <Input
              id="rv_total"
              inputMode="numeric"
              value={total}
              onChange={(e) => setTotal(e.target.value.replace(/[^0-9.]/g, ""))}
              onFocus={scrollIntoViewOnFocus}
            />
          </Field>
        </div>
        {preview ? (
          <p className="mt-2 text-sm text-body">
            {preview.converted !== null ? `${preview.converted.toFixed(1)} / ${preview.scale}` : "—"}
            {preview.percentage !== null ? ` · ${preview.percentage}%` : ""}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-muted">
          Read from{" "}
          {ladder.source === "ellipse"
            ? "the circled mark on page 1"
            : ladder.source === "header"
              ? "the header's marks fields"
              : "nothing legible - enter it by hand"}
          .
        </p>
        {marksConfidence.highlighted ? <ConfidenceNote /> : null}
        {laterCandidates.length > 0 ? (
          <div className="mt-3 flex flex-col gap-1 border-t border-hairline pt-3">
            <p className="text-xs font-medium text-muted">Also seen on a later page, not counted</p>
            {laterCandidates.map((c, i) => (
              <p key={i} className="text-xs text-muted">
                Page {c.page}: {c.valueObtained}
                {c.valueTotal !== null ? ` / ${c.valueTotal}` : ""} ({c.style}, {c.location})
              </p>
            ))}
          </div>
        ) : null}
      </Card>

      {/* ----------------------------------------------------------------------------------------- subject --- */}
      <Card className={highlightClass(subjectConfidence.highlighted)}>
        <Field label="Subject" htmlFor="rv_subject">
          <Select
            id="rv_subject"
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            onFocus={scrollIntoViewOnFocus}
          >
            {subjectOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name}
              </option>
            ))}
          </Select>
        </Field>
        {rawParse.header.subject_raw ? (
          <p className="mt-2 text-xs text-muted">Read as &quot;{rawParse.header.subject_raw}&quot;.</p>
        ) : null}
        {subjectConfidence.highlighted ? <ConfidenceNote /> : null}
      </Card>

      {/* -------------------------------------------------------------------------------------------- date --- */}
      <Card>
        <Field label="Date" htmlFor="rv_date">
          <input
            id="rv_date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-11 w-full rounded-button border border-hairline bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </Field>
        {rawParse.header.date_raw ? (
          <p className="mt-2 text-xs text-muted">Read as &quot;{rawParse.header.date_raw}&quot;.</p>
        ) : null}
      </Card>

      {/* -------------------------------------------------------------------------------------------- type --- */}
      <Card className={highlightClass(typeConfidence.highlighted)}>
        <Field label="Type" htmlFor="rv_type">
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
        {typeAgreement === "disagree" ? (
          <p className="mt-2 text-xs text-muted">
            A CT is already scheduled for this subject on this date - the paper itself reads as{" "}
            {rawParse.body_type_hint ?? "unclear"}.
          </p>
        ) : null}
        {typeConfidence.highlighted ? <ConfidenceNote /> : null}
      </Card>

      {/* ----------------------------------------------------------------------------------------- chapter --- */}
      <Card className={highlightClass(chapterConfidence.highlighted)}>
        <p className="mb-3 text-sm font-semibold text-ink">Chapter</p>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-body">
            <input
              type="checkbox"
              checked={chapterIds.length === 0}
              onChange={() => setChapterIds([])}
              className="h-4 w-4 rounded border-hairline accent-[color:var(--accent)]"
            />
            No chapter
          </label>
          {seededChapters.map((chapter) => (
            <div key={chapter.id}>
              <label className="flex items-center gap-2 text-sm text-body">
                <input
                  type="checkbox"
                  checked={chapterIds.includes(chapter.id)}
                  onChange={() => toggleChapter(chapter.id)}
                  onFocus={scrollIntoViewOnFocus}
                  className="h-4 w-4 rounded border-hairline accent-[color:var(--accent)]"
                />
                {chapter.name}
              </label>
              {chapter.id === inferredChapterId && rawParse.inferred_from ? (
                <p className="ml-6 text-xs text-muted">Suggested from {rawParse.inferred_from}.</p>
              ) : null}
            </div>
          ))}
        </div>
        {centreLineResult.kind === "type" ? (
          <p className="mt-2 text-xs text-muted">
            The centre line reads as a type marker ({centreLineResult.type}), not a chapter - the
            suggestion above came from the questions instead.
          </p>
        ) : centreLineResult.kind === "topic" ? (
          <p className="mt-2 text-xs text-muted">
            The centre line (&quot;{centreLineResult.text}&quot;) didn&apos;t match a seeded chapter.
          </p>
        ) : null}
        {chapterConfidence.highlighted ? <ConfidenceNote /> : null}
      </Card>

      {/* -------------------------------------------------------------------------------- name mismatch --- */}
      {!nameMatches ? (
        <Card className="flex flex-col gap-2 bg-tint-sage">
          <p className="flex items-center gap-2 text-sm font-semibold text-tint-ink">
            <AlertTriangle className="h-4 w-4" strokeWidth={1.5} />
            Name on the paper doesn&apos;t match
          </p>
          <p className="text-xs text-tint-ink/80">
            The paper reads &quot;{rawParse.header.student_name}&quot;; this result is being filed
            under{" "}
            {profileName}.
          </p>
          <label className="flex items-center gap-2 text-sm text-tint-ink">
            <input
              type="checkbox"
              checked={nameConfirmed}
              onChange={(e) => setNameConfirmed(e.target.checked)}
              className="h-4 w-4 rounded border-hairline accent-[color:var(--accent)]"
            />
            I&apos;ve checked - this is the right paper
          </label>
        </Card>
      ) : null}

      {/* ---------------------------------------------------- duplicate offer - §5.3's "offer, never reject" --- */}
      {duplicateResultId ? (
        <Card className="flex flex-col gap-3 bg-tint-sage">
          <div>
            <p className="text-sm font-semibold text-tint-ink">This looks already logged</p>
            <p className="mt-1 text-xs text-tint-ink/80">
              Same subject, date and marks as a result that&apos;s already saved. Attach these
              images to it instead of creating a second one?
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" onClick={attachToDuplicate} disabled={saving} className="sm:w-auto">
              {saving ? "Attaching…" : "Attach to that result"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={saveAsNewAnyway}
              disabled={saving}
              className="sm:w-auto"
            >
              Save as new anyway
            </Button>
          </div>
          <button
            type="button"
            onClick={() => setDuplicateResultId(null)}
            className="self-start text-xs text-tint-ink/80 hover:underline"
          >
            Never mind, let me edit first
          </button>
        </Card>
      ) : null}

      {saveError ? <p className="text-sm text-red-600">{saveError}</p> : null}

      {/* ---------------------------------------------------------------------------------------- save bar --- */}
      {/* Floating pill, not a boxed bar - same reasoning as scan-screen.tsx's
          Done: no bg-surface/border wrapper reading as a white frame, no
          chrome the raised Scan circle's own shadow-only treatment already
          argues against. bottom-nav-clear is the one shared clearance token,
          not new padding invented here. Never disabled by an unconfirmed
          name mismatch - "does not block" (§5.3). Hidden while the
          duplicate offer above is open - Save would just re-find the same
          duplicate, since allowDuplicate is only ever true on the "as new
          anyway" path. */}
      {!duplicateResultId ? (
        <div className="fixed inset-x-3 bottom-nav-clear z-20 sm:static sm:inset-auto">
          <Button type="button" onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
            {saving ? "Saving…" : "Save result"}
          </Button>
        </div>
      ) : null}

      {zoomedImage ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/90 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Page ${zoomedPage}`}
          onClick={() => setZoomedPage(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomedImage}
            alt={`Page ${zoomedPage}, full screen`}
            className="max-h-full max-w-full object-contain"
          />
          <button
            type="button"
            onClick={() => setZoomedPage(null)}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-[14px] bg-surface text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-5 w-5" strokeWidth={1.5} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function highlightClass(highlighted: boolean): string {
  return highlighted ? "ring-2 ring-accent" : "";
}

/** "Low-confidence fields keep their highlight and scroll into view when
 * focused" (SPEC.md's Scan section) - the whole rule in one handler. */
function scrollIntoViewOnFocus(e: FocusEvent<HTMLElement>) {
  e.currentTarget.scrollIntoView({ behavior: "smooth", block: "center" });
}

function ConfidenceNote() {
  return <p className="mt-2 text-xs font-medium text-accent">Low confidence — worth a second look.</p>;
}
