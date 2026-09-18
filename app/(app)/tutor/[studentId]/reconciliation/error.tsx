"use client";

import { RouteError } from "@/components/route-error";

export default function ReconciliationError({
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
      title="The reconciliation table didn't load"
      description="Something went wrong reaching the server. Check your connection and try again."
    />
  );
}
