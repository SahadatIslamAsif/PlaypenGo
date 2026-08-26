"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import type { PeriodColumn } from "@/lib/routines/grid";

// Times are edited once for the whole week, not once per cell.
//
// A Playpen routine is a bell schedule: period 3 starts at 09:40 whatever day
// it is. Forty time fields would be forty chances to mistype, so the editor
// asks for eight and stamps them across all five days on the way out. The rows
// still store their own times, so a one-off variation stays representable in
// the data even though nothing here produces one.

export function BellSchedule({
  open,
  columns,
  onClose,
  onChangeTime,
  onAdd,
  onRemove,
}: {
  open: boolean;
  columns: PeriodColumn[];
  onClose: () => void;
  onChangeTime: (columnIndex: number, patch: Partial<PeriodColumn>) => void;
  onAdd: () => void;
  onRemove: (columnIndex: number) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Period times">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          These apply to every day of the week.
        </p>

        <ul className="flex flex-col gap-2">
          {columns.map((column, index) => (
            <li
              key={column.period_no}
              className="flex items-center gap-2 rounded-tint bg-surface-sunk p-2"
            >
              <span className="w-16 shrink-0 text-sm font-medium text-ink">
                Period {column.period_no}
              </span>

              <input
                type="time"
                value={column.start_time ?? ""}
                onChange={(e) =>
                  onChangeTime(index, { start_time: e.target.value || null })
                }
                aria-label={`Period ${column.period_no} start time`}
                className="h-10 min-w-0 flex-1 rounded-button border border-hairline bg-surface px-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />

              <span className="text-xs text-muted">to</span>

              <input
                type="time"
                value={column.end_time ?? ""}
                onChange={(e) =>
                  onChangeTime(index, { end_time: e.target.value || null })
                }
                aria-label={`Period ${column.period_no} end time`}
                className="h-10 min-w-0 flex-1 rounded-button border border-hairline bg-surface px-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />

              <button
                type="button"
                onClick={() => onRemove(index)}
                aria-label={`Remove period ${column.period_no}`}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-button text-muted transition-colors hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </li>
          ))}
        </ul>

        <Button type="button" variant="secondary" onClick={onAdd} className="w-full">
          <Plus className="h-4 w-4" strokeWidth={1.5} />
          Add a period
        </Button>

        <Button type="button" onClick={onClose} className="w-full">
          Done
        </Button>
      </div>
    </Sheet>
  );
}
