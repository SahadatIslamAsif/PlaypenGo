import { NextResponse } from "next/server";
import { mimeTypeFor, parsePaper } from "@/lib/scans/parse/client";
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

  const { data: pages, error: pagesError } = await supabase
    .from("scan_pages")
    .select("page_no, storage_path")
    .eq("scan_job_id", jobId)
    .order("page_no");

  if (pagesError || !pages || pages.length === 0) {
    const message = "No pages were found for this scan.";
    await supabase.from("scan_jobs").update({ status: "failed", error: message }).eq("id", jobId);
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

    // seededChapterNames is empty for now - matching a subject to its
    // seeded chapters is a separate resolution step this pass doesn't
    // build. inferred_chapter stays null until that lands, same as an
    // unseeded subject in the CLI (schema.ts's own documented behaviour).
    const rawParse = await parsePaper(images);

    const { error: updateError } = await supabase
      .from("scan_jobs")
      .update({ status: "review", raw_parse: rawParse as unknown as Json, error: null })
      .eq("id", jobId);

    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ status: "review" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The parse failed.";
    await supabase.from("scan_jobs").update({ status: "failed", error: message }).eq("id", jobId);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
