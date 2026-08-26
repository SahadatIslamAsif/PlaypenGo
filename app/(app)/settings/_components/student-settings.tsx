import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { createClient } from "@/lib/supabase/server";
import { CodeCard } from "./code-card";
import { RedeemCodeForm } from "./redeem-code-form";

// §8: "Settings — theme, family code, notification prefs." Theme lives in the
// header (ThemeToggle, always visible); this is the family-code and linking
// half, moved here unchanged from what was the whole of the dashboard before
// the shell rebuild gave Home a real dashboard to show instead.

export async function StudentSettings({ userId }: { userId: string }) {
  const supabase = await createClient();

  const [{ data: liveCode }, { data: guardianLinks }, { data: tutorLinks }] = await Promise.all([
    supabase
      .from("link_codes")
      .select("code, expires_at")
      .eq("owner_id", userId)
      .eq("kind", "guardian")
      .is("used_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("guardian_links")
      .select("id, status, guardian:profiles!guardian_links_guardian_id_fkey(full_name)")
      .eq("student_id", userId),
    supabase
      .from("tutor_links")
      .select("id, status, tutor:profiles!tutor_links_tutor_id_fkey(full_name)")
      .eq("student_id", userId),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <CodeCard
        title="Your family code"
        description="Share this with your guardian. Valid 7 days, one use."
        initialCode={liveCode?.code ?? null}
        initialExpiresAt={liveCode?.expires_at ?? null}
      />

      <RedeemCodeForm
        title="Link to a tutor"
        description="Enter the code your tutor gave you."
        placeholder="Tutor code"
      />

      <Card>
        <p className="text-sm font-semibold text-ink">Linked people</p>
        <div className="mt-3 flex flex-col gap-2">
          {!guardianLinks?.length && !tutorLinks?.length ? (
            <p className="text-xs text-muted">No one linked yet.</p>
          ) : null}
          {guardianLinks?.map((link) => (
            <div key={link.id} className="flex items-center justify-between">
              <p className="text-sm text-body">
                {link.guardian?.full_name ?? "Guardian"} · guardian
              </p>
              <StatusPill status={link.status as "pending" | "approved" | "revoked"} />
            </div>
          ))}
          {tutorLinks?.map((link) => (
            <div key={link.id} className="flex items-center justify-between">
              <p className="text-sm text-body">{link.tutor?.full_name ?? "Tutor"} · tutor</p>
              <StatusPill status={link.status as "pending" | "approved" | "revoked"} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
