"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type SignupState = {
  error: string | null;
  confirmationSent: boolean;
  email: string | null;
};

export async function signUpAction(
  _prevState: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const role = String(formData.get("role") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (!["student", "guardian", "tutor"].includes(role)) {
    return { error: "Choose a role to sign up.", confirmationSent: false, email: null };
  }
  if (!fullName) {
    return { error: "Enter your full name.", confirmationSent: false, email: null };
  }
  if (!email || !password) {
    return { error: "Enter your email and password.", confirmationSent: false, email: null };
  }
  if (password.length < 8) {
    return {
      error: "Use a password of at least 8 characters.",
      confirmationSent: false,
      email: null,
    };
  }
  if (password !== confirmPassword) {
    return {
      error: "Password and confirm password don't match.",
      confirmationSent: false,
      email: null,
    };
  }

  const data: Record<string, unknown> = { role, full_name: fullName };

  if (role === "student") {
    const classLevel = String(formData.get("class_level") ?? "");
    const section = String(formData.get("section") ?? "").trim();
    if (!classLevel) {
      return { error: "Choose your class level.", confirmationSent: false, email: null };
    }
    data.class_level = classLevel;
    if (section) data.section = section;
  }

  const supabase = await createClient();
  const { data: signUpData, error } = await supabase.auth.signUp({
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
      return {
        error: "This email is not approved for a tutor account.",
        confirmationSent: false,
        email: null,
      };
    }
    return { error: error.message, confirmationSent: false, email: null };
  }

  // supabase/config.toml's auth.email.enable_confirmations = true means
  // signUp never returns a session directly — a session only exists once the
  // person clicks the link in app/auth/confirm/route.ts. Redirecting to "/"
  // here would just bounce straight back to /login with nothing explaining
  // why, so show the confirmation-pending state instead.
  if (signUpData.user && !signUpData.session) {
    return { error: null, confirmationSent: true, email };
  }

  redirect("/");
}
