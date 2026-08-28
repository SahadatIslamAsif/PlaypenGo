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

export type CommitResult = {
  error: string | null;
  routineId?: string;
  periodsCommitted?: number;
};

/**
 * The whole-grid path. Both authorization and the write live in
 * commit_routine_grid() (migration 0011, guard narrowed by 0019) — this only
 * carries the payload across. The check is inside the function because it is
 * SECURITY DEFINER: no policy ever sees these writes, so nothing else could
 * hold the line.
 */
export async function commitRoutineGrid(
  studentId: string,
  grid: unknown,
  sessionLabel: string,
): Promise<CommitResult> {
  const { supabase } = await currentUser();

  const { data, error } = await supabase.rpc("commit_routine_grid", {
    p_student: studentId,
    p_grid: grid as Json,
    p_session: sessionLabel,
  });

  if (error) return { error: error.message };

  const result = (data ?? {}) as {
    routine_id?: string;
    periods_committed?: number;
  };

  revalidatePath("/routine");
  return {
    error: null,
    routineId: result.routine_id,
    periodsCommitted: result.periods_committed,
  };
}

/**
 * The single-cell path, for a routine already in force. `patch` is passed
 * through as sent: an absent key means "leave it alone" and an explicit null
 * means "clear it", and the RPC reads it key by key to keep that distinction.
 */
export async function updateRoutinePeriod(
  periodId: string,
  patch: Record<string, unknown>,
): Promise<ActionState> {
  const { supabase } = await currentUser();

  const { error } = await supabase.rpc("update_routine_period", {
    p_period: periodId,
    p_patch: patch as Json,
  });

  if (error) return { error: error.message };

  revalidatePath("/routine");
  return { error: null };
}

// A photo is attached by committing the grid with its `image_path` set, not by
// a separate update. `routines` is student-only at the table level, so a direct
// UPDATE from anyone else would silently write nothing — the RLS predicate
// filters rather than errors, which is the failure mode 0009's header warns
// about. The commit is idempotent, so re-sending an unchanged grid to record a
// new photo costs nothing.
