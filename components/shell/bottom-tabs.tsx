"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BOTTOM_TABS, MORE_ITEM } from "./nav-items";

// <640px, student and tutor only — the guardian uses SegmentedNav instead.
// Design system: "56px tall plus env(safe-area-inset-bottom). Icons at 20
// with a 11px label; active item takes --accent, not the black pill (a
// filled pill is too heavy at this size)."
//
// §8 puts a raised Scan button centred over this bar; that ships with Phase
// 5. This renders the remaining slots evenly rather than leaving a gap where
// Scan will go, so the bar reads as complete today rather than half-built.

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
    </nav>
  );
}
