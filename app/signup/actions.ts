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
  //
  // But "user present, no session" is not on its own evidence of a genuine
  // new signup — GoTrue collapses two other cases into that exact same
  // shape, specifically so a client can never tell them apart from a real
  // one by the shape alone (email enumeration protection):
  //
  //   1. The email is already registered AND confirmed. Verified directly
  //      against this project: the response has error: null, session: null,
  //      a fabricated user.id, and user_metadata that echoes back whatever
  //      this call just submitted (not the real account's data) - but
  //      user.identities is always [] for this case, which nothing else
  //      returned by signUp() ever is. That is the one field GoTrue can't
  //      fake without attaching a real identity, so it's the only reliable
  //      signal here.
  //   2. The email is registered but still unconfirmed, and this is a
  //      second signup attempt with different details (a typo'd role, a
  //      different family member reusing the address by mistake). Here
  //      GoTrue is not obfuscating - it returns the ORIGINAL pending
  //      signup's real identities and real user_metadata, silently
  //      discarding whatever this call just submitted. identities.length is
  //      > 0 (it's a real, non-fake identity), so case 1's check doesn't
  //      catch it - only comparing the returned metadata against what this
  //      submission actually sent does.
  //
  // A genuine first-time signup satisfies neither check: identities is
  // non-empty (a real identity was just created) and user_metadata is
  // exactly what was submitted, because it is what was submitted.
  if (signUpData.user && !signUpData.session) {
    if (!signUpData.user.identities || signUpData.user.identities.length === 0) {
      return {
        error: "This email already has an account. Sign in instead, or contact your tutor if the details need fixing.",
        confirmationSent: false,
        email: null,
      };
    }

    const returnedRole = signUpData.user.user_metadata?.role;
    const returnedName = signUpData.user.user_metadata?.full_name;
    if (returnedRole !== role || returnedName !== fullName) {
      return {
        error:
          "We already sent a confirmation link to this address — check your inbox, or contact your tutor if the details were wrong.",
        confirmationSent: false,
        email: null,
      };
    }

    return { error: null, confirmationSent: true, email };
  }

  redirect("/");
}
