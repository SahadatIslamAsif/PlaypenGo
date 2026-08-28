"use client";

import type { CapturedPage } from "./scan-screen";

// Presentational only - holds no state of its own. "Same paper / new
// paper" is authored per page, never derived from a neighbour (SPEC.md
// §5.3: "The thumbnail strip in the review screen carries a same paper /
// new paper toggle. It is the grouping control, not decoration."), so
// paper numbers here are a pure scan of that per-page boolean, not
// anything stored separately.

function paperNumbers(pages: CapturedPage[]): number[] {
  const numbers: number[] = [];
  let current = 1;
  pages.forEach((page, i) => {
    if (i > 0 && !page.sameAsPrevious) current += 1;
    numbers.push(current);
  });
  return numbers;
}

export function PageStrip({
  pages,
  onToggleSame,
  onZoom,
}: {
  pages: CapturedPage[];
  onToggleSame: (id: string) => void;
  onZoom: (id: string) => void;
}) {
  if (pages.length === 0) return null;

  const numbers = paperNumbers(pages);

  return (
    <div className="flex items-start gap-3 overflow-x-auto pb-2">
      {pages.map((page, i) => {
        const startsNewGroup = i === 0 || numbers[i] !== numbers[i - 1];
        return (
          <div key={page.id} className="flex shrink-0 flex-col items-center gap-2">
            {startsNewGroup ? (
              <span className="rounded-pill bg-tint-mint px-2.5 py-1 text-xs font-medium text-tint-ink">
                Paper {numbers[i]}
              </span>
            ) : (
              // Keeps every thumbnail's column the same height whether or
              // not it starts a group, so the strip's second row (the
              // toggle) stays aligned across the whole row.
              <span className="h-[26px]" aria-hidden="true" />
            )}

            <button
              type="button"
              onClick={() => onZoom(page.id)}
              aria-label={`Open page ${i + 1} full screen`}
              className="h-16 w-16 overflow-hidden rounded-tint border border-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={page.previewUrl}
                alt={`Captured page ${i + 1}`}
                className="h-full w-full object-cover"
              />
            </button>

            {i > 0 ? (
              <button
                type="button"
                onClick={() => onToggleSame(page.id)}
                aria-pressed={!page.sameAsPrevious}
                className={`rounded-pill px-2.5 py-1 text-xs font-medium transition-colors ${
                  page.sameAsPrevious
                    ? "bg-surface-sunk text-muted"
                    : "bg-accent text-shell"
                }`}
              >
                {page.sameAsPrevious ? "Same paper" : "New paper"}
              </button>
            ) : (
              <span className="h-[26px]" aria-hidden="true" />
            )}
          </div>
        );
      })}
    </div>
  );
}
