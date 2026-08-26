import { StatCard, type StatCardData } from "./stat-card";

// Two layouts sharing one card: a wrapping row on desktop, a snap-scrolling
// carousel on mobile (design system: "the three stat cards as a
// snap-scrolling carousel").

export function StatCardsRow({
  items,
  layout,
}: {
  items: StatCardData[];
  layout: "grid" | "carousel";
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted">No results yet. Scan a paper to start tracking.</p>
    );
  }

  if (layout === "carousel") {
    return (
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1">
        {items.map((item, i) => (
          <div key={i} className="w-[85%] shrink-0 snap-start">
            <StatCard data={item} tintIndex={i} />
          </div>
        ))}
      </div>
    );
  }

  // auto-fit rather than a hard grid-cols-3: at 1280px the main column
  // competes with a 232px sidebar and a 320px rail, leaving roughly 480px —
  // three fixed columns there squeeze each card to ~150px, too narrow for
  // "Physics" plus a mark line without truncating mid-word. A 200px minimum
  // lets the row wrap to two-per-row exactly where three would not fit, and
  // still lays out all three in one row on anything wider.
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
      {items.map((item, i) => (
        <StatCard key={i} data={item} tintIndex={i} />
      ))}
    </div>
  );
}
