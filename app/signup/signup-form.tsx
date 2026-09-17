"use client";

import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { signUpAction, type SignupState } from "./actions";

const initialState: SignupState = { error: null, confirmationSent: false, email: null };

export function SignupForm({ role }: { role: "student" | "guardian" | "tutor" }) {
  const [state, formAction, pending] = useActionState(signUpAction, initialState);

  if (state.confirmationSent) {
    return (
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunk text-accent">
          <MailCheck size={24} strokeWidth={1.5} aria-hidden />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-ink">Please confirm your email</h2>
        <p className="mt-2 text-sm text-body">
          {state.email ? (
            <>
              We sent a confirmation link to <span className="font-medium text-ink">{state.email}</span>.{" "}
            </>
          ) : null}
          Open it to activate your {role} account. Confirm your email to continue.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="role" value={role} />

      <Field label="Full name" htmlFor="full_name">
        <Input id="full_name" name="full_name" autoComplete="name" required />
      </Field>
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password">
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </Field>
      <Field label="Confirm password" htmlFor="confirm_password">
        <PasswordInput
          id="confirm_password"
          name="confirm_password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </Field>

      {role === "student" ? (
        <>
          <Field label="Class level" htmlFor="class_level">
            <Input
              id="class_level"
              name="class_level"
              type="number"
              inputMode="numeric"
              min={1}
              max={12}
              placeholder="8"
              required
            />
          </Field>
          <Field label="Section" htmlFor="section">
            <Input id="section" name="section" placeholder="Marigold" />
          </Field>
        </>
      ) : null}

      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating account…" : "Create account"}
      </Button>

      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent">
          Sign in
        </Link>
      </p>
    </form>
  );
}
