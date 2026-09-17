import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";

export default function AuthCodeErrorPage() {
  return (
    <AuthShell
      title="This link didn't work"
      subtitle="It may have already been used, or it's expired."
    >
      <p className="text-sm text-body">
        Sign up again to get a fresh confirmation email, or sign in if you&apos;ve already confirmed.
      </p>
      <div className="mt-6 flex flex-col gap-3">
        <Link
          href="/signup"
          className="inline-flex h-10 items-center justify-center rounded-button bg-ink px-4 text-sm font-medium text-shell transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Sign up again
        </Link>
        <Link
          href="/login"
          className="inline-flex h-10 items-center justify-center rounded-button border border-hairline bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-surface-sunk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Sign in
        </Link>
      </div>
    </AuthShell>
  );
}
