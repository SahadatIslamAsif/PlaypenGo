"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// The percentage trend chart. Hand-rolled SVG, no dependency — CLAUDE.md asks
// only that a charting library be lazy-loaded, and the repo has no UI
// dependency beyond lucide-react, so writing this directly avoids adding one
// just to restyle it back to the house look afterwards. This component is
// itself lazy-loaded via next/dynamic wherever it's used.
//
// Design system: "monotone smooth lines, horizontal gridlines only in
// --hairline, no vertical rules, no axis borders. Tooltip is an --ink pill,
// radius 10, white 12/600 text, small pointer." Series colours rotate through
// --chart-1/2/3.
//
// "Monotone" here means the curve never overshoots past either endpoint of a
// segment — a line between two logged scores must not visually imply a dip or
// spike that didn't happen. Implemented as quadratic Bezier segments through
// the midpoints of consecutive points, which is bounded by construction
// (unlike a Catmull-Rom spline, which can overshoot) without needing a full
// Fritsch-Carlson monotone-cubic implementation.

export type ChartPoint = { x: string; y: number };
export type ChartSeries = { id: string; label: string; points: ChartPoint[] };

const SERIES_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];
const GRIDLINES = [0, 25, 50, 75, 100];

export function LineChart({
  series,
  height = 220,
  yMax = 100,
  ariaLabel = "Percentage trend",
}: {
  series: ChartSeries[];
  height?: number;
  yMax?: number;
  ariaLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [pinned, setPinned] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  const padding = { top: 12, right: 12, bottom: 20, left: 28 };
  const plotWidth = Math.max(width - padding.left - padding.right, 1);
  const plotHeight = Math.max(height - padding.top - padding.bottom, 1);

  // A shared x-axis across every series, so two subjects with results on
  // different weeks still align on the same categorical positions.
  const allX = useMemo(() => {
    const set = new Set<string>();
    for (const s of series) for (const p of s.points) set.add(p.x);
    return [...set].sort();
  }, [series]);

  const xPos = (x: string) => {
    const i = allX.indexOf(x);
    return allX.length <= 1 ? plotWidth / 2 : (i / (allX.length - 1)) * plotWidth;
  };
  const yPos = (y: number) => plotHeight - (Math.min(y, yMax) / yMax) * plotHeight;

  useResizeWidth(containerRef, setWidth);

  const activeIndex = pinned ?? hovered;

  return (
    <div ref={containerRef} className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        className="w-full touch-none"
        onMouseLeave={() => setHovered(null)}
        onMouseMove={(e) => {
          if (allX.length === 0) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const localX = ((e.clientX - rect.left) / rect.width) * width - padding.left;
          setHovered(nearestIndex(localX, allX.length, plotWidth));
        }}
        onClick={() => setPinned((current) => (current === hovered ? null : hovered))}
      >
        <g transform={`translate(${padding.left}, ${padding.top})`}>
          {/* Horizontal gridlines only — no vertical rules, no axis border. */}
          {GRIDLINES.map((value) => (
            <line
              key={value}
              x1={0}
              x2={plotWidth}
              y1={yPos(value)}
              y2={yPos(value)}
              stroke="var(--hairline)"
              strokeWidth={1}
            />
          ))}
          {GRIDLINES.map((value) => (
            <text
              key={value}
              x={-8}
              y={yPos(value)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted text-[10px]"
            >
              {value}
            </text>
          ))}

          {series.map((s, i) => {
            const color = SERIES_COLORS[i % SERIES_COLORS.length];
            const pts = s.points
              .map((p) => ({ x: xPos(p.x), y: yPos(p.y) }))
              .sort((a, b) => a.x - b.x);
            if (pts.length === 0) return null;

            const linePath = smoothPath(pts);
            const areaPath = i === 0 ? `${linePath} L ${pts.at(-1)!.x},${plotHeight} L ${pts[0].x},${plotHeight} Z` : null;

            return (
              <g key={s.id}>
                {areaPath ? (
                  <path d={areaPath} fill={`url(#chart-area-${i})`} stroke="none" />
                ) : null}
                <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
                {pts.map((p, idx) => (
                  <circle
                    key={idx}
                    cx={p.x}
                    cy={p.y}
                    r={activeIndex === idx ? 4 : 3}
                    fill={color}
                    stroke="var(--surface)"
                    strokeWidth={1.5}
                  />
                ))}
              </g>
            );
          })}

          {/* The area fill belongs to the first series only, per the design
              system's single gradient — a chart with several filled areas
              stacking on top of each other reads as noise, not signal. */}
          <defs>
            <linearGradient id="chart-area-0" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-area-from)" />
              <stop offset="100%" stopColor="var(--chart-area-to)" />
            </linearGradient>
          </defs>

          {activeIndex !== null && allX[activeIndex] ? (
            <line
              x1={xPos(allX[activeIndex])}
              x2={xPos(allX[activeIndex])}
              y1={0}
              y2={plotHeight}
              stroke="var(--hairline)"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
          ) : null}
        </g>
      </svg>

      {activeIndex !== null && allX[activeIndex] ? (
        <Tooltip
          date={allX[activeIndex]}
          series={series}
          pinned={pinned !== null}
          onDismiss={() => setPinned(null)}
        />
      ) : null}
    </div>
  );
}

function Tooltip({
  date,
  series,
  pinned,
  onDismiss,
}: {
  date: string;
  series: ChartSeries[];
  pinned: boolean;
  onDismiss: () => void;
}) {
  const rows = series
    .map((s) => ({ label: s.label, point: s.points.find((p) => p.x === date) }))
    .filter((r) => r.point);

  if (rows.length === 0) return null;

  return (
    <div className="mt-2 flex items-start justify-between">
      <div className="inline-flex flex-col gap-0.5 rounded-[10px] bg-ink px-3 py-2 text-xs font-semibold text-shell">
        <span className="text-[10px] font-normal text-shell/70">{date}</span>
        {rows.map((r) => (
          <span key={r.label}>
            {r.label}: {r.point!.y}%
          </span>
        ))}
      </div>
      {pinned ? (
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-muted underline underline-offset-2"
        >
          Unpin
        </button>
      ) : null}
    </div>
  );
}

/** Nearest categorical index to a pixel offset within the plot area. */
function nearestIndex(localX: number, count: number, plotWidth: number): number | null {
  if (count === 0) return null;
  if (count === 1) return 0;
  const ratio = Math.min(Math.max(localX / plotWidth, 0), 1);
  return Math.round(ratio * (count - 1));
}

/**
 * Quadratic-through-midpoints smoothing. For points p0..pn, draws a line to
 * the midpoint of each consecutive pair using the shared point as the
 * quadratic control — bounded between the two points it connects, so it
 * cannot overshoot the way a full spline can.
 */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;

  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    const midX = (curr.x + next.x) / 2;
    const midY = (curr.y + next.y) / 2;
    d += ` Q ${curr.x},${curr.y} ${midX},${midY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x},${last.y}`;
  return d;
}

/**
 * Observes the container's width so the SVG viewBox tracks its layout box.
 * `onWidth` is always the caller's `setWidth` from useState, which React
 * guarantees is referentially stable, so it's safe to omit from the effect's
 * dependency array without a ref indirection.
 */
function useResizeWidth(
  ref: React.RefObject<HTMLDivElement | null>,
  onWidth: (width: number) => void,
) {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    onWidth(node.clientWidth || 600);

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) onWidth(width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, onWidth]);
}
