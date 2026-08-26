"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

// Design system: "7-column grid, 32px days, weekends muted, selected day a
// filled --accent circle with white text. CT dates get a small accent dot
// beneath the numeral." "Today" stands in for "selected" here — there is no
// day-detail view yet for picking a different one to select.

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export function MiniCalendar({ today, ctDates }: { today: string; ctDates: Set<string> }) {
  const [y, m] = today.split("-").map(Number);
  const [viewYear, setViewYear] = useState(y);
  const [viewMonth, setViewMonth] = useState(m - 1); // 0-indexed

  const firstOfMonth = new Date(Date.UTC(viewYear, viewMonth, 1));
  const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
  const leadingBlanks = firstOfMonth.getUTCDay();

  const cells: (number | null)[] = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  function isoOf(day: number): string {
    return `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function shiftMonth(delta: number) {
    const next = new Date(Date.UTC(viewYear, viewMonth + delta, 1));
    setViewYear(next.getUTCFullYear());
    setViewMonth(next.getUTCMonth());
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">
          {firstOfMonth.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })}
        </p>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
            className="flex h-7 w-7 items-center justify-center rounded-button text-muted hover:text-ink"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
            className="flex h-7 w-7 items-center justify-center rounded-button text-muted hover:text-ink"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-y-1 text-center">
        {WEEKDAY_LABELS.map((label, i) => (
          <span key={i} className="text-[11px] text-muted">
            {label}
          </span>
        ))}

        {cells.map((day, i) => {
          if (day === null) return <span key={i} />;
          const iso = isoOf(day);
          const isToday = iso === today;
          const isWeekend = (leadingBlanks + day - 1) % 7 === 5 || (leadingBlanks + day - 1) % 7 === 6;
          const hasCT = ctDates.has(iso);

          return (
            <div key={i} className="flex flex-col items-center gap-0.5">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs ${
                  isToday
                    ? "bg-accent font-semibold text-shell"
                    : isWeekend
                      ? "text-muted"
                      : "text-body"
                }`}
              >
                {day}
              </span>
              <span
                aria-hidden="true"
                className={`h-1 w-1 rounded-full ${hasCT ? "bg-accent" : "bg-transparent"}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
