"use client";

import { RouteError } from "@/components/route-error";

export default function ScanReviewError({
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
      title="The review screen didn't load"
      description="Your scan is saved and waiting - check your connection and try again."
    />
  );
}
