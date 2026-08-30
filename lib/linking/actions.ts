"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type IssueCodeState = {
  code: string | null;
  expiresAt: string | null;
  error: string | null;
};

export async function issueLinkCode(): Promise<IssueCodeState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_link_code");

  if (error) {
    return { code: null, expiresAt: null, error: error.message };
  }

  revalidatePath("/");
  return { code: data.code, expiresAt: data.expires_at, error: null };
}

export type RedeemCodeState = { error: string | null };

export async function redeemLinkCode(
  _prevState: RedeemCodeState,
  formData: FormData,
): Promise<RedeemCodeState> {
  const code = String(formData.get("code") ?? "").trim();
  if (!code) {
    return { error: "Enter a code." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("redeem_link_code", { p_code: code });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/");
  return { error: null };
}

export type LinkActionState = { error: string | null };

export async function approveGuardianLink(linkId: string): Promise<LinkActionState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("guardian_links")
    .update({ status: "approved" })
    .eq("id", linkId);

  if (error) return { error: error.message };

  revalidatePath("/settings");
  revalidatePath("/");
  return { error: null };
}

export async function revokeGuardianLink(linkId: string): Promise<LinkActionState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("guardian_links")
    .update({ status: "revoked" })
    .eq("id", linkId);

  if (error) return { error: error.message };

  revalidatePath("/settings");
  revalidatePath("/");
  return { error: null };
}
