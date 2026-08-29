"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signUpAction, type SignupState } from "./actions";

const initialState: SignupState = { error: null };

export function SignupForm({ role }: { role: "student" | "guardian" | "tutor" }) {
  const [state, formAction, pending] = useActionState(signUpAction, initialState);

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
        <Input
          id="password"
          name="password"
          type="password"
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
