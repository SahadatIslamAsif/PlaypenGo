"use client";

import { RouteError } from "@/components/route-error";

// The catch-all for the (app) shell: the boundary for the dashboard itself
// (app/(app)/page.tsx has no error.tsx of its own to be more specific than
// this) and the fallback for any route under this group that doesn't define
// its own error.tsx. Each of subjects/results/routine/scan/settings/tutor
// has a more specific sibling that shadows this one.
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <RouteError
      error={error}
      retry={retry}
      title="Your dashboard didn't load"
      description="Something went wrong reaching the server. Check your connection and try again."
    />
  );
}
