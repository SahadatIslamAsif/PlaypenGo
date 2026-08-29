"use client";

import { ChevronLeft, ChevronRight, ImageIcon, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteResult } from "@/lib/assessments/actions";
import { formatConverted, formatRaw } from "@/lib/assessments/marks";
import type { ResultListItem } from "@/lib/assessments/list";

export function ResultCard({
  item,
  canDelete,
  canAttach,
}: {
  item: ResultListItem;
  canDelete: boolean;
  /** Scanning is a student-only action (§3.3) - the same boolean that gates
   * "Log result"/delete on this screen, reused here rather than a second
   * role check. */
  canAttach: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [zoomedIndex, setZoomedIndex] = useState<number | null>(null);
  const zoomedUrl = zoomedIndex !== null ? item.imageUrls[zoomedIndex] : null;

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
        {item.chapterNames.length > 0 ? (
          <p className="mt-0.5 truncate text-xs text-muted">{item.chapterNames.join(", ")}</p>
        ) : null}
        <p className="mt-1 text-xs text-muted">{formatDate(item.date)}</p>

        {item.paperMissing ? (
          <p className="mt-1.5 inline-flex items-center rounded-pill bg-surface-sunk px-2 py-0.5 text-[11px] text-muted">
            Logged manually (no paper attached)
          </p>
        ) : null}

        {canAttach && item.entryMode === "manual" ? (
          <Link
            href={`/scan?attachTo=${item.resultId}`}
            className="mt-1.5 inline-block text-xs font-medium text-accent hover:underline"
          >
            Attach paper
          </Link>
        ) : null}

        {item.imageUrls.length > 0 ? (
          <button
            type="button"
            onClick={() => setZoomedIndex(0)}
            className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.5} />
            View paper{item.imageUrls.length > 1 ? ` (${item.imageUrls.length} pages)` : ""}
          </button>
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
            className="mt-1 flex h-8 w-8 items-center justify-center rounded-button text-muted transition-colors hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        ) : null}
      </div>

      {zoomedUrl ? (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-ink/90 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Page ${(zoomedIndex ?? 0) + 1} of ${item.subjectName}`}
          onClick={() => setZoomedIndex(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomedUrl}
            alt={`Page ${(zoomedIndex ?? 0) + 1}, full screen`}
            className="max-h-[75vh] max-w-full object-contain"
          />
          {item.imageUrls.length > 1 ? (
            <div className="flex items-center gap-4 text-shell">
              <button
                type="button"
                aria-label="Previous page"
                disabled={zoomedIndex === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  setZoomedIndex((i) => (i !== null ? Math.max(0, i - 1) : i));
                }}
                className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-surface text-ink disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <ChevronLeft className="h-5 w-5" strokeWidth={1.5} />
              </button>
              <p className="text-sm">
                Page {(zoomedIndex ?? 0) + 1} of {item.imageUrls.length}
              </p>
              <button
                type="button"
                aria-label="Next page"
                disabled={zoomedIndex === item.imageUrls.length - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  setZoomedIndex((i) =>
                    i !== null ? Math.min(item.imageUrls.length - 1, i + 1) : i,
                  );
                }}
                className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-surface text-ink disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <ChevronRight className="h-5 w-5" strokeWidth={1.5} />
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setZoomedIndex(null)}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-[14px] bg-surface text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-5 w-5" strokeWidth={1.5} />
          </button>
        </div>
      ) : null}
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
