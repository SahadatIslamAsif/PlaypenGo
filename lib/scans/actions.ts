"use server";

import { revalidatePath } from "next/cache";
import {
  findCTAttachment,
  findCWMAttachment,
  findDuplicateResult,
  type CTCandidate,
  type CWMWindowCandidate,
  type ExistingResult,
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
export async function createScanJob(
  jobId: string,
  studentId: string,
  targetResultId: string | null = null,
): Promise<ActionState> {
  const { supabase } = await currentUser();

  const { error } = await supabase.from("scan_jobs").insert({
    id: jobId,
    student_id: studentId,
    status: "uploading",
    target_result_id: targetResultId,
  });

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
  /** Set instead of resultId/percentage/converted when confirmScanJob finds
   * a duplicate and stops short of writing anything - see its own doc
   * comment's step 0. Nothing has been saved yet; the caller chooses. */
  duplicateResultId?: string;
};

type RpcResult = {
  result_id: string;
  percentage: number | null;
  converted: number | null;
  images: { page_no: number; from_path: string; to_path: string }[] | null;
};

/**
 * Step 3 of both confirmScanJob and attachScanJobToResult, factored out
 * because it's identical either way: the DB write already fully happened
 * (this only runs once the RPC has returned successfully), and what's left
 * is exactly §5.3's "bytes move last" - copy every page before deleting any,
 * so a copy failure partway leaves the already-correct result exactly as
 * correct, with every source image still sitting in scans/, recoverable
 * rather than orphaned.
 */
async function moveScanImages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  result: RpcResult,
): Promise<ConfirmResult> {
  const images = result.images ?? [];

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

export type AttachmentPreview = {
  assessmentId: string | null;
  matchedBy: "ct-date" | "cwm-chapter" | "cwm-oldest" | null;
  /** CT only, and only when there was no exact-date match: every other open
   * scheduled CT for this subject, offered so a postponed CT can still be
   * picked by hand. "No fuzzy dates... never auto-match, never hide" (§5.3) -
   * this is the "never hide" half; findCTAttachment always returns these,
   * confirmScanJob just used to throw them away. */
  ctOptions: CTCandidate[];
};

/**
 * The attachment decision, on its own: which assessment (if any) this scan
 * would attach to, without writing anything. Shared by confirmScanJob
 * (which trusts it unless the caller overrides it) and previewAttachment
 * below (which exists so the review screen can show the decision - and a
 * "file as new" way out of it - before Save is ever pressed).
 */
async function resolveAttachment(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  entry: Pick<ConfirmEntry, "studentSubjectId" | "type" | "occurredDate" | "chapterIds">,
): Promise<AttachmentPreview> {
  if (entry.type === "CT") {
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

    const result = findCTAttachment(candidates, entry.occurredDate);
    return {
      assessmentId: result.matchId,
      matchedBy: result.matchId ? "ct-date" : null,
      ctOptions: result.options,
    };
  }

  // "CWM attaches to an open predicted window for that subject and type,
  // with chapter as a tiebreak only, never a requirement." Phase 6 (window
  // opening) isn't built yet, so `windows` is empty in practice today - this
  // still has to be wired correctly for when it isn't.
  const { data: windows } = await supabase
    .from("assessments")
    .select("id, created_at")
    .eq("student_id", userId)
    .eq("student_subject_id", entry.studentSubjectId)
    .eq("type", "CWM")
    .eq("status", "predicted")
    .is("window_closed_at", null);

  if (!windows || windows.length === 0) {
    return { assessmentId: null, matchedBy: null, ctOptions: [] };
  }

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

  const result = findCWMAttachment(candidates, entry.chapterIds[0] ?? null);
  return {
    assessmentId: result.matchId,
    matchedBy: result.matchedBy === "chapter" ? "cwm-chapter" : result.matchedBy === "oldest" ? "cwm-oldest" : null,
    ctOptions: [],
  };
}

/**
 * Read-only - the review screen calls this whenever subject, type, date or
 * chapter changes, so "this will attach to..." (and the "file as new
 * instead" way out of it) reflects whatever the form currently holds, not
 * the parse's original read. Nothing here is authoritative: confirmScanJob
 * re-runs the exact same resolveAttachment() at Save time rather than
 * trusting whatever this last returned, since the two calls can be
 * arbitrarily far apart and the candidate rows are not locked in between.
 */
export async function previewAttachment(
  entry: Pick<ConfirmEntry, "studentSubjectId" | "type" | "occurredDate" | "chapterIds">,
): Promise<AttachmentPreview> {
  const { supabase, userId } = await currentUser();
  return resolveAttachment(supabase, userId, entry);
}

/**
 * §5.3's "on confirm" - the one write that turns a reviewed parse into a
 * real result. Three things can't be one Postgres transaction with the rest,
 * structurally, not by choice:
 *
 *   0. Duplicate detection. "Match on student + subject + occurred_date +
 *      raw score; on a hit, offer attach these images to the existing
 *      result rather than rejecting the upload" (§5.3) - lib/scans/match.ts's
 *      findDuplicateResult, over candidates loaded here the same way the
 *      attachment decision below loads its own. A hit stops before anything
 *      is written and hands the caller a resultId to attach to instead
 *      (attachScanJobToResult) - `allowDuplicate` is how the caller says
 *      "save as new anyway" and skips this check on the retry.
 *   1. Deciding which assessment (if any) to attach to. CT and CWM
 *      attachment both need candidate rows read first (a scheduled CT for
 *      this subject; this subject's open predicted CWM windows) and a
 *      decision made in application code (findCTAttachment /
 *      findCWMAttachment, lib/scans/match.ts - not re-implemented here) -
 *      that decision has to exist before the RPC call it feeds into, so it
 *      cannot live inside the same statement as the writes it informs.
 *      Nothing here is written yet at this point; if it throws, nothing
 *      has happened.
 *   2. Moving the evidence images - moveScanImages() above.
 *
 * confirm_scan_job() (migration 0021) is everything else, DB-side, in one
 * statement: attach-or-create the assessment (a trigger already closes its
 * window on attach, untouched here), the result row via log_manual_result
 * (so §6's conversion, chapter_ids -> set_assessment_chapters, entry_mode,
 * name_mismatch and ocr_confidence all come from its one existing entry
 * shape rather than a second RPC), the result_images rows naming their
 * eventual scripts/ destinations, and the job flipping to 'confirmed'. That
 * whole step either fully happens or fully doesn't - if it throws, scan_jobs
 * is untouched and still 'review', exactly as resumable as it was before
 * Save was pressed.
 */
export async function confirmScanJob(
  jobId: string,
  entry: ConfirmEntry,
  options?: {
    allowDuplicate?: boolean;
    /** "File as a new assessment" (§5.3) - skip resolveAttachment() entirely,
     * even when it would otherwise find a match. */
    forceNew?: boolean;
    /** The student picked one of resolveAttachment()'s ctOptions by hand -
     * use it instead of recomputing. `undefined` means "not overridden";
     * unlike forceNew this is never `null` on its own (that's what forceNew
     * is for). */
    assessmentIdOverride?: string;
  },
): Promise<ConfirmResult> {
  const { supabase, userId } = await currentUser();

  // --- 0. Duplicate check - stops before anything is written. ---
  if (!options?.allowDuplicate) {
    const { data: subjectAssessments } = await supabase
      .from("assessments")
      .select("id, occurred_date")
      .eq("student_id", userId)
      .eq("student_subject_id", entry.studentSubjectId);

    const dateByAssessment = new Map(
      (subjectAssessments ?? []).map((a) => [a.id, a.occurred_date]),
    );
    const assessmentIds = [...dateByAssessment.keys()];

    const { data: existingResults } = assessmentIds.length
      ? await supabase
          .from("results")
          .select("id, assessment_id, raw_obtained, raw_total")
          .in("assessment_id", assessmentIds)
      : { data: [] };

    const candidates: ExistingResult[] = (existingResults ?? [])
      .map((r) => {
        const occurredDate = dateByAssessment.get(r.assessment_id);
        return occurredDate
          ? {
              id: r.id,
              studentSubjectId: entry.studentSubjectId,
              occurredDate,
              rawObtained: r.raw_obtained,
              rawTotal: r.raw_total,
            }
          : null;
      })
      .filter((c): c is ExistingResult => c !== null);

    const duplicate = findDuplicateResult(candidates, {
      studentSubjectId: entry.studentSubjectId,
      occurredDate: entry.occurredDate,
      rawObtained: entry.rawObtained,
      rawTotal: entry.rawTotal,
    });

    if (duplicate) {
      return { error: null, duplicateResultId: duplicate.id };
    }
  }

  // --- 1. Attach, or leave null and let confirm_scan_job create new. ---
  let assessmentId: string | null;

  if (options?.forceNew) {
    // "File as a new assessment" (§5.3) - the escape hatch on both an
    // auto-attach and a CT near-miss alike. The decision below is skipped
    // entirely rather than computed and discarded, so a window this scan
    // would otherwise have attached to is left untouched.
    assessmentId = null;
  } else if (options?.assessmentIdOverride !== undefined) {
    // The student picked a specific CT from resolveAttachment()'s ctOptions
    // (a near-miss the exact-date match didn't find) - that choice wins
    // outright, no re-derivation.
    assessmentId = options.assessmentIdOverride;
  } else {
    assessmentId = (await resolveAttachment(supabase, userId, entry)).assessmentId;
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

  // --- 3. The bytes. ---
  return moveScanImages(supabase, data as RpcResult);
}

/**
 * The other caller of attach_scan_job_to_result() (migration 0023) - "attach
 * paper later" (§5.3). Unlike confirmScanJob there is no decision to make:
 * the caller already knows which result this scan belongs to, either because
 * the student chose "Attach paper" on it directly (createScanJob's own
 * targetResultId carried that intent through capture and parse) or because
 * confirmScanJob's own duplicate check just found it. Steps 0 and 1 above
 * don't apply here at all - there's nothing to decide, only the RPC and the
 * same bytes-move-last aftermath.
 */
export async function attachScanJobToResult(
  jobId: string,
  resultId: string,
  entry: Pick<ConfirmEntry, "chapterIds" | "nameMismatch" | "parsedStudentName" | "ocrConfidence">,
): Promise<ConfirmResult> {
  const { supabase } = await currentUser();

  const { data, error } = await supabase.rpc("attach_scan_job_to_result", {
    p_job: jobId,
    p_result_id: resultId,
    p_entry: {
      chapter_ids: entry.chapterIds,
      name_mismatch: entry.nameMismatch,
      parsed_student_name: entry.parsedStudentName,
      ocr_confidence: entry.ocrConfidence,
    } as Json,
  });

  if (error) return { error: error.message };

  return moveScanImages(supabase, data as RpcResult);
}
