import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { RosterList } from "./_components/roster-list";
import { buildRoster, type RosterStudentInput } from "@/lib/tutor/roster";
import { localDate } from "@/lib/routines/schedule";
import { buildUpcoming } from "@/lib/assessments/upcoming";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

// §8's tutor dashboard: "All linked students in one table, with tomorrow's
// load and an unlogged count per student — the primary signal on this
// screen." CLAUDE.md bans an actual table ("Tables become cards... No
// horizontal scrolling of table rows, ever"), so this is a card list on
// every breakpoint rather than a table that degrades on mobile — one layout
// instead of two.
//
// Tutor-only. A student or guardian typing this URL is sent home, same
// pattern /scan uses for its own student-only gate.
export default async function TutorRosterPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if ((profile?.role ?? "student") !== "tutor") redirect("/");

  const { data: links } = await supabase
    .from("tutor_links")
    .select("student_id, student:profiles!tutor_links_student_id_fkey(full_name)")
    .eq("tutor_id", user.id)
    .eq("status", "approved");

  const students = links ?? [];

  if (students.length === 0) {
    return (
      <Card>
        <p className="text-sm font-semibold text-ink">No students yet</p>
        <p className="mt-1 text-sm text-muted">
          Share your code from Settings to start tutoring a student.
        </p>
      </Card>
    );
  }

  const { count: pendingApprovals } = await supabase
    .from("guardian_links")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .in(
      "student_id",
      students.map((s) => s.student_id),
    );

  const today = localDate(new Date());
  const rosterInputs = await Promise.all(
    students.map((s) => loadRosterInput(supabase, s.student_id, s.student?.full_name ?? "Student", today)),
  );

  const roster = buildRoster(rosterInputs, today);

  return (
    <div className="flex flex-col gap-5 pb-nav-clear lg:pb-0">
      <h1 className="font-display text-xl font-semibold text-ink">Students</h1>

      {pendingApprovals ? (
        <a
          href="/settings"
          className="block rounded-tint bg-tint-sage px-4 py-3 text-sm font-medium text-tint-ink transition-colors hover:bg-tint-sage/80"
        >
          {pendingApprovals} guardian {pendingApprovals === 1 ? "approval" : "approvals"} waiting in
          Settings
        </a>
      ) : null}

      <RosterList rows={roster} />
    </div>
  );
}

async function loadRosterInput(
  supabase: SupabaseClient<Database>,
  studentId: string,
  studentName: string,
  today: string,
): Promise<RosterStudentInput> {
  const [{ data: subjects }, { data: assessments }, { data: chapters }, { data: routine }, { data: results }] =
    await Promise.all([
      supabase.from("student_subjects").select("id, display_name").eq("student_id", studentId).eq("is_active", true),
      supabase
        .from("assessments")
        .select("id, student_subject_id, paper_id, type, status, scheduled_date, occurred_date")
        .eq("student_id", studentId),
      supabase.from("chapters").select("id, student_subject_id, status").eq("student_id", studentId),
      supabase.from("routines").select("id").eq("student_id", studentId).eq("is_active", true).maybeSingle(),
      supabase
        .from("results")
        .select("percentage, logged_at")
        .eq("student_id", studentId)
        .order("logged_at", { ascending: false })
        .limit(20),
    ]);

  const { data: routinePeriods } = routine
    ? await supabase
        .from("routine_periods")
        .select("id, day_of_week, period_no, start_time, end_time, raw_text, teacher_raw, student_subject_id, is_academic")
        .eq("routine_id", routine.id)
    : { data: null };

  const { data: assessmentChapters } = await supabase
    .from("assessment_chapters")
    .select("assessment_id, chapter_id")
    .eq("student_id", studentId);

  const subjectRows = subjects ?? [];
  const assessmentRows = (assessments ?? []).map((a) => ({ ...a, type: a.type as "CT" | "CWM" }));
  const chapterRows = (chapters ?? []).filter(
    (c): c is typeof c & { status: "p80" | "p100" } => c.status === "p80" || c.status === "p100",
  );

  const upcoming = buildUpcoming(
    assessmentRows,
    chapterRows,
    assessmentChapters ?? [],
    routinePeriods ?? [],
    subjectRows,
    today,
  );

  return {
    studentId,
    studentName,
    assessments: assessmentRows,
    upcoming,
    recentPercentages: (results ?? []).map((r) => Number(r.percentage)),
  };
}
