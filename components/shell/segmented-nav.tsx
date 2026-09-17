"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GUARDIAN_SEGMENTS, SETTINGS } from "./nav-items";

// <640px, guardian only. Design system: "Guardian: no tab bar — three views
// behind a top segmented control." Settings is folded into the same control
// as a fourth segment (rather than a detached pill alongside it) so all four
// share one background wrapper and identical pill styling — one control with
// a moving selection, not three tabs plus an odd button bolted on.
//
// GUARDIAN_SEGMENTS itself stays "the three views" (nav-items.ts); this
// component is what decides Settings rides along in the same control.

const ITEMS = [...GUARDIAN_SEGMENTS, SETTINGS];

export function SegmentedNav() {
  const pathname = usePathname();
  const activeIndex = ITEMS.findIndex((item) => item.href === pathname);

  return (
    <div className="px-4 pt-3 sm:hidden">
      <div
        role="tablist"
        aria-label="Primary"
        className="relative grid rounded-pill border border-hairline bg-surface p-1"
        style={{ gridTemplateColumns: `repeat(${ITEMS.length}, minmax(0, 1fr))` }}
      >
        {activeIndex >= 0 ? (
          <span
            aria-hidden="true"
            className="absolute inset-y-1 rounded-pill bg-ink transition-transform duration-200"
            style={{
              width: `calc((100% - 0.5rem) / ${ITEMS.length})`,
              transform: `translateX(calc(${activeIndex} * 100%))`,
            }}
          />
        ) : null}
        {ITEMS.map((item) => {
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
    </div>
  );
}
