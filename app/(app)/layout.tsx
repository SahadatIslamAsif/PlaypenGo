import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { BottomTabs } from "@/components/shell/bottom-tabs";
import { IconRail } from "@/components/shell/icon-rail";
import { SegmentedNav } from "@/components/shell/segmented-nav";
import { Sidebar } from "@/components/shell/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOutAction } from "@/lib/auth/actions";
import { createClient } from "@/lib/supabase/server";

// The design system's three breakpoints:
//
//   >=1024  sidebar 232 | main | (rail, composed by the page, not here)
//           all inside one rounded white shell floating on the wash
//   640-1023  sidebar collapses to a 72px icon rail
//   <640    shell dissolves — no rounded container, cards on the wash
//           at a 12px gutter, bottom tab bar (or, for the guardian, a
//           top segmented control instead)
//
// Sidebar and icon rail share one nav model (components/shell/nav-items.ts);
// only the rendering differs. The right rail itself is NOT rendered here —
// only the dashboard page has one, and Next parallel routes would need a
// default.tsx on every other route for no benefit, so the dashboard just
// renders a two-column grid inside <main>.

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("profiles").select("full_name, email, role").eq("id", user.id).single()
    : { data: null };

  const role = (profile?.role as "student" | "guardian" | "tutor" | undefined) ?? "student";

  return (
    <div className="min-h-screen bg-wash">
      {/* ---------------------------------------------------------- >=640 --- */}
      <div className="mx-auto hidden min-h-screen max-w-6xl sm:flex sm:flex-col sm:gap-4 sm:px-6 sm:py-6">
        <Header fullName={profile?.full_name ?? null} role={role} />
        {profile ? (
          <div className="flex flex-1 overflow-hidden rounded-shell border border-hairline bg-shell shadow-elevated">
            <div className="hidden lg:flex">
              <Sidebar fullName={profile.full_name} email={profile.email} role={role} />
            </div>
            <div className="flex lg:hidden">
              <IconRail role={role} />
            </div>
            <main className="min-w-0 flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        ) : (
          <main className="flex-1">{children}</main>
        )}
      </div>

      {/* ----------------------------------------------------------- <640 --- */}
      <div className="flex min-h-screen flex-col gap-4 pb-20 sm:hidden">
        <Header fullName={profile?.full_name ?? null} role={role} compact />
        {role === "guardian" && profile ? <SegmentedNav /> : null}
        <main className="flex-1 px-3">{children}</main>
        {profile && role !== "guardian" ? <BottomTabs role={role} /> : null}
      </div>
    </div>
  );
}

function Header({
  fullName,
  role,
  compact = false,
}: {
  fullName: string | null;
  role: string;
  compact?: boolean;
}) {
  return (
    <header
      className={`flex items-center justify-between border-hairline bg-surface px-4 py-3 ${
        compact ? "border-b" : "rounded-card border shadow-soft"
      }`}
    >
      <div>
        <p className="text-base font-semibold text-ink">PlaypenGo</p>
        {fullName ? (
          <p className="text-xs text-muted">
            {fullName} · <span className="capitalize">{role}</span>
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
  );
}
