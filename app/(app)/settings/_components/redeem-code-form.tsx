"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { redeemLinkCode, type RedeemCodeState } from "@/lib/linking/actions";

const initialState: RedeemCodeState = { error: null };

export function RedeemCodeForm({
  title,
  description,
  placeholder,
}: {
  title: string;
  description: string;
  placeholder: string;
}) {
  const [state, formAction, pending] = useActionState(redeemLinkCode, initialState);

  return (
    <Card>
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-0.5 text-xs text-muted">{description}</p>
      <form action={formAction} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
        <Input
          name="code"
          placeholder={placeholder}
          maxLength={6}
          autoCapitalize="characters"
          className="uppercase tracking-[0.2em]"
          required
        />
        <Button type="submit" disabled={pending} className="sm:shrink-0">
          {pending ? "Checking…" : "Link"}
        </Button>
      </form>
      {state.error ? <p className="mt-2 text-xs text-danger">{state.error}</p> : null}
    </Card>
  );
}
