"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { changePasswordAction, type ChangePasswordState } from "@/lib/auth/actions";

const initialState: ChangePasswordState = { error: null, success: false };

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state.success]);

  return (
    <Card>
      <p className="text-sm font-semibold text-ink">Change password</p>
      <p className="mt-0.5 text-xs text-muted">
        Enter your current password, then choose a new one.
      </p>
      <form ref={formRef} action={formAction} className="mt-4 flex flex-col gap-4">
        <Field label="Current password" htmlFor="current_password">
          <PasswordInput
            id="current_password"
            name="current_password"
            autoComplete="current-password"
            required
          />
        </Field>
        <Field label="New password" htmlFor="new_password">
          <PasswordInput
            id="new_password"
            name="new_password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>
        <Field label="Confirm new password" htmlFor="confirm_password">
          <PasswordInput
            id="confirm_password"
            name="confirm_password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>

        {state.error ? <p className="text-xs text-danger">{state.error}</p> : null}
        {state.success ? <p className="text-xs text-accent">Password updated.</p> : null}

        <Button type="submit" disabled={pending} className="sm:self-start">
          {pending ? "Updating…" : "Update password"}
        </Button>
      </form>
    </Card>
  );
}
