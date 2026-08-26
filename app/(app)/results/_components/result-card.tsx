"use client";

import { Trash2 } from "lucide-react";
import { useTransition } from "react";
import { deleteResult } from "@/lib/assessments/actions";
import { formatConverted, formatRaw } from "@/lib/assessments/marks";
import type { ResultListItem } from "@/lib/assessments/list";

export function ResultCard({
  item,
  canDelete,
}: {
  item: ResultListItem;
  canDelete: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-start justify-between gap-3 rounded-card border border-hairline bg-surface p-4 shadow-soft">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-ink">{item.subjectName}</p>
          {item.paperName ? <span className="text-xs text-muted">{item.paperName}</span> : null}
          <span
            className={`rounded-pill px-2 py-0.5 text-[11px] font-medium ${
              item.type === "CT" ? "bg-tint-teal text-tint-ink" : "bg-tint-mint text-tint-ink"
            }`}
          >
            {item.type}
          </span>
        </div>
        {item.chapterName ? (
          <p className="mt-0.5 truncate text-xs text-muted">{item.chapterName}</p>
        ) : null}
        <p className="mt-1 text-xs text-muted">{formatDate(item.date)}</p>

        {item.paperMissing ? (
          <p className="mt-1.5 inline-flex items-center rounded-pill bg-surface-sunk px-2 py-0.5 text-[11px] text-muted">
            Logged manually (no paper attached)
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <p className="text-sm font-semibold text-ink" style={{ fontVariantNumeric: "tabular-nums" }}>
          {formatRaw(item.rawObtained, item.rawTotal)}
        </p>
        <p className="text-xs text-muted">
          {formatConverted(item.converted, item.type === "CT" ? 25 : 15)} · {item.percentage}%
        </p>

        {canDelete ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => { deleteResult(item.resultId); })}
            aria-label="Delete result"
            className="mt-1 flex h-8 w-8 items-center justify-center rounded-button text-muted transition-colors hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
