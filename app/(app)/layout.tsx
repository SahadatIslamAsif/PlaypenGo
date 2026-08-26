import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { NavLinks } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOutAction } from "@/lib/auth/actions";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("profiles").select("full_name, role").eq("id", user.id).single()
    : { data: null };

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between rounded-card border border-hairline bg-surface px-4 py-3 shadow-soft">
        <div>
          <p className="text-base font-semibold text-ink">PlaypenGo</p>
          {profile ? (
            <p className="text-xs text-muted">
              {profile.full_name} · <span className="capitalize">{profile.role}</span>
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <form action={signOutAction}>
            <button
              type="submit"
              aria-label="Log out"
              className="flex h-11 w-11 items-center justify-center rounded-[14px] border border-hairline bg-surface text-body transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <LogOut className="h-[18px] w-[18px]" strokeWidth={1.5} />
            </button>
          </form>
        </div>
      </header>
      {/* The tutor's roster is Phase 7, so /subjects still redirects them away.
          /routine does not — it resolves a linked student, which is how a tutor
          sets up a routine during a session. */}
      {profile ? (
        <NavLinks
          links={[
            ...(profile.role === "tutor"
              ? []
              : [
                  { href: "/", label: "Home" },
                  { href: "/subjects", label: "Subjects" },
                ]),
            { href: "/routine", label: "Routine" },
          ]}
        />
      ) : null}
      <main className="flex-1">{children}</main>
    </div>
  );
}
