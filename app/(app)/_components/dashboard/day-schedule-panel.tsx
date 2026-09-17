"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { MiniCalendar } from "../mini-calendar";
import { TodayTimeline } from "./today-timeline";
import type { RoutinePeriodRow } from "@/lib/routines/grid";
import { dayOfWeekOf, isSchoolDay, periodsOnDay } from "@/lib/routines/schedule";

// Wires the calendar to the periods list: picking any date, in any month,
// swaps the card below to that date's routine. The routine is a weekly
// template (day_of_week 0-4), not date-specific, so no fetch is needed on
// selection — the full week's periods are already on hand, filtered
// client-side by the picked date's weekday. Friday/Saturday are the routine's
// weekend (§ routines/schedule.ts `isSchoolDay`) and always read as no class,
// regardless of what's in `routinePeriods`.

export function DaySchedulePanel({
  today,
  ctDates,
  routinePeriods,
  subjectNames,
}: {
  today: string;
  ctDates: Set<string>;
  routinePeriods: RoutinePeriodRow[];
  subjectNames: Map<string, string>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const activeDate = selected ?? today;
  const isToday = activeDate === today;
  const dayOfWeek = dayOfWeekOf(activeDate);
  const isWeekend = !isSchoolDay(dayOfWeek);
  const periods = isWeekend ? [] : periodsOnDay(routinePeriods, dayOfWeek);

  return (
    <>
      <Card>
        <MiniCalendar today={today} selected={selected} ctDates={ctDates} onSelect={setSelected} />
      </Card>

      <Card>
        <p className="mb-3 text-sm font-semibold text-ink">
          {isToday ? "Today" : formatHeaderDate(activeDate)}
        </p>
        <TodayTimeline
          periods={periods}
          subjectNames={subjectNames}
          emptyLabel={isWeekend ? "Weekend — no classes." : "No classes."}
        />
      </Card>
    </>
  );
}

function formatHeaderDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
