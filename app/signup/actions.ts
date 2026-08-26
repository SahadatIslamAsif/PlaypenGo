"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type SignupState = { error: string | null };

export async function signUpAction(
  _prevState: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const role = String(formData.get("role") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!["student", "guardian", "tutor"].includes(role)) {
    return { error: "Choose a role to sign up." };
  }
  if (!fullName) {
    return { error: "Enter your full name." };
  }
  if (!email || !password) {
    return { error: "Enter your email and password." };
  }
  if (password.length < 8) {
    return { error: "Use a password of at least 8 characters." };
  }

  const data: Record<string, unknown> = { role, full_name: fullName };

  if (role === "student") {
    const classLevel = String(formData.get("class_level") ?? "");
    const section = String(formData.get("section") ?? "").trim();
    if (!classLevel) {
      return { error: "Choose your class level." };
    }
    data.class_level = classLevel;
    if (section) data.section = section;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data },
  });

  if (error) {
    // GoTrue wraps every handle_new_user() trigger failure in this generic
    // message and doesn't forward the raised reason to the client (it's in
    // the server logs only). For a tutor signup, the allowlist check is the
    // only thing besides full_name — already validated above — that trigger
    // can reject, so this is the specific, actionable reason to show.
    if (role === "tutor" && /database error/i.test(error.message)) {
      return { error: "This email is not approved for a tutor account." };
    }
    return { error: error.message };
  }

  redirect("/");
}
