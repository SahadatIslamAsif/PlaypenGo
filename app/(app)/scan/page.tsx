import { redirect } from "next/navigation";
import { ScanScreen, type JobStatus, type SubmittedJob } from "./_components/scan-screen";
import { formatRaw } from "@/lib/assessments/marks";
import { createClient } from "@/lib/supabase/server";

// Scanning is a student-only action (§3.3, §5.3: "Scanning is a
// student-only action"; CLAUDE.md: "Only the student uploads papers").
// Unlike /routine or /results there is no degraded read-only view for a
// tutor or guardian here - they're sent home rather than shown a screen
// with every control removed, since there is nothing on this screen for
// either of them to read.
export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ attachTo?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if ((profile?.role ?? "student") !== "student") redirect("/");

  // §5.3's "Attach paper" entry point - a Link from a manually-logged
  // result, carrying which result to attach to. Re-derived from the DB
  // rather than trusted from the URL: the id must actually be this
  // student's own manually-logged result, or capture proceeds in ordinary
  // (non-attach) mode instead of silently attaching to the wrong thing.
  const { attachTo } = await searchParams;
  let attachTarget: { resultId: string; label: string } | null = null;

  if (attachTo) {
    const { data: target } = await supabase
      .from("results")
      .select("id, assessment_id, raw_obtained, raw_total, entry_mode")
      .eq("id", attachTo)
      .eq("student_id", user.id)
      .eq("entry_mode", "manual")
      .maybeSingle();

    if (target) {
      const { data: assessment } = await supabase
        .from("assessments")
        .select("student_subject_id")
        .eq("id", target.assessment_id)
        .maybeSingle();

      const { data: subject } = assessment
        ? await supabase
            .from("student_subjects")
            .select("display_name")
            .eq("id", assessment.student_subject_id)
            .maybeSingle()
        : { data: null };

      attachTarget = {
        resultId: target.id,
        label: `${subject?.display_name ?? "that result"} · ${formatRaw(target.raw_obtained, target.raw_total)}`,
      };
    }
  }

  // Every job this student has that isn't done yet - so a reload picks up
  // where it left off instead of losing every in-flight job to React
  // state. 'uploading' here can only mean the tab that started it died
  // before finishing (scan-screen.tsx never leaves a live upload at that
  // status); the screen surfaces it with a Discard action rather than
  // silently going quiet for up to 7 days until the TTL sweep gets to it.
  const { data: jobs } = await supabase
    .from("scan_jobs")
    .select("id, status, error")
    .eq("student_id", user.id)
    .in("status", ["uploading", "parsing", "review"])
    .order("created_at");

  const initialJobs: SubmittedJob[] = (jobs ?? []).map((job) => ({
    id: job.id,
    status: job.status as JobStatus,
    error: job.error,
  }));

  return <ScanScreen studentId={user.id} initialJobs={initialJobs} attachTarget={attachTarget} />;
}
