import type { RoutinePeriodRow } from "@/lib/routines/grid";
import { isNonAcademicText } from "@/lib/routines/resolve";
import { formatTime } from "@/lib/routines/schedule";

// Flat variant of the Timeline component: just the start time in the gutter
// and the subject name beside it, no box, no accent bar, no end time, no
// teacher name — the page already has plenty of pills and cards elsewhere.

export function TodayTimeline({
  periods,
  subjectNames,
  emptyLabel = "No classes today.",
}: {
  periods: RoutinePeriodRow[];
  subjectNames: Map<string, string>;
  emptyLabel?: string;
}) {
  if (periods.length === 0) {
    return <p className="text-sm text-muted">{emptyLabel}</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-hairline">
      {periods.map((period) => (
        <li key={period.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
          <div className="w-14 shrink-0 text-xs text-muted">{formatTime(period.start_time)}</div>
          <p className={`text-sm font-medium ${period.is_academic ? "text-ink" : "text-muted"}`}>
            {period.is_academic
              ? (period.student_subject_id
                  ? (subjectNames.get(period.student_subject_id) ?? period.raw_text ?? "Class")
                  : (period.raw_text ?? "Class"))
              : /* A single letter from a vertically-spelled break column ("B",
                   "R", "E", "A", "K") isn't a label on its own - only a named
                   non-academic period (Games, E.C.A., Assembly, ...) is. */
                (period.raw_text && isNonAcademicText(period.raw_text) ? period.raw_text : "Break")}
          </p>
        </li>
      ))}
    </ul>
  );
}
