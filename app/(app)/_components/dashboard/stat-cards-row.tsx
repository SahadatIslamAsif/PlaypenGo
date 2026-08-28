import { Card } from "@/components/ui/card";
import { StatCard, type StatCardData } from "./stat-card";

// Two layouts sharing one card: a wrapping row on desktop, a snap-scrolling
// carousel on mobile (design system: "the three stat cards as a
// snap-scrolling carousel").
//
// emptyVariant exists because the empty state needs different framing
// depending on whether the caller already put it inside a Card of its own:
// the mobile dashboard wraps this whole component in an external
// <Card><p>Latest results</p>...</Card> unconditionally (populated or not),
// so its empty text should stay bare - card-wrapping it too would nest a
// card inside a card. The desktop dashboard has no such wrapper (a
// populated row is just self-contained stat-card tiles, no heading, no
// outer card per §8's layout) - so ITS empty state needs its own Card, or
// it renders as unstyled text floating above "Your progress".

export function StatCardsRow({
  items,
  layout,
  emptyVariant = "bare",
}: {
  items: StatCardData[];
  layout: "grid" | "carousel";
  emptyVariant?: "bare" | "card";
}) {
  if (items.length === 0) {
    const message = (
      <p className="text-sm text-muted">No results yet. Scan a paper to start tracking.</p>
    );
    return emptyVariant === "card" ? <Card>{message}</Card> : message;
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
