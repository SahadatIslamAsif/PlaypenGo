import { redirect } from "next/navigation";
import { ScanScreen, type JobStatus, type SubmittedJob } from "./_components/scan-screen";
import { createClient } from "@/lib/supabase/server";

// Scanning is a student-only action (§3.3, §5.3: "Scanning is a
// student-only action"; CLAUDE.md: "Only the student uploads papers").
// Unlike /routine or /results there is no degraded read-only view for a
// tutor or guardian here - they're sent home rather than shown a screen
// with every control removed, since there is nothing on this screen for
// either of them to read.
export default async function ScanPage() {
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

  return <ScanScreen studentId={user.id} initialJobs={initialJobs} />;
}
