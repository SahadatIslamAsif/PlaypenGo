"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { BOTTOM_TABS, MORE_ITEM, MORE_SHEET_ITEMS, SCAN } from "./nav-items";

// <640px, student and tutor only — the guardian uses SegmentedNav instead.
// Design system: "56px tall plus env(safe-area-inset-bottom). Icons at 20
// with a 11px label; active item takes --accent, not the black pill (a
// filled pill is too heavy at this size)."
//
// The raised --ink Scan circle overlaps this bar for the student only — "the
// tutor has no scan affordance anywhere" (CLAUDE.md) — centred at exactly
// left-1/2. That only lands in the gap between Subjects and Results (never
// on top of a tab) because the student's own tabs (nav-items.ts) are four:
// two either side of the circle. The tutor has no circle to centre around,
// so their bar is unaffected and "More" stays a direct link.
//
// For the student, "More" now has two destinations behind it (Routine +
// Settings, see MORE_SHEET_ITEMS) rather than one, so it opens a Sheet
// instead of navigating directly — nav-items.ts's MORE_ITEM already
// anticipated this ("once a second secondary destination exists it becomes
// a sheet instead of a direct link").
//
// The circle has no border. It sits over two different backgrounds at once
// (the mint wash above, the white tab bar below) — no single border colour
// works for both, and a border was never the right tool anyway: "Separation
// comes from the wash behind white cards, never from heavy borders"
// (CLAUDE.md). Its shadow is deliberately stronger than the shared
// shadow-elevated token (a card's own shadow-elevated would be too faint
// here, this is a raised control, not a resting card) — deepen this value
// again if it ever needs more lift; never reintroduce a border.

export function BottomTabs({ role }: { role: "student" | "tutor" }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const items = [...BOTTOM_TABS[role], MORE_ITEM];
  const moreIsSheet = role === "student";
  const moreActive = moreIsSheet && MORE_SHEET_ITEMS.some((i) => i.href === pathname);

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-stretch border-t border-hairline bg-surface [padding-bottom:env(safe-area-inset-bottom)] sm:hidden"
        aria-label="Primary"
      >
        {items.map((item) => {
          const isMore = item.href === MORE_ITEM.href;
          const Icon = item.icon;

          if (isMore && moreIsSheet) {
            return (
              <button
                key="more"
                type="button"
                onClick={() => setMoreOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={moreOpen}
                className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                  moreActive ? "text-accent" : "text-muted"
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={1.5} />
                {item.label}
              </button>
            );
          }

          const active = pathname === item.href;
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
            className="absolute left-1/2 top-0 z-40 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ink text-shell shadow-[0_8px_20px_rgba(14,26,20,0.22)] transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <SCAN.icon className="h-6 w-6" strokeWidth={1.5} />
          </Link>
        ) : null}
      </nav>

      {moreIsSheet ? (
        <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
          <nav className="flex flex-col gap-1">
            {MORE_SHEET_ITEMS.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-11 items-center gap-3 rounded-button px-3 text-sm font-medium transition-colors ${
                    active ? "bg-ink text-shell" : "text-muted hover:text-ink"
                  }`}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </Sheet>
      ) : null}
    </>
  );
}
