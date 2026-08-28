"use client";

import { Camera, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { compressImage } from "@/lib/images/compress";
import {
  abandonScanJob,
  createScanJob,
  finalizeScanJobPages,
  markScanJobFailed,
} from "@/lib/scans/actions";
import { SCANS_BUCKET, scanImagePath } from "@/lib/scans/storage";
import { createClient } from "@/lib/supabase/client";
import { PageStrip } from "./page-strip";
import { groupIntoPapers, type CapturedPage } from "./pages";

// §5.3's capture flow, now fully wired: Capture → thumbnail strip → Add
// page → Done. Done splits captured pages into papers (pages.ts's
// groupIntoPapers, one scan_jobs row per paper) and, for each: creates the
// job (status 'uploading'), uploads every page browser -> bucket directly
// (same split as routine-photo.tsx - lib/scans/storage.ts's policies are
// what authorise the write, not this component), records the pages and
// flips the job to 'parsing', then fires the parse route and starts
// polling. State that matters lives in scan_jobs/scan_pages from the
// moment the job row is created, not in this component's own memory - a
// tab evicted mid-upload leaves a recoverable row, not nothing.
//
// initialJobs (page.tsx's own server-side fetch of this student's
// non-terminal scan_jobs) is why a reload doesn't just lose every in-flight
// job: 'parsing'/'review' rows just resume showing their real status, and a
// 'uploading' row - which can only mean the tab that started it died before
// finishing - surfaces with a Discard action rather than silently vanishing
// for up to 7 days until abandon_expired_scan_jobs's TTL sweep gets to it.

const MAX_PAGES = 5;

export type JobStatus = "uploading" | "parsing" | "review" | "failed";

export type SubmittedJob = {
  id: string;
  status: JobStatus;
  error: string | null;
};

function statusLabel(status: JobStatus): string {
  switch (status) {
    case "uploading":
      return "Didn't finish uploading";
    case "parsing":
      return "Reading the paper…";
    case "review":
      return "Ready to review";
    case "failed":
      return "Couldn't read this paper";
  }
}

export function ScanScreen({
  studentId,
  initialJobs,
}: {
  studentId: string;
  initialJobs: SubmittedJob[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomedId, setZoomedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submittedJobs, setSubmittedJobs] = useState<SubmittedJob[]>(initialJobs);

  const atCap = pages.length >= MAX_PAGES;
  const zoomedPage = pages.find((p) => p.id === zoomedId) ?? null;

  async function handleCapture(file: File) {
    if (atCap) return; // defense-in-depth - the trigger button is already disabled at cap
    setCapturing(true);
    setError(null);
    try {
      const compressed = await compressImage(file); // defaults only, same call as routine-photo.tsx
      setPages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          blob: compressed.blob,
          extension: compressed.extension,
          width: compressed.width,
          height: compressed.height,
          previewUrl: URL.createObjectURL(compressed.blob),
          sameAsPrevious: true,
        },
      ]);
    } catch {
      setError("That file couldn't be read as an image.");
    } finally {
      setCapturing(false);
    }
  }

  function toggleSame(id: string) {
    setPages((prev) =>
      prev.map((p) => (p.id === id ? { ...p, sameAsPrevious: !p.sameAsPrevious } : p)),
    );
  }

  function removePage(id: string) {
    setPages((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
    setZoomedId(null);
  }

  function triggerParse(jobId: string) {
    // Fire-and-forget, not awaited: the route itself does the up-to-60s
    // Gemini call, and this component learns the outcome by polling
    // scan_jobs directly, not from this request's own response. keepalive
    // so the request is still sent even if the tab closes right after -
    // "safe to close the tab and come back" starts here.
    void fetch(`/api/scan-jobs/${jobId}/parse`, { method: "POST", keepalive: true }).catch(() => {
      // A network failure to even reach the route isn't fatal - the job
      // stays 'parsing' and the poll below will keep checking; "Retry"
      // on a job that never left 'parsing' just fires this again.
    });
  }

  async function handleDone() {
    if (pages.length === 0 || saving) return;
    setSaving(true);
    setError(null);

    const supabase = createClient();
    const papers = groupIntoPapers(pages);
    const newJobs: SubmittedJob[] = [];

    for (const paper of papers) {
      const jobId = crypto.randomUUID();
      const created = await createScanJob(jobId, studentId);
      if (created.error) {
        newJobs.push({ id: jobId, status: "failed", error: created.error });
        continue;
      }

      const uploaded: { pageNo: number; storagePath: string }[] = [];
      let uploadError: string | null = null;

      for (let i = 0; i < paper.length; i++) {
        const page = paper[i];
        const pageNo = i + 1;
        const storagePath = scanImagePath(studentId, jobId, pageNo, page.extension);
        const { error: uploadErr } = await supabase.storage
          .from(SCANS_BUCKET)
          .upload(storagePath, page.blob, { contentType: page.blob.type, upsert: true });

        if (uploadErr) {
          uploadError = "A page didn't upload. Check your connection and try again.";
          break; // don't leave a half-uploaded job looking complete - stop and mark it failed
        }
        uploaded.push({ pageNo, storagePath });
      }

      if (uploadError) {
        await markScanJobFailed(jobId, uploadError);
        newJobs.push({ id: jobId, status: "failed", error: uploadError });
        continue;
      }

      const finalized = await finalizeScanJobPages(jobId, studentId, uploaded);
      if (finalized.error) {
        newJobs.push({ id: jobId, status: "failed", error: finalized.error });
        continue;
      }

      newJobs.push({ id: jobId, status: "parsing", error: null });
      triggerParse(jobId);
    }

    setSubmittedJobs((prev) => [...prev, ...newJobs]);
    pages.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setPages([]);
    setSaving(false);
  }

  function retryParse(jobId: string) {
    // §5.3: "A failed job can be re-parsed without re-uploading the
    // images." Its scan_pages rows are untouched by a failure - only the
    // job's own status/error changed - so this just re-triggers the parse.
    setSubmittedJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { id: j.id, status: "parsing", error: null } : j)),
    );
    triggerParse(jobId);
  }

  async function discardJob(jobId: string) {
    // Nothing to resume - some pages may be in the bucket, but none are
    // recorded as scan_pages, and the page that could re-add them is gone.
    // Only close it out, same terminal status the TTL sweep would reach on
    // its own.
    const result = await abandonScanJob(jobId);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSubmittedJobs((prev) => prev.filter((j) => j.id !== jobId));
  }

  // Poll every job still in flight until it reaches a terminal status.
  // 'uploading' is excluded on purpose - it never means "in progress" here
  // (handleDone resolves synchronously to 'parsing' or 'failed' and never
  // leaves an interim 'uploading' entry in this state), only "stuck, from a
  // previous session" - discardJob is its only way out, not more waiting.
  useEffect(() => {
    const pendingIds = submittedJobs.filter((j) => j.status === "parsing").map((j) => j.id);
    if (pendingIds.length === 0) return;

    const supabase = createClient();
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("scan_jobs")
        .select("id, status, error")
        .in("id", pendingIds);
      if (!data) return;

      setSubmittedJobs((prev) =>
        prev.map((job) => {
          const fresh = data.find((d) => d.id === job.id);
          return fresh ? { id: job.id, status: fresh.status as JobStatus, error: fresh.error } : job;
        }),
      );
    }, 2500);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the pending id set's contents, not the array reference; re-derived from submittedJobs itself
  }, [submittedJobs.map((j) => `${j.id}:${j.status}`).join(",")]);

  return (
    <div className="flex flex-col gap-5 pb-nav-clear lg:pb-0">
      <div>
        <h1 className="font-display text-xl font-semibold text-ink">Scan a paper</h1>
        <p className="mt-1 text-sm text-muted">
          Capture every page in order. Up to 5 pages, one paper at a time.
        </p>
      </div>

      <PageStrip pages={pages} onToggleSame={toggleSame} onZoom={setZoomedId} />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={capturing || atCap || saving}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-button border border-hairline bg-surface px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-sunk disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:w-36"
        >
          <Camera className="h-4 w-4" strokeWidth={1.5} />
          Add page
        </button>
        <p className="text-xs text-muted">
          {capturing ? "Adding…" : atCap ? "Limit reached" : `${pages.length} of ${MAX_PAGES} pages`}
        </p>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleCapture(file);
            e.target.value = "";
          }}
        />
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {submittedJobs.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-ink">Submitted</p>
          {submittedJobs.map((job) => (
            <div
              key={job.id}
              className="flex items-center justify-between gap-3 rounded-tint border border-hairline bg-surface px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm text-body">{statusLabel(job.status)}</p>
                {job.status === "failed" && job.error ? (
                  <p className="truncate text-xs text-muted">{job.error}</p>
                ) : null}
              </div>
              {job.status === "failed" ? (
                <button
                  type="button"
                  onClick={() => retryParse(job.id)}
                  className="shrink-0 text-sm font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Retry
                </button>
              ) : job.status === "uploading" ? (
                <button
                  type="button"
                  onClick={() => discardJob(job.id)}
                  className="shrink-0 text-sm font-medium text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Discard
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* A floating pill, not a boxed bar - no bg-surface/border wrapper to
          read as a white frame around the button. It's already lifted clear
          of the tab bar and the circle by bottom-nav-clear; a white box
          around it would just be chrome the circle's own shadow-only
          treatment already argues against. inset-x-3 matches the 12px
          mobile gutter cards sit at (CLAUDE.md's Mobile section). */}
      <div className="fixed inset-x-3 bottom-nav-clear z-20 sm:static sm:inset-auto">
        {/* sm:w-36 matches "Add page" above - same width as the same step's
            other action, not just independently auto-sized. */}
        <Button
          type="button"
          onClick={handleDone}
          disabled={pages.length === 0 || saving}
          className="w-full sm:w-36"
        >
          {saving ? "Saving…" : "Done"}
        </Button>
      </div>

      {zoomedPage ? (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-ink/90 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Captured page"
          onClick={() => setZoomedId(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomedPage.previewUrl}
            alt="Captured page, full screen"
            className="max-h-[70vh] max-w-full object-contain"
          />
          <Button
            type="button"
            variant="destructive"
            onClick={(e) => {
              e.stopPropagation();
              removePage(zoomedPage.id);
            }}
          >
            Remove page
          </Button>
          <button
            type="button"
            onClick={() => setZoomedId(null)}
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
