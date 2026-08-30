import { redirect } from "next/navigation";
import Link from "next/link";
import { ReconciliationTable } from "./_components/reconciliation-table";
import { buildReconciliation } from "@/lib/assessments/reconciliation";
import { createClient } from "@/lib/supabase/server";

// §6: "End-of-semester reconciliation view: a table of the app's logged
// results beside a column for the portal's published figures, so anything
// the app missed is visible at the meeting. Low effort, high credibility."
//
// The portal has no API to read from, so its column is a plain input the
// tutor fills in by eye while sitting with it open - typed in live and never
// persisted. That keeps this screen inside CLAUDE.md's tutor write surface
// (0018's results_update, the sole tutor write) rather than opening a new
// one for a number that only ever matters for the length of one meeting; see
// docs/ARCHITECTURE.md §10, item 9 for the assumption this rests on.
export default async function ReconciliationPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if ((profile?.role ?? "student") !== "tutor") redirect("/");

  const { data: link } = await supabase
    .from("tutor_links")
    .select("id")
    .eq("tutor_id", user.id)
    .eq("student_id", studentId)
    .eq("status", "approved")
    .maybeSingle();

  if (!link) redirect("/tutor");

  const { data: studentProfile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", studentId)
    .single();

  const [{ data: subjects }, { data: assessments }, { data: results }] = await Promise.all([
    supabase
      .from("student_subjects")
      .select("id, display_name")
      .eq("student_id", studentId)
      .eq("is_active", true)
      .order("display_name"),
    supabase
      .from("assessments")
      .select("id, student_subject_id, paper_id, type, status, scheduled_date, occurred_date")
      .eq("student_id", studentId),
    supabase
      .from("results")
      .select("id, assessment_id, raw_obtained, raw_total, converted, percentage, paper_missing, entry_mode, logged_at")
      .eq("student_id", studentId),
  ]);

  const subjectRows = subjects ?? [];
  const assessmentRows = (assessments ?? []).map((a) => ({ ...a, type: a.type as "CT" | "CWM" }));
  const resultRows = (results ?? []).map((r) => ({ ...r, entry_mode: r.entry_mode as "ocr" | "manual" }));

  const rows = buildReconciliation(resultRows, assessmentRows, subjectRows);

  return (
    <div className="flex flex-col gap-5 pb-nav-clear lg:pb-0">
      <div>
        <Link href={`/tutor/${studentId}`} className="text-xs font-medium text-accent hover:underline">
          {studentProfile?.full_name ?? "Student"}
        </Link>
        <h1 className="mt-1 font-display text-xl font-semibold text-ink">Semester reconciliation</h1>
        <p className="mt-1 text-sm text-muted">
          Compare against the portal live at the meeting. Nothing typed into the Portal column here is saved.
        </p>
      </div>

      <ReconciliationTable rows={rows} />
    </div>
  );
}
