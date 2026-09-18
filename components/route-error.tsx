"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Shared body for every route-level error.tsx under app/(app). Each route
 * passes its own title/description (CLAUDE.md's copy rule: state what
 * happened, no apology, no system internals) so the fallback names the
 * actual screen instead of the generic "This page didn't load" that used to
 * cover every route through the shared (app)/error.tsx alone.
 */
export function RouteError({
  error,
  retry,
  title,
  description,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  title: string;
  description: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="max-w-sm text-center">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-1 text-sm text-muted">{description}</p>
        <Button type="button" onClick={retry} className="mt-4 w-full">
          Try again
        </Button>
      </Card>
    </div>
  );
}
