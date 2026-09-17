"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

export type ActionState = { error: string | null };

async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return { supabase, userId: user.id };
}

export type SaveCTState = { error: string | null; assessmentId?: string };

/**
 * §8's "Schedule a CT" / postpone / rename, now subject-level rather than
 * per-chapter (a CT stops belonging to one chapter once it can span
 * several — 0017's assessment_chapters). Thin wrapper over save_ct() (0031),
 * which does the insert-or-update plus set_assessment_chapters() atomically —
 * the atomicity assignCTDate()'s old UPDATE branch never had, since it wrote
 * scheduled_date directly and never touched chapter links at all.
 */
export async function saveCT(
  studentId: string,
  entry: Record<string, unknown>,
): Promise<SaveCTState> {
  const { supabase } = await currentUser();

  const { data, error } = await supabase.rpc("save_ct", {
    p_student: studentId,
    p_entry: entry as Json,
  });

  if (error) return { error: error.message };

  const result = (data ?? {}) as { assessment_id?: string };

  revalidatePath("/subjects");
  revalidatePath("/results");
  revalidatePath("/");
  return { error: null, assessmentId: result.assessment_id };
}

/** §8's cancel path: sets status, leaves the row (and any history) in place. */
export async function cancelCT(assessmentId: string): Promise<ActionState> {
  const { supabase } = await currentUser();

  const { error } = await supabase
    .from("assessments")
    .update({ status: "cancelled" })
    .eq("id", assessmentId);

  if (error) return { error: error.message };

  revalidatePath("/subjects");
  revalidatePath("/");
  return { error: null };
}

/**
 * Student-only at the table level (0018's delete policy). §3.3 withholds
 * DELETE from the tutor even now that their reach is a single UPDATE: a
 * mis-keyed mark is corrected in place, never removed. The button that calls
 * this is hidden for everyone else in the UI, and the policy is what actually
 * holds if it weren't.
 */
export async function deleteResult(resultId: string): Promise<ActionState> {
  const { supabase } = await currentUser();

  const { error } = await supabase.from("results").delete().eq("id", resultId);
  if (error) return { error: error.message };

  revalidatePath("/results");
  revalidatePath("/");
  return { error: null };
}

export type CorrectResultState = { error: string | null };

/**
 * §3.3's sole tutor write, authorized by 0018's can_correct_result(): the
 * student, or their approved tutor, may UPDATE a result - never INSERT one.
 * Only raw_obtained/raw_total/paper_missing are writable here; `converted`
 * and `percentage` are generated columns (0013, made NOT NULL by 0015) and
 * recompute from the raw fields automatically. No assessment or chapter
 * link is touched - correcting a wrong mark beside the student is a
 * different act from creating one (0018's own framing for the policy this
 * calls through).
 */
export async function correctResult(
  resultId: string,
  rawObtained: number,
  rawTotal: number,
  paperMissing: boolean,
): Promise<CorrectResultState> {
  const { supabase } = await currentUser();

  const { error } = await supabase
    .from("results")
    .update({ raw_obtained: rawObtained, raw_total: rawTotal, paper_missing: paperMissing })
    .eq("id", resultId);

  if (error) return { error: error.message };

  revalidatePath("/results");
  revalidatePath("/tutor");
  revalidatePath("/");
  return { error: null };
}

export type SaveResultState = {
  error: string | null;
  percentage?: number;
  converted?: number;
};

/**
 * §5.3's manual entry form. Thin wrapper over log_manual_result() (migration
 * 0014) — the RPC does the real work (atomicity, both entry shapes); this is
 * just the server-action boundary Next needs.
 */
export async function saveManualResult(
  studentId: string,
  entry: Record<string, unknown>,
): Promise<SaveResultState> {
  const { supabase } = await currentUser();

  const { data, error } = await supabase.rpc("log_manual_result", {
    p_student: studentId,
    p_entry: entry as Json,
  });

  if (error) return { error: error.message };

  const result = (data ?? {}) as { percentage?: number; converted?: number };

  revalidatePath("/results");
  revalidatePath("/");
  revalidatePath("/subjects");
  return { error: null, percentage: result.percentage, converted: result.converted };
}
