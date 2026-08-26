"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GUARDIAN_SEGMENTS, MORE_ITEM } from "./nav-items";

// <640px, guardian only. Design system: "Guardian: no tab bar — three views
// behind a top segmented control." A segmented control reads as one control
// with a moving selection, not a row of independent buttons, so the active
// segment is drawn as a sliding fill rather than each item styling itself.
//
// Settings has no segment here — GUARDIAN_SEGMENTS is deliberately three —
// so it gets a small icon-only link alongside the control rather than a
// fourth segment, which is the one place mobile guardian access to Settings
// exists outside the icon rail at ≥640.

export function SegmentedNav() {
  const pathname = usePathname();
  const activeIndex = Math.max(
    0,
    GUARDIAN_SEGMENTS.findIndex((item) => item.href === pathname),
  );

  return (
    <div className="flex items-center gap-2 px-4 pt-3 sm:hidden">
      <div
        role="tablist"
        aria-label="Primary"
        className="relative grid flex-1 grid-cols-3 rounded-pill border border-hairline bg-surface p-1"
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-1 rounded-pill bg-ink transition-transform duration-200"
          style={{
            width: `calc((100% - 0.5rem) / 3)`,
            transform: `translateX(calc(${activeIndex} * 100%))`,
          }}
        />
        {GUARDIAN_SEGMENTS.map((item) => {
          const active = item.href === pathname;
          return (
            <Link
              key={item.href}
              href={item.href}
              role="tab"
              aria-selected={active}
              className={`relative z-10 flex h-9 items-center justify-center rounded-pill text-sm font-medium transition-colors ${
                active ? "text-shell" : "text-muted"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      <Link
        href={MORE_ITEM.href}
        aria-label={MORE_ITEM.label}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-button border border-hairline bg-surface text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <MORE_ITEM.icon className="h-[18px] w-[18px]" strokeWidth={1.5} />
      </Link>
    </div>
  );
}
