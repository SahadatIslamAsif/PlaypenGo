import { Check, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { approveGuardianLink, revokeGuardianLink } from "@/lib/linking/actions";
import { createClient } from "@/lib/supabase/server";
import { CodeCard } from "./code-card";

export async function TutorHome({ userId }: { userId: string }) {
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
              <div
                key={link.id}
                className="flex items-center justify-between rounded-tint bg-tint-sage px-3 py-2"
              >
                <div>
                  <p className="text-sm text-tint-ink">
                    {link.guardian?.full_name ?? "A guardian"}
                  </p>
                  <p className="text-xs text-tint-ink/60">
                    wants to follow {link.student?.full_name ?? "a student"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <form action={approveGuardianLink}>
                    <input type="hidden" name="link_id" value={link.id} />
                    <button
                      type="submit"
                      aria-label="Approve"
                      className="flex h-9 w-9 items-center justify-center rounded-button bg-ink text-shell transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <Check className="h-4 w-4" strokeWidth={2} />
                    </button>
                  </form>
                  <form action={revokeGuardianLink}>
                    <input type="hidden" name="link_id" value={link.id} />
                    <button
                      type="submit"
                      aria-label="Deny"
                      className="flex h-9 w-9 items-center justify-center rounded-button bg-white text-tint-ink transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <X className="h-4 w-4" strokeWidth={2} />
                    </button>
                  </form>
                </div>
              </div>
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
