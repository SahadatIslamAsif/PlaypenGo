import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { createClient } from "@/lib/supabase/server";
import { RedeemCodeForm } from "./redeem-code-form";

export async function GuardianSettings({ userId }: { userId: string }) {
  const supabase = await createClient();

  const { data: links } = await supabase
    .from("guardian_links")
    .select("id, status, student:profiles!guardian_links_student_id_fkey(full_name)")
    .eq("guardian_id", userId);

  return (
    <div className="flex flex-col gap-5">
      {links?.map((link) => (
        <Card key={link.id}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-ink">
              {link.student?.full_name ?? "Your student"}
            </p>
            <StatusPill status={link.status as "pending" | "approved" | "revoked"} />
          </div>
          <p className="mt-2 text-sm text-body">
            {link.status === "pending"
              ? "Almost there. Ask your tutor to approve the link — you'll see results once they do."
              : link.status === "approved"
                ? "You're linked and reading in real time."
                : "This link was revoked. Ask for a new code to reconnect."}
          </p>
        </Card>
      ))}

      <RedeemCodeForm
        title={links?.length ? "Link to another student" : "Link to your student"}
        description="Enter the family code your student shared with you."
        placeholder="Family code"
      />
    </div>
  );
}
