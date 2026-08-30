import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { BottomTabs } from "@/components/shell/bottom-tabs";
import { IconRail } from "@/components/shell/icon-rail";
import { SegmentedNav } from "@/components/shell/segmented-nav";
import { Sidebar } from "@/components/shell/sidebar";
import { InstallPrompt } from "@/components/install-prompt";
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
//
// Scroll model, and it differs by branch on purpose:
//
//   >=640  the shell is pinned to the viewport (sm:h-dvh on the root) and
//          <main> is the only scrolling box, so the header, sidebar and the
//          Log out button pinned to its bottom never move. This only works
//          if every ancestor of <main> has a *definite* height — hence
//          h-dvh rather than min-h-screen, and min-h-0 on each flex item to
//          clear the default `min-height: auto` floor that would otherwise
//          keep them at content height.
//   <640   ordinary document scroll. BottomTabs is already `fixed`, so the
//          chrome stays put anyway, and pinning the branch to a viewport
//          height would cost env(safe-area-inset-bottom), momentum scroll
//          and URL-bar collapse for nothing.

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
    <div className="min-h-screen bg-wash sm:h-dvh sm:overflow-hidden">
      {/* ---------------------------------------------------------- >=640 --- */}
      <div className="mx-auto hidden max-w-6xl sm:flex sm:h-full sm:min-h-0 sm:flex-col sm:gap-4 sm:px-6 sm:py-6">
        <Header fullName={profile?.full_name ?? null} role={role} />
        {profile ? (
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-shell border border-hairline bg-shell shadow-elevated">
            <div className="hidden lg:flex">
              <Sidebar fullName={profile.full_name} email={profile.email} role={role} />
            </div>
            <div className="flex lg:hidden">
              <IconRail role={role} />
            </div>
            <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        ) : (
          <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        )}
      </div>

      {/* ----------------------------------------------------------- <640 --- */}
      <div className="flex min-h-screen flex-col gap-4 pb-nav-clear sm:hidden">
        <Header fullName={profile?.full_name ?? null} role={role} compact />
        {role === "guardian" && profile ? <SegmentedNav /> : null}
        <main className="flex-1 px-3">{children}</main>
        {profile && role !== "guardian" ? <BottomTabs role={role} /> : null}
      </div>

      {profile && role === "guardian" ? <InstallPrompt /> : null}
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
