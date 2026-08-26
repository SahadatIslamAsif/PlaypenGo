import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { RoutineScreen } from "./_components/routine-screen";
import { buildRoutineGrid, emptyRoutineGrid } from "@/lib/routines/grid";
import type { SubjectCandidate } from "@/lib/routines/resolve";
import { signRoutineImage } from "@/lib/routines/storage";
import { createClient } from "@/lib/supabase/server";

// All fetching happens here, as on /subjects: auth, then role, then the one
// student this page is about, then a single Promise.all. Nothing below this
// component talks to Supabase except the browser-direct photo upload, which
// has to.

export default async function RoutinePage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, session_label")
    .eq("id", user.id)
    .single();

  const role = profile?.role ?? "student";
  const { student } = await searchParams;

  const studentId = await resolveStudentId(supabase, user.id, role, student);

  if (!studentId) {
    return (
      <Card>
        <p className="text-sm font-semibold text-ink">Nothing to show yet</p>
        <p className="mt-1 text-sm text-muted">
          {role === "guardian"
            ? "Once your link is approved, your student's routine will appear here."
            : "Pick a student to see their routine."}
        </p>
      </Card>
    );
  }

  // §3.3 makes the routine writable by the student, and 0011's RPC extends that
  // to an approved tutor. A guardian gets the same screen with every control
  // removed rather than a redirect — the design system's guardian rule.
  const editable = role === "student" || role === "tutor";

  const [{ data: routine }, { data: subjects }, { data: aliases }] = await Promise.all([
    supabase
      .from("routines")
      .select("id, session_label, image_path, is_active")
      .eq("student_id", studentId)
      .eq("is_active", true)
      .maybeSingle(),
    supabase
      .from("student_subjects")
      .select("id, display_name, catalog_id")
      .eq("student_id", studentId)
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("subject_aliases")
      .select("alias_text, student_subject_id, catalog_id")
      .not("student_subject_id", "is", null),
  ]);

  const { data: periods } = routine
    ? await supabase
        .from("routine_periods")
        .select(
          "id, day_of_week, period_no, start_time, end_time, raw_text, teacher_raw, student_subject_id, is_academic",
        )
        .eq("routine_id", routine.id)
        .order("period_no")
    : { data: null };

  // Catalogue common_aliases as well as the student's own corrections: a fresh
  // tree has no captured aliases yet, and 'Add Math' should still resolve on
  // the very first routine anyone types.
  const catalogIds = (subjects ?? [])
    .map((s) => s.catalog_id)
    .filter((id): id is string => Boolean(id));

  const { data: catalog } = catalogIds.length
    ? await supabase
        .from("subjects_catalog")
        .select("id, common_aliases")
        .in("id", catalogIds)
    : { data: null };

  const catalogAliases = new Map(
    (catalog ?? []).map((c) => [c.id, c.common_aliases ?? []]),
  );

  const candidates: SubjectCandidate[] = (subjects ?? []).map((subject) => ({
    id: subject.id,
    display_name: subject.display_name,
    aliases: [
      ...(aliases ?? [])
        .filter((a) => a.student_subject_id === subject.id)
        .map((a) => a.alias_text),
      ...(subject.catalog_id ? (catalogAliases.get(subject.catalog_id) ?? []) : []),
    ],
  }));

  const rows = periods ?? [];
  const grid = rows.length > 0 ? buildRoutineGrid(rows) : emptyRoutineGrid();

  return (
    <RoutineScreen
      studentId={studentId}
      sessionLabel={routine?.session_label ?? profile?.session_label ?? "2026-2027"}
      editable={editable}
      // The client names the routine id so it can build the storage path before
      // the row exists; storage_owner() in 0003 parses it straight back out.
      routineId={routine?.id ?? randomUUID()}
      initialGrid={grid}
      initialImagePath={routine?.image_path ?? null}
      signedUrl={await signRoutineImage(supabase, routine?.image_path ?? null)}
      subjects={candidates}
      hasCommittedRoutine={rows.length > 0}
    />
  );
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function resolveStudentId(
  supabase: Supabase,
  userId: string,
  role: string,
  requested: string | undefined,
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

  // A tutor names the student in the query string. The roster that links here
  // is Phase 7; until then the first linked student is the sensible default,
  // and there is only one in practice.
  const { data } = await supabase
    .from("tutor_links")
    .select("student_id")
    .eq("tutor_id", userId)
    .eq("status", "approved");

  const linked = (data ?? []).map((l) => l.student_id);
  if (requested && linked.includes(requested)) return requested;
  return linked[0] ?? null;
}
