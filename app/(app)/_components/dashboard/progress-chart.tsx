"use client";

import { useState } from "react";
import { LineChart, type ChartSeries } from "@/components/charts/line-chart";
import { Sparkline } from "@/components/charts/sparkline";
import { lastNWeeks, type SubjectSeries } from "@/lib/assessments/series";

// "Your progress" — desktop: every subject as its own line, sharing one axis
// (percentage, so CT and CWM compare directly). Mobile: "Charts must be
// rebuilt, not resized" — one subject at a time behind a chip selector, last
// six weeks only, tap-to-pin tooltips (LineChart already does this).
//
// The mobile chip selector is the primary mechanism; the sparkline fallback
// applies per subject, not to the section as a whole, when that subject's
// six-week window has fewer than two points to draw a meaningful line from —
// "a legible list beats an illegible graph" is about that one row, not about
// abandoning the chart for everyone.

function toChartSeries(series: SubjectSeries[]): ChartSeries[] {
  return series.map((s) => ({
    id: s.subjectId,
    label: s.subjectName,
    points: s.points.map((p) => ({ x: p.weekStart, y: p.percentage })),
  }));
}

export function DesktopProgressChart({ series }: { series: SubjectSeries[] }) {
  const withPoints = series.filter((s) => s.points.length > 0);

  if (withPoints.length === 0) {
    return <p className="text-sm text-muted">Not enough results yet to chart a trend.</p>;
  }

  return (
    <div>
      <LineChart series={toChartSeries(withPoints)} />
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {withPoints.map((s, i) => (
          <span key={s.subjectId} className="inline-flex items-center gap-1.5 text-xs text-muted">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full"
              style={{ background: `var(--chart-${(i % 3) + 1})` }}
            />
            {s.subjectName}
          </span>
        ))}
      </div>
    </div>
  );
}

export function MobileProgressChart({ series, today }: { series: SubjectSeries[]; today: string }) {
  const [selected, setSelected] = useState(series[0]?.subjectId ?? null);
  const current = series.find((s) => s.subjectId === selected);
  const trimmed = current ? lastNWeeks(current, 6, today) : null;

  if (series.length === 0) {
    return <p className="text-sm text-muted">Not enough results yet to chart a trend.</p>;
  }

  return (
    <div>
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {series.map((s) => (
          <button
            key={s.subjectId}
            type="button"
            onClick={() => setSelected(s.subjectId)}
            aria-pressed={selected === s.subjectId}
            className={`shrink-0 rounded-pill px-3 py-1.5 text-xs font-medium transition-colors ${
              selected === s.subjectId
                ? "bg-ink text-shell"
                : "border border-hairline bg-surface text-muted"
            }`}
          >
            {s.subjectName}
          </button>
        ))}
      </div>

      {trimmed && trimmed.points.length >= 2 ? (
        <LineChart series={[{ id: trimmed.subjectId, label: trimmed.subjectName, points: trimmed.points.map((p) => ({ x: p.weekStart, y: p.percentage })) }]} />
      ) : trimmed && trimmed.points.length === 1 ? (
        <div className="flex items-center gap-3 rounded-tint bg-surface-sunk p-3">
          <Sparkline values={trimmed.points.map((p) => p.percentage)} />
          <p className="text-sm text-body">
            Latest: <span className="font-semibold text-ink">{trimmed.points[0].percentage}%</span>
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted">No results logged for this subject in the last 6 weeks.</p>
      )}
    </div>
  );
}
