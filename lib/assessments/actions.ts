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

/**
 * §8: "Assign / edit CT date on any chapter, with postpone." One action for
 * both — creating the assessment the first time, updating its scheduled_date
 * every time after. Ordinary table writes: 0013's policies (can_log_for) are
 * what authorize the tutor's use of this, same as everywhere else on these
 * two tables.
 */
export async function assignCTDate(input: {
  studentId: string;
  studentSubjectId: string;
  chapterId: string;
  assessmentId: string | null;
  date: string;
}): Promise<ActionState> {
  const { supabase, userId } = await currentUser();

  if (input.assessmentId) {
    const { error } = await supabase
      .from("assessments")
      .update({ scheduled_date: input.date, status: "scheduled" })
      .eq("id", input.assessmentId);

    if (error) return { error: error.message };
  } else {
    // 0017: chapter_id no longer lives on assessments - insert the row, then
    // link it to this chapter through the junction table, same as
    // log_manual_result() does for a manually-entered result.
    const { data, error } = await supabase
      .from("assessments")
      .insert({
        student_id: input.studentId,
        student_subject_id: input.studentSubjectId,
        type: "CT",
        status: "scheduled",
        scheduled_date: input.date,
        created_by: userId,
      })
      .select("id")
      .single();

    if (error) return { error: error.message };

    const { error: linkError } = await supabase.rpc("set_assessment_chapters", {
      p_assessment: data.id,
      p_chapters: [input.chapterId],
    });

    if (linkError) return { error: linkError.message };
  }

  revalidatePath("/subjects");
  revalidatePath("/");
  return { error: null };
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
 * Student-only at the table level (0013's delete policy) — a tutor who logs a
 * result on a student's behalf cannot also delete it, per §3.3's "cannot
 * delete student data." The button that calls this is hidden for everyone
 * else in the UI, and the policy is what actually holds if it weren't.
 */
export async function deleteResult(resultId: string): Promise<ActionState> {
  const { supabase } = await currentUser();

  const { error } = await supabase.from("results").delete().eq("id", resultId);
  if (error) return { error: error.message };

  revalidatePath("/results");
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
