"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// The DB-write half of §5.3's capture flow. The image bytes go browser ->
// bucket directly (scan-screen.tsx, same split as routine-photo.tsx -
// lib/scans/storage.ts's policies are what authorise that write); these
// actions are what makes the result durable, following the currentUser() +
// {error} state + revalidatePath shape already used in
// lib/routines/actions.ts and lib/assessments/actions.ts.

export type ActionState = { error: string | null };

async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return { supabase, userId: user.id };
}

/**
 * The first write of a capture: one row per paper (§5.3's "one paper per
 * job"), status 'uploading' from the moment it's created - not once the
 * upload finishes. jobId is generated client-side (crypto.randomUUID, same
 * pattern as the routine's own routineId) so the upload that follows can
 * build each page's storage path before this insert even returns.
 */
export async function createScanJob(jobId: string, studentId: string): Promise<ActionState> {
  const { supabase } = await currentUser();

  const { error } = await supabase
    .from("scan_jobs")
    .insert({ id: jobId, student_id: studentId, status: "uploading" });

  if (error) return { error: error.message };

  revalidatePath("/scan");
  return { error: null };
}

/**
 * Called once every page for this job has uploaded successfully. Records
 * where each page landed, then flips the job to 'parsing' - the parse
 * route (app/api/scan-jobs/[id]/parse) is what actually reads them.
 *
 * If the scan_pages insert itself fails, the job is marked 'failed' rather
 * than left at 'uploading' with pages that don't match what's really in the
 * bucket - "don't leave a half-uploaded job looking complete" (§5.3)
 * applies here too, not just to an upload that fails client-side.
 */
export async function finalizeScanJobPages(
  jobId: string,
  studentId: string,
  pages: { pageNo: number; storagePath: string }[],
): Promise<ActionState> {
  const { supabase } = await currentUser();

  const { error: pagesError } = await supabase.from("scan_pages").insert(
    pages.map((p) => ({
      scan_job_id: jobId,
      student_id: studentId,
      page_no: p.pageNo,
      storage_path: p.storagePath,
    })),
  );

  if (pagesError) {
    await supabase
      .from("scan_jobs")
      .update({ status: "failed", error: pagesError.message })
      .eq("id", jobId);
    return { error: pagesError.message };
  }

  const { error: statusError } = await supabase
    .from("scan_jobs")
    .update({ status: "parsing" })
    .eq("id", jobId);

  if (statusError) {
    await supabase
      .from("scan_jobs")
      .update({ status: "failed", error: statusError.message })
      .eq("id", jobId);
    return { error: statusError.message };
  }

  revalidatePath("/scan");
  return { error: null };
}

/**
 * Called when the client-side image upload itself fails partway through a
 * job's pages. The job must not sit at 'uploading' looking recoverable by
 * accident when pages are actually missing - abandon_expired_scan_jobs()'s
 * TTL sweep would eventually catch a stuck 'uploading' row, but §5.3 wants
 * this explicit and immediate, not a multi-day wait.
 */
export async function markScanJobFailed(jobId: string, error: string): Promise<ActionState> {
  const { supabase } = await currentUser();

  const { error: updateError } = await supabase
    .from("scan_jobs")
    .update({ status: "failed", error })
    .eq("id", jobId);

  if (updateError) return { error: updateError.message };

  revalidatePath("/scan");
  return { error: null };
}

/**
 * A job found still at 'uploading' on a fresh page load (scan-screen.tsx's
 * mount fetch) died with the tab that started it - some pages may be in
 * the bucket, none are recorded as scan_pages, and there's no page left to
 * re-derive them from. Nothing to resume, only to close out: the same
 * terminal status the TTL sweep would eventually reach on its own
 * (abandon_expired_scan_jobs), just chosen by the student now instead of
 * waited out over 7 days.
 */
export async function abandonScanJob(jobId: string): Promise<ActionState> {
  const { supabase } = await currentUser();

  const { error } = await supabase
    .from("scan_jobs")
    .update({ status: "abandoned" })
    .eq("id", jobId);

  if (error) return { error: error.message };

  revalidatePath("/scan");
  return { error: null };
}
