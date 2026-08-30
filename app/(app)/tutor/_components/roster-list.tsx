import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import type { RosterRow } from "@/lib/tutor/roster";

// §8: "unlogged count is the point of the screen." Card list, not a table —
// CLAUDE.md's "Tables become cards" rule for this exact screen — so this is
// the only layout, not a mobile fallback for one that degrades on desktop.

export function RosterList({ rows }: { rows: RosterRow[] }) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <RosterCard key={row.studentId} row={row} />
      ))}
    </div>
  );
}

function RosterCard({ row }: { row: RosterRow }) {
  return (
    <Link
      href={`/tutor/${row.studentId}`}
      className="flex items-center justify-between gap-4 rounded-card border border-hairline bg-surface p-4 shadow-soft transition-colors hover:bg-surface-sunk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink">{row.studentName}</p>
        <p className="mt-0.5 text-xs text-muted">
          {row.tomorrowCount === 0
            ? "Nothing due tomorrow"
            : `${row.tomorrowCount} due tomorrow`}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <TrendBadge trend={row.trend} />
        <UnloggedBadge count={row.unloggedCount} />
      </div>
    </Link>
  );
}

function UnloggedBadge({ count }: { count: number }) {
  if (count === 0) {
    return (
      <span className="rounded-pill bg-surface-sunk px-2.5 py-1 text-xs font-medium text-muted">
        0 unlogged
      </span>
    );
  }
  return (
    <span className="rounded-pill bg-tint-sage px-2.5 py-1 text-xs font-semibold text-tint-ink">
      {count} unlogged
    </span>
  );
}

function TrendBadge({ trend }: { trend: RosterRow["trend"] }) {
  if (trend === "up") {
    return (
      <span aria-label="Trending up" title="Trending up">
        <TrendingUp className="h-4 w-4 text-accent" strokeWidth={1.5} />
      </span>
    );
  }
  if (trend === "down") {
    return (
      <span aria-label="Trending down" title="Trending down">
        <TrendingDown className="h-4 w-4 text-danger" strokeWidth={1.5} />
      </span>
    );
  }
  if (trend === "flat") {
    return (
      <span aria-label="Flat" title="Flat">
        <Minus className="h-4 w-4 text-muted" strokeWidth={1.5} />
      </span>
    );
  }
  return null; // Not enough history - §8's own reasoning for staying silent here.
}
