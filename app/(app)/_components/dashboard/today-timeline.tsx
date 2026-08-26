import { Clock } from "lucide-react";
import type { RoutinePeriodRow } from "@/lib/routines/grid";
import { formatTime } from "@/lib/routines/schedule";

// The Timeline component the design system names specifically for this data:
// "56px time gutter in muted 12. Each entry is a tinted card with a 3px
// full-height rounded bar in --accent on its left edge, a clock icon and time
// row at 12, title 14/600, description 12 muted."

export function TodayTimeline({
  periods,
  subjectNames,
}: {
  periods: RoutinePeriodRow[];
  subjectNames: Map<string, string>;
}) {
  if (periods.length === 0) {
    return <p className="text-sm text-muted">No classes today.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {periods.map((period) => (
        <li key={period.id} className="flex gap-3">
          <div className="w-14 shrink-0 pt-2.5 text-xs text-muted">
            {formatTime(period.start_time)}
          </div>
          <div
            className={`relative flex-1 overflow-hidden rounded-tint border border-hairline p-3 pl-4 ${
              period.is_academic ? "bg-surface" : "bg-surface-sunk"
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute inset-y-0 left-0 w-[3px] rounded-full ${
                period.is_academic ? "bg-accent" : "bg-hairline"
              }`}
            />
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <Clock className="h-3 w-3" strokeWidth={1.5} />
              {formatTime(period.start_time)} – {formatTime(period.end_time)}
            </p>
            <p className={`text-sm font-semibold ${period.is_academic ? "text-ink" : "text-muted"}`}>
              {period.is_academic
                ? (period.student_subject_id
                    ? (subjectNames.get(period.student_subject_id) ?? period.raw_text ?? "Class")
                    : (period.raw_text ?? "Class"))
                : (period.raw_text ?? "Break")}
            </p>
            {period.is_academic && period.teacher_raw ? (
              <p className="text-xs text-muted">{period.teacher_raw}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
