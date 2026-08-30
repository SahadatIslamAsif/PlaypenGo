import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { createClient } from "@/lib/supabase/server";
import { CodeCard } from "./code-card";
import { GuardianApprovalRow } from "./guardian-approval-row";

export async function TutorSettings({ userId }: { userId: string }) {
  const supabase = await createClient();

  const [{ data: liveCode }, { data: pendingLinks }, { data: students }] = await Promise.all([
    supabase
      .from("link_codes")
      .select("code, expires_at")
      .eq("owner_id", userId)
      .eq("kind", "tutor")
      .is("used_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("guardian_links")
      .select(
        "id, status, guardian:profiles!guardian_links_guardian_id_fkey(full_name), student:profiles!guardian_links_student_id_fkey(full_name)",
      )
      .eq("status", "pending"),
    supabase
      .from("tutor_links")
      .select("id, status, student:profiles!tutor_links_student_id_fkey(full_name)")
      .eq("tutor_id", userId)
      .eq("status", "approved"),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <CodeCard
        title="Your code"
        description="Share this with a student to start tutoring them. Valid 7 days, one use."
        initialCode={liveCode?.code ?? null}
        initialExpiresAt={liveCode?.expires_at ?? null}
      />

      <Card>
        <p className="text-sm font-semibold text-ink">Guardian approvals</p>
        <div className="mt-3 flex flex-col gap-3">
          {!pendingLinks?.length ? (
            <p className="text-xs text-muted">No guardians waiting for approval.</p>
          ) : (
            pendingLinks.map((link) => (
              <GuardianApprovalRow
                key={link.id}
                linkId={link.id}
                guardianName={link.guardian?.full_name ?? "A guardian"}
                studentName={link.student?.full_name ?? "a student"}
              />
            ))
          )}
        </div>
      </Card>

      <Card>
        <p className="text-sm font-semibold text-ink">Your students</p>
        <div className="mt-3 flex flex-col gap-2">
          {!students?.length ? (
            <p className="text-xs text-muted">No students yet. Share your code to get started.</p>
          ) : (
            students.map((link) => (
              <div key={link.id} className="flex items-center justify-between">
                <p className="text-sm text-body">{link.student?.full_name ?? "Student"}</p>
                <StatusPill status="approved" />
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
