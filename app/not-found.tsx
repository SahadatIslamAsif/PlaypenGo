import { Compass } from "lucide-react";
import Link from "next/link";

// A generic 404 for a mistyped or stale URL - renders inside the root
// layout (globals.css, theme, fonts all still apply), so it's the ordinary
// Tailwind styling used everywhere else, not global-error.tsx's inline-style
// fallback. No sidebar/shell here since a viewer landing on a broken link
// may not be signed in at all - same "standalone page, no assumed session"
// reasoning as /c/[token].
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-wash px-3 py-12">
      <div className="w-full max-w-sm rounded-shell border border-hairline bg-shell p-8 text-center shadow-elevated">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunk text-muted">
          <Compass size={24} strokeWidth={1.5} aria-hidden />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-ink">Page not found</h1>
        <p className="mt-2 text-sm text-body">
          This link doesn&apos;t point anywhere in PlaypenGo. It may be out of date.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-button bg-ink px-4 text-sm font-semibold text-shell transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
