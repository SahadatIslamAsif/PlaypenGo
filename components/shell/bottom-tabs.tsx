"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BOTTOM_TABS, MORE_ITEM, SCAN } from "./nav-items";

// <640px, student and tutor only — the guardian uses SegmentedNav instead.
// Design system: "56px tall plus env(safe-area-inset-bottom). Icons at 20
// with a 11px label; active item takes --accent, not the black pill (a
// filled pill is too heavy at this size)."
//
// The raised --ink Scan circle overlaps this bar for the student only — "the
// tutor has no scan affordance anywhere" (CLAUDE.md), so the tutor's row
// below renders with no reserved gap for it, not an empty slot.
//
// Positioned at 40% rather than 50%: items = [Home, Subjects, Results,
// Routine, More] is 5 equal flex columns, and CLAUDE.md's ordering ("Home ·
// Subjects · Scan · Results · More") puts Scan right after Subjects — the
// boundary after the 2nd of 5 columns, i.e. 2/5.

export function BottomTabs({ role }: { role: "student" | "tutor" }) {
  const pathname = usePathname();
  const items = [...BOTTOM_TABS[role], MORE_ITEM];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-stretch border-t border-hairline bg-surface [padding-bottom:env(safe-area-inset-bottom)] sm:hidden"
      aria-label="Primary"
    >
      {items.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              active ? "text-accent" : "text-muted"
            }`}
          >
            <Icon className="h-5 w-5" strokeWidth={1.5} />
            {item.label}
          </Link>
        );
      })}

      {role === "student" ? (
        <Link
          href={SCAN.href}
          aria-label="Scan a paper"
          className="absolute top-0 z-40 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 border-surface bg-ink text-shell shadow-elevated transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          style={{ left: "40%" }}
        >
          <SCAN.icon className="h-6 w-6" strokeWidth={1.5} />
        </Link>
      ) : null}
    </nav>
  );
}
