"use client";

import { AlertTriangle, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatConverted, formatRaw } from "@/lib/assessments/marks";
import { matchCentreLine, type ChapterCandidate } from "@/lib/scans/centre-line";
import { namesMatch } from "@/lib/scans/match";
import {
  resolveInferredChapterId,
  toCentreLineText,
} from "@/lib/scans/parse/adapt";
import type { RawParse } from "@/lib/scans/parse/schema";
import { attachScanJobToResult } from "@/lib/scans/actions";

// §5.3's "Attach paper later", the review screen half: "leaves confirmed
// fields alone, fills only what is empty, clears paper_missing, and drops
// the badge." Deliberately a different, smaller screen from ReviewScreen -
// there is nothing here to resolve a subject against, no marks field to
// edit, no CT/CWM toggle. The assessment this is attaching to already
// settled all of that; this screen shows it as fixed context and asks only
// what the scan can actually add: evidence images, and - only when nothing
// was picked by hand already - a chapter.

export function AttachReviewScreen({
  jobId,
  resultId,
  rawParse,
  pageImages,
  seededChapters,
  chaptersAlreadySet,
  profileName,
  subjectName,
  type,
  occurredDate,
  rawObtained,
  rawTotal,
  converted,
  percentage,
}: {
  jobId: string;
  resultId: string;
  rawParse: RawParse;
  pageImages: string[];
  /** Empty whenever chaptersAlreadySet is true - the picker below simply
   * doesn't render then, so there's nothing to populate it with. */
  seededChapters: ChapterCandidate[];
  /** "Fills only what is empty" - true means a human already picked a
   * chapter for this assessment, so the scan's own suggestion is shown as
   * a note, never as a picker that would look editable but silently do
   * nothing (attach_scan_job_to_result skips the chapter write entirely
   * once this is true). */
  chaptersAlreadySet: boolean;
  profileName: string;
  subjectName: string;
  type: "CT" | "CWM";
  occurredDate: string;
  rawObtained: number;
  rawTotal: number;
  /** Read back from the results row's own generated columns (§6), never
   * recomputed here. */
  converted: number;
  percentage: number;
}) {
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
    rawParse.header.student_name === null || namesMatch(rawParse.header.student_name, profileName);

  const [chapterIds, setChapterIds] = useState<string[]>(inferredChapterId ? [inferredChapterId] : []);
  const [zoomedPage, setZoomedPage] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function toggleChapter(id: string) {
    setChapterIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);

    const result = await attachScanJobToResult(jobId, resultId, {
      chapterIds,
      nameMismatch: !nameMatches,
      parsedStudentName: !nameMatches ? rawParse.header.student_name : null,
      ocrConfidence: rawParse.confidence,
    });

    if (result.error) {
      setSaving(false);
      setSaveError(result.error);
      return;
    }
    // Success leaves `saving` true - the same reasoning as ReviewScreen's
    // own handleSave: calling a Server Action refreshes this route's server
    // tree, and page.tsx's own 'confirmed' branch (reading the real result
    // back from the DB) replaces this component right after.
  }

  const zoomedImage = zoomedPage !== null ? pageImages[zoomedPage - 1] : null;

  return (
    <div className="flex flex-col gap-5 pb-nav-clear lg:pb-0">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-xl font-semibold text-ink">Attach this paper</h1>
        <p className="text-sm text-muted">
          Filing evidence against the {type} already logged for {subjectName}
          {occurredDate ? ` on ${formatDate(occurredDate)}` : ""}.
        </p>
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

      <Card>
        <p className="mb-1 text-sm font-semibold text-ink">Already logged</p>
        <p className="text-sm text-body">
          {formatRaw(rawObtained, rawTotal)} · {formatConverted(converted, type === "CT" ? 25 : 15)} ·{" "}
          {percentage}%
        </p>
        <p className="mt-2 text-xs text-muted">
          The marks stay exactly as logged - attaching a paper never changes them.
        </p>
      </Card>

      {chaptersAlreadySet ? (
        <Card>
          <p className="text-sm font-semibold text-ink">Chapter</p>
          <p className="mt-1 text-sm text-muted">
            Already set for this result - attaching a paper doesn&apos;t change it.
          </p>
        </Card>
      ) : (
        <Card>
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
          {centreLineResult.kind === "topic" ? (
            <p className="mt-2 text-xs text-muted">
              The centre line (&quot;{centreLineResult.text}&quot;) didn&apos;t match a seeded chapter.
            </p>
          ) : null}
        </Card>
      )}

      {!nameMatches ? (
        <Card className="flex flex-col gap-2 bg-tint-sage">
          <p className="flex items-center gap-2 text-sm font-semibold text-tint-ink">
            <AlertTriangle className="h-4 w-4" strokeWidth={1.5} />
            Name on the paper doesn&apos;t match
          </p>
          <p className="text-xs text-tint-ink/80">
            The paper reads &quot;{rawParse.header.student_name}&quot;; this result is filed under{" "}
            {profileName}.
          </p>
        </Card>
      ) : null}

      {saveError ? <p className="text-sm text-red-600">{saveError}</p> : null}

      <div className="fixed inset-x-3 bottom-nav-clear z-20 sm:static sm:inset-auto">
        <Button type="button" onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
          {saving ? "Saving…" : "Attach paper"}
        </Button>
      </div>

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

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
