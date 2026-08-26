// Which student's data a signed-in viewer should see. The same three-way
// branch was written inline in both app/(app)/subjects/page.tsx and
// app/(app)/routine/page.tsx; this is the canonical version, used by the
// dashboard and results pages this phase adds. The two earlier pages are
// left as they are — they work and are already covered by manual
// verification — but any of the three could adopt this going forward.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export async function resolveViewedStudentId(
  supabase: SupabaseClient<Database>,
  userId: string,
  role: string | undefined,
  requestedStudentId: string | undefined,
): Promise<string | null> {
  if (role === "student") return userId;

  if (role === "guardian") {
    const { data } = await supabase
      .from("guardian_links")
      .select("student_id")
      .eq("guardian_id", userId)
      .eq("status", "approved")
      .limit(1)
      .maybeSingle();
    return data?.student_id ?? null;
  }

  // Tutor: the roster to pick a student from is Phase 7. Until then, a
  // `?student=` param selects among linked students and the first linked
  // student is the default — there is only one in practice.
  const { data } = await supabase
    .from("tutor_links")
    .select("student_id")
    .eq("tutor_id", userId)
    .eq("status", "approved");

  const linked = (data ?? []).map((link) => link.student_id);
  if (requestedStudentId && linked.includes(requestedStudentId)) return requestedStudentId;
  return linked[0] ?? null;
}
