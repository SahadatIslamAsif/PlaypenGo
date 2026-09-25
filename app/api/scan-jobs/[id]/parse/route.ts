import { NextResponse } from "next/server";
import { recordGeminiCall } from "@/lib/gemini/usage";
import { isQuotaExceeded, mimeTypeFor, parsePaper } from "@/lib/scans/parse/client";
import { SCANS_BUCKET } from "@/lib/scans/storage";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

// §5.3's step-2 parse. A single 3-image Gemini call fits inside 60s
// (CLAUDE.md); this route is that one call, triggered by scan-screen.tsx
// right after a scan_jobs row reaches 'parsing', and re-triggerable on a
// 'failed' job without touching its already-uploaded pages.
export const maxDuration = 60;

// Only a job whose pages are actually recorded is parseable. 'uploading'
// hasn't finished finalizeScanJobPages() yet; 'review'/'confirmed'/
// 'abandoned' have already moved past this step (or out of it).
const PARSEABLE_STATUSES = new Set(["parsing", "failed"]);

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // No service role here - this is a student acting on their own scan, not
  // the cron route (CLAUDE.md: "service-role key is used only inside the
  // cron route"). RLS (is_owner_student) already means a job that isn't
  // this user's own simply doesn't come back - "not found" is correct
  // either way, not a 403 that would confirm someone else's job exists.
  // Claim the job atomically before doing anything else - a second POST
  // landing while a first is still genuinely mid-parse must not start its
  // own Gemini call. The lease (0035) is null-or-expired -> claimed by this
  // request; a live lease means someone else already has it, and the update
  // touches zero rows rather than racing on a separate read-then-write.
  const leaseUntil = new Date(Date.now() + 70_000).toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from("scan_jobs")
    .update({ parse_lease_expires_at: leaseUntil })
    .eq("id", jobId)
    .in("status", Array.from(PARSEABLE_STATUSES))
    .or(`parse_lease_expires_at.is.null,parse_lease_expires_at.lt.${new Date().toISOString()}`)
    .select("id, status")
    .maybeSingle();

  if (claimError) {
    return NextResponse.json({ error: "Couldn't start the parse." }, { status: 500 });
  }

  if (!claimed) {
    // The claim didn't land - work out why, only now that it matters, so
    // the common (successful-claim) path stays a single round trip.
    const { data: job } = await supabase
      .from("scan_jobs")
      .select("id, status")
      .eq("id", jobId)
      .maybeSingle();

    if (!job) {
      return NextResponse.json({ error: "Scan job not found." }, { status: 404 });
    }
    if (!PARSEABLE_STATUSES.has(job.status)) {
      return NextResponse.json(
        { error: `This job is ${job.status} and can't be parsed right now.` },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "This paper is already being read - hang tight." },
      { status: 409 },
    );
  }

  const { data: pages, error: pagesError } = await supabase
    .from("scan_pages")
    .select("page_no, storage_path")
    .eq("scan_job_id", jobId)
    .order("page_no");

  if (pagesError || !pages || pages.length === 0) {
    const message = "No pages were found for this scan.";
    await supabase
      .from("scan_jobs")
      .update({ status: "failed", error: message, parse_lease_expires_at: null })
      .eq("id", jobId);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const images = await Promise.all(
      pages.map(async (page) => {
        const { data: blob, error: downloadError } = await supabase.storage
          .from(SCANS_BUCKET)
          .download(page.storage_path);

        if (downloadError || !blob) {
          throw new Error(`Page ${page.page_no} didn't download from storage.`);
        }

        return {
          buffer: Buffer.from(await blob.arrayBuffer()),
          mimeType: mimeTypeFor(page.storage_path),
        };
      }),
    );

    // schema.ts's own comment says seededChapterNames "scopes inferred_chapter
    // to one subject's chapters" on the assumption the caller already knows
    // which subject a paper is for before parsing it - which nothing here
    // does, because subject_raw (the thing that resolves a subject) is
    // itself part of THIS parse's output. Waiting for a resolved subject
    // would mean a second Gemini call per paper, which the whole app is
    // built to avoid (CLAUDE.md: "one call per assessment, sequential,
    // never parallel"). So this passes every chapter this student has,
    // across every subject, and lets the model's own read of the paper's
    // content (which already drives subject_raw and topic_line) pick a
    // plausible one from the whole tree - the same "matched, not
    // transcribed" contract as before, just not pre-narrowed. At 114
    // chapters (this student's real tree) that's ~2.5KB of names, negligible
    // next to the images the request already carries.
    const { data: chapterRows } = await supabase
      .from("chapters")
      .select("name")
      .eq("student_id", user.id);
    const seededChapterNames = (chapterRows ?? []).map((c) => c.name);

    const rawParse = await parsePaper(images, {
      seededChapterNames,
      onAttempt: () => recordGeminiCall(supabase),
    });

    const { error: updateError } = await supabase
      .from("scan_jobs")
      .update({
        status: "review",
        raw_parse: rawParse as unknown as Json,
        error: null,
        parse_lease_expires_at: null,
      })
      .eq("id", jobId);

    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ status: "review" });
  } catch (error) {
    // The real error never reaches scan_jobs.error or the client response
    // (below) on purpose - CLAUDE.md's copy rule keeps the Gemini SDK's raw
    // error body off the screen. But that means it has to land SOMEWHERE
    // for this to be debuggable at all; console.error is that place -
    // Vercel's function logs, not anything a student/guardian/tutor sees.
    console.error(`scan parse failed for job ${jobId}:`, error);
    // scan_jobs.error is persisted and rendered as-is by scan-screen.tsx, so
    // whatever lands here reaches a screen unfiltered - the Gemini SDK's own
    // ApiError.message is the raw Google error body and never belongs there
    // (CLAUDE.md's copy rule). A 429 is the one shape common enough to name
    // specifically; anything else falls back to a generic message.
    const message = isQuotaExceeded(error)
      ? "Couldn't read this paper right now — the daily limit has been reached. It resets each afternoon, or use Log result to enter it by hand."
      : "The paper couldn't be read.";
    await supabase
      .from("scan_jobs")
      .update({ status: "failed", error: message, parse_lease_expires_at: null })
      .eq("id", jobId);
    return NextResponse.json({ error: message }, { status: isQuotaExceeded(error) ? 429 : 500 });
  }
}
