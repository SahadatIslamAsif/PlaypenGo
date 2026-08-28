import { redirect } from "next/navigation";
import { ScanScreen } from "./_components/scan-screen";
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

  // No data fetch this pass - no scan_jobs query yet, so CLAUDE.md's
  // "skeleton-load, don't block the screen" rule has nothing to apply to.
  // That query (resuming a review left mid-parse, SPEC.md's "resumable
  // from scan_jobs if the tab is evicted") lands with the upload-wiring
  // pass; that's what will actually need a loading skeleton.
  return <ScanScreen studentId={user.id} />;
}
