"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Wraps every route under the (app) shell (/, /subjects, /routine, /scan,
// /results, /settings, /tutor*) - each does a multi-query Supabase fetch on
// the server, so a dropped connection or an unexpected throw anywhere in
// that tree previously fell straight through to Next's generic crash page.
// CLAUDE.md's copy rule: "Errors state what happened and what to do next;
// they do not apologise or hedge."
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="max-w-sm text-center">
        <p className="text-sm font-semibold text-ink">This page didn&apos;t load</p>
        <p className="mt-1 text-sm text-muted">
          Something went wrong reaching the server. Check your connection and try again.
        </p>
        <Button type="button" onClick={retry} className="mt-4 w-full">
          Try again
        </Button>
      </Card>
    </div>
  );
}
