"use client";

import { useRef } from "react";
import type { WheelEvent } from "react";

export function SubjectFilterChips({
  subjects,
  selected,
  onSelect,
}: {
  subjects: { id: string; display_name: string }[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  // A mouse wheel only reports vertical delta, and this strip has no
  // vertical overflow of its own - without this, scrolling over the chips
  // does nothing (or scrolls the page behind them) instead of panning the
  // strip. Convert vertical wheel movement to horizontal scroll here, but
  // only when the strip can actually scroll further that way, so a normal
  // page-scroll gesture still passes through once the strip's ends are hit.
  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    if (!el || e.deltaY === 0) return;
    const canScrollLeft = el.scrollLeft > 0;
    const canScrollRight = el.scrollLeft + el.clientWidth < el.scrollWidth;
    if ((e.deltaY < 0 && canScrollLeft) || (e.deltaY > 0 && canScrollRight)) {
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    }
  };

  return (
    <div
      ref={scrollerRef}
      onWheel={handleWheel}
      className="flex gap-2 overflow-x-auto py-1.5 touch-pan-x [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
    >
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-pressed={selected === null}
        className={`shrink-0 whitespace-nowrap rounded-pill px-3 py-1.5 text-xs font-medium transition-colors ${
          selected === null ? "bg-ink text-shell" : "border border-hairline bg-surface text-muted"
        }`}
      >
        All
      </button>
      {subjects.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onSelect(s.id)}
          aria-pressed={selected === s.id}
          className={`shrink-0 whitespace-nowrap rounded-pill px-3 py-1.5 text-xs font-medium transition-colors ${
            selected === s.id ? "bg-ink text-shell" : "border border-hairline bg-surface text-muted"
          }`}
        >
          {s.display_name}
        </button>
      ))}
    </div>
  );
}
