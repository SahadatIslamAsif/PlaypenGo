import { AlertCircle, CalendarClock } from "lucide-react";
import type { UpcomingItem } from "@/lib/assessments/upcoming";

// §7.4: "Tomorrow and Day after are never truncated." This list is never
// truncated at all — that cap only applies to the digest's "rest of the
// week" section, which the dashboard doesn't reproduce.
//
// §7.4's "layout switch: when 3+ assessments fall within the next 3 days,
// render a compact day-by-day table instead of prose blocks" describes the
// email digest specifically. The dashboard is already a compact list by
// construction, so there is no separate table mode to build here.

export function UpcomingList({ items, today }: { items: UpcomingItem[]; today: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted">Nothing scheduled or predicted right now.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item, i) => (
        <li
          key={i}
          className="flex items-center gap-3 rounded-tint bg-surface-sunk px-3 py-2.5"
        >
          {item.kind === "scheduled_ct" ? (
            <CalendarClock className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.5} />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{item.subjectName}</p>
            <p className="text-xs text-muted">
              {item.kind === "scheduled_ct" ? "CT" : "CWM likely"} · {relativeLabel(item.date, today)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function relativeLabel(date: string, today: string): string {
  if (date === today) return "Today";
  const diffDays = Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === 2) return "Day after";
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
