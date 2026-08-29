"use server";

import { revalidatePath } from "next/cache";
import {
  findCTAttachment,
  findCWMAttachment,
  type CTCandidate,
  type CWMWindowCandidate,
} from "@/lib/scans/match";
import { SCANS_BUCKET, SCRIPTS_BUCKET } from "@/lib/scans/storage";
import type { Json } from "@/lib/supabase/database.types";
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

export type ConfirmEntry = {
  studentSubjectId: string;
  paperId: string | null;
  type: "CT" | "CWM";
  /** The (possibly human-corrected) header date - "occurred_date from the
   * paper header, never logged_at" (§5.3), and the field is editable, so
   * this is whatever the review screen's date field reads by Save. */
  occurredDate: string;
  rawObtained: number;
  rawTotal: number;
  chapterIds: string[];
  nameMismatch: boolean;
  parsedStudentName: string | null;
  ocrConfidence: Record<string, number>;
};

export type ConfirmResult = {
  error: string | null;
  resultId?: string;
  percentage?: number;
  converted?: number;
  /** Set only when the RPC succeeded but moving the evidence images did
   * not finish - the result is real and saved either way. */
  imagingWarning?: string;
};

/**
 * §5.3's "on confirm" - the one write that turns a reviewed parse into a
 * real result. Two things can't be one Postgres transaction with the rest,
 * structurally, not by choice:
 *
 *   1. Deciding which assessment (if any) to attach to. CT and CWM
 *      attachment both need candidate rows read first (a scheduled CT for
 *      this subject; this subject's open predicted CWM windows) and a
 *      decision made in application code (findCTAttachment /
 *      findCWMAttachment, lib/scans/match.ts - not re-implemented here) -
 *      that decision has to exist before the RPC call it feeds into, so it
 *      cannot live inside the same statement as the writes it informs.
 *      Nothing here is written yet at this point; if it throws, nothing
 *      has happened.
 *   2. Moving the evidence images. confirm_scan_job() (migration 0021)
 *      already does everything DB-side in one statement - attach-or-create
 *      the assessment (a trigger already closes its window on attach,
 *      untouched here), the result row via log_manual_result (so §6's
 *      conversion, chapter_ids -> set_assessment_chapters, entry_mode,
 *      name_mismatch and ocr_confidence all come from its one existing
 *      entry shape rather than a second RPC), the result_images rows
 *      naming their eventual scripts/ destinations, and the job flipping
 *      to 'confirmed'. That whole step either fully happens or fully
 *      doesn't - if it throws, scan_jobs is untouched and still 'review',
 *      exactly as resumable as it was before Save was pressed. But
 *      Storage isn't part of Postgres's transaction at all; the bytes
 *      move only after this step returns, as separate API calls.
 *
 * Within step 2's aftermath: every copy runs before any delete. If a copy
 * fails partway, none of the originals are deleted - the result this
 * already wrote stays exactly as correct as it was, and every source image
 * is still sitting in scans/ untouched, recoverable rather than orphaned
 * the way abandon_expired_scan_jobs's TTL sweep handles a job that never
 * got this far at all.
 */
export async function confirmScanJob(jobId: string, entry: ConfirmEntry): Promise<ConfirmResult> {
  const { supabase, userId } = await currentUser();

  // --- 1. Attach, or leave null and let confirm_scan_job create new. ---
  let assessmentId: string | null = null;

  if (entry.type === "CT") {
    // "CT attaches to a scheduled assessment on that exact date... No
    // fuzzy dates." A near-miss is deliberately not offered as a chooser
    // here - that's a review-screen UI question of its own, not part of
    // this transaction.
    const { data: scheduled } = await supabase
      .from("assessments")
      .select("id, scheduled_date")
      .eq("student_id", userId)
      .eq("student_subject_id", entry.studentSubjectId)
      .eq("type", "CT")
      .eq("status", "scheduled");

    const candidates: CTCandidate[] = (scheduled ?? [])
      .filter((a): a is { id: string; scheduled_date: string } => a.scheduled_date !== null)
      .map((a) => ({ id: a.id, scheduledDate: a.scheduled_date }));

    assessmentId = findCTAttachment(candidates, entry.occurredDate).matchId;
  } else {
    // "CWM attaches to an open predicted window for that subject and
    // type, with chapter as a tiebreak only, never a requirement." Phase 6
    // (window opening) isn't built yet, so `windows` is empty in practice
    // today - this still has to be wired correctly for when it isn't.
    const { data: windows } = await supabase
      .from("assessments")
      .select("id, created_at")
      .eq("student_id", userId)
      .eq("student_subject_id", entry.studentSubjectId)
      .eq("type", "CWM")
      .eq("status", "predicted")
      .is("window_closed_at", null);

    if (windows && windows.length > 0) {
      const { data: links } = await supabase
        .from("assessment_chapters")
        .select("assessment_id, chapter_id")
        .in(
          "assessment_id",
          windows.map((w) => w.id),
        );

      const chaptersByAssessment = new Map<string, string[]>();
      for (const link of links ?? []) {
        const list = chaptersByAssessment.get(link.assessment_id) ?? [];
        list.push(link.chapter_id);
        chaptersByAssessment.set(link.assessment_id, list);
      }

      const candidates: CWMWindowCandidate[] = windows.map((w) => ({
        id: w.id,
        chapterIds: chaptersByAssessment.get(w.id) ?? [],
        createdAt: w.created_at,
      }));

      assessmentId = findCWMAttachment(candidates, entry.chapterIds[0] ?? null).matchId;
    }
  }

  // --- 2. One RPC - everything DB-side, atomically. ---
  const { data, error } = await supabase.rpc("confirm_scan_job", {
    p_job: jobId,
    p_entry: {
      assessment_id: assessmentId,
      student_subject_id: entry.studentSubjectId,
      paper_id: entry.paperId,
      type: entry.type,
      occurred_date: entry.occurredDate,
      raw_obtained: entry.rawObtained,
      raw_total: entry.rawTotal,
      chapter_ids: entry.chapterIds,
      name_mismatch: entry.nameMismatch,
      parsed_student_name: entry.parsedStudentName,
      ocr_confidence: entry.ocrConfidence,
    } as Json,
  });

  if (error) return { error: error.message };

  const result = data as {
    result_id: string;
    percentage: number | null;
    converted: number | null;
    images: { page_no: number; from_path: string; to_path: string }[] | null;
  };
  const images = result.images ?? [];

  // --- 3. The bytes. Copy every page before deleting any. ---
  for (const image of images) {
    const { error: copyError } = await supabase.storage
      .from(SCANS_BUCKET)
      .copy(image.from_path, image.to_path, { destinationBucket: SCRIPTS_BUCKET });

    if (copyError) {
      revalidatePath("/scan");
      revalidatePath("/results");
      revalidatePath("/");
      return {
        error: null,
        resultId: result.result_id,
        percentage: result.percentage ?? undefined,
        converted: result.converted ?? undefined,
        imagingWarning:
          "Result saved, but the paper's images didn't finish copying. Nothing was lost - the originals are still there.",
      };
    }
  }

  if (images.length > 0) {
    await supabase.storage.from(SCANS_BUCKET).remove(images.map((i) => i.from_path));
  }

  revalidatePath("/scan");
  revalidatePath("/results");
  revalidatePath("/");
  revalidatePath("/subjects");

  return {
    error: null,
    resultId: result.result_id,
    percentage: result.percentage ?? undefined,
    converted: result.converted ?? undefined,
  };
}
