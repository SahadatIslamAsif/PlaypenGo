"use client";

import { RouteError } from "@/components/route-error";

export default function StudentDrilldownError({
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
      title="This student's page didn't load"
      description="Something went wrong reaching the server. Check your connection and try again."
    />
  );
}
