"use client";

import { useEffect, useRef, useState } from "react";
import { LineChart, type ChartSeries } from "@/components/charts/line-chart";
import { lastNWeeks, type SubjectSeries } from "@/lib/assessments/series";

// The trend chart, one model for both breakpoints: a chip selector picks
// exactly one subject, and that subject's CT and CWM results plot as two
// separate lines sharing one percentage axis (CLAUDE.md: "Charts always plot
// percentage so CT and CWM sit on one axis" - sharing an axis, not
// collapsing into one averaged line, which is what this replaced). Desktop
// and mobile call this same component; only `weeksLimit` differs, since
// mobile's screen still can't hold a full term's width of history readably.
//
// Averaging a CT and a CWM together into one point the way the old
// multi-subject overlay did hid the fact that they measure different things
// in the same week - two lines, styled distinctly (solid vs. dashed), says
// that plainly instead.

// A mouse wheel has no horizontal axis of its own, and the row hides its
// scrollbar (design system) - so on desktop, without this, the only way to
// reach a chip past the fold is a trackpad's horizontal swipe or a
// shift+scroll most people don't know to try. Redirect a vertical wheel
// gesture to scrollLeft whenever the row actually overflows; a trackpad's
// own horizontal swipe already arrives as deltaX and is left to the
// browser's native handling untouched.
//
// This has to be a real (non-passive) addEventListener, not React's onWheel:
// React attaches wheel listeners at the root as passive by default, so
// e.preventDefault() inside a JSX onWheel handler is silently ignored and
// the page scrolls right along with the row - confirmed in the browser, not
// just theoretical.
function useHorizontalWheelScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function handleWheel(e: WheelEvent) {
      if (el!.scrollWidth <= el!.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      el!.scrollLeft += e.deltaY;
      e.preventDefault();
    }

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  return ref;
}

function toLine(id: string, label: string, points: { weekStart: string; percentage: number }[], dashed: boolean): ChartSeries {
  return {
    id,
    label,
    points: points.map((p) => ({ x: p.weekStart, y: p.percentage })),
    dashed,
  };
}

export function TrendChart({
  series,
  today,
  weeksLimit,
  subjectFilter,
}: {
  series: SubjectSeries[];
  today: string;
  /** Mobile's "last 6 weeks only" (design system). Omit for the full history
   *  a wider screen has room to show. */
  weeksLimit?: number;
  /** The results list's own subject filter (SubjectFilterChips above it on
   *  the page). Picking a subject up there should drop the trend chart onto
   *  that same subject's chip rather than leaving it wherever it was - the
   *  two chip rows read as one filter, not two independent ones. `null`
   *  ("All") leaves the chart's own selection alone rather than forcing it
   *  back to whatever's first. */
  subjectFilter?: string | null;
}) {
  const withData = series.filter((s) => s.ctPoints.length > 0 || s.cwmPoints.length > 0);
  const [selected, setSelected] = useState(withData[0]?.subjectId ?? null);
  const chipRowRef = useHorizontalWheelScroll<HTMLDivElement>();

  useEffect(() => {
    if (subjectFilter && withData.some((s) => s.subjectId === subjectFilter)) {
      setSelected(subjectFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectFilter]);

  if (withData.length === 0) {
    return <p className="text-sm text-muted">Not enough results yet to chart a trend.</p>;
  }

  const current = withData.find((s) => s.subjectId === selected) ?? withData[0];
  const trimmed = weeksLimit != null ? lastNWeeks(current, weeksLimit, today) : current;

  const lines: ChartSeries[] = [];
  if (trimmed.ctPoints.length > 0) {
    lines.push(toLine(`${trimmed.subjectId}-ct`, "CT", trimmed.ctPoints, false));
  }
  if (trimmed.cwmPoints.length > 0) {
    lines.push(toLine(`${trimmed.subjectId}-cwm`, "CWM", trimmed.cwmPoints, true));
  }

  return (
    <div className="min-w-0 max-w-full">
      <div
        ref={chipRowRef}
        className="mb-3 flex w-full max-w-full min-w-0 gap-2 overflow-x-auto pb-1.5 touch-pan-x [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {withData.map((s) => (
          <button
            key={s.subjectId}
            type="button"
            onClick={() => setSelected(s.subjectId)}
            aria-pressed={s.subjectId === trimmed.subjectId}
            className={`shrink-0 whitespace-nowrap rounded-pill px-3 py-1.5 text-xs font-medium transition-colors ${
              s.subjectId === trimmed.subjectId
                ? "bg-ink text-shell"
                : "border border-hairline bg-surface text-muted"
            }`}
          >
            {s.subjectName}
          </button>
        ))}
      </div>

      {lines.length === 0 ? (
        <p className="text-sm text-muted">
          No results logged for this subject{weeksLimit ? ` in the last ${weeksLimit} weeks` : ""}.
        </p>
      ) : (
        <>
          <LineChart series={lines} />
          <Legend lines={lines} />
        </>
      )}
    </div>
  );
}

/** "— CT" vs "- - CWM" — only for whichever of the two actually has a line,
 *  so a subject with only CWM results this window doesn't show a CT swatch
 *  for a line that was cleanly omitted a moment ago. */
function Legend({ lines }: { lines: ChartSeries[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
      {lines.map((line, i) => (
        <span key={line.id} className="inline-flex items-center gap-1.5 text-xs text-muted">
          <svg width="16" height="8" aria-hidden="true">
            <line
              x1={0}
              y1={4}
              x2={16}
              y2={4}
              stroke={`var(--chart-${(i % 3) + 1})`}
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray={line.dashed ? "4 3" : undefined}
            />
          </svg>
          {line.label}
        </span>
      ))}
    </div>
  );
}
