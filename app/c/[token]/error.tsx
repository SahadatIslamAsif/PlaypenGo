"use client";

import { CircleAlert } from "lucide-react";
import { useEffect } from "react";

// This route is a guardian's most common entry point, reached with no login
// and no nav chrome (see page.tsx's own header comment) - an unhandled throw
// here would otherwise be a bare crash page on the one screen a guardian is
// least equipped to recover from on their own. Mirrors the "Something went
// wrong" RPC-failure state page.tsx already renders for a known error, so an
// unknown one reads the same rather than as a different, scarier failure.
export default function ConfirmError({
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
    <main className="flex min-h-screen items-center justify-center px-3 py-12">
      <div className="w-full max-w-sm rounded-shell border border-hairline bg-shell p-8 text-center shadow-elevated">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-danger-tint text-danger">
          <CircleAlert size={24} strokeWidth={1.5} aria-hidden />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-ink">Something went wrong</h1>
        <p className="mt-2 text-sm text-body">
          Your answer wasn&apos;t recorded. Try again in a moment.
        </p>
        <button
          type="button"
          onClick={retry}
          className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-button bg-ink px-4 text-sm font-semibold text-shell transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
