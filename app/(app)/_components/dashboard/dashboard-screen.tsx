import { Card } from "@/components/ui/card";
import { DaySchedulePanel } from "./day-schedule-panel";
import { TrendChart } from "./progress-chart";
import { StatCardsRow } from "./stat-cards-row";
import { TodayTimeline } from "./today-timeline";
import { UpcomingList } from "./upcoming-list";
import type { RoutinePeriodRow } from "@/lib/routines/grid";
import type { SubjectSeries } from "@/lib/assessments/series";
import type { UpcomingItem } from "@/lib/assessments/upcoming";
import type { StatCardData } from "./stat-card";

// The two layouts genuinely differ in structure, not just column width, so
// both are rendered and toggled by breakpoint — the same approach
// routine-screen.tsx uses for its mobile day-list vs. desktop week table.
//
// Desktop (design system): main = stat cards -> "Your progress" chart ->
// "Coming up"; rail = month calendar -> today's periods as the Timeline.
//
// Mobile stack order is deliberately NOT the desktop order — "what matters is
// what happens tomorrow" goes above the fold: Coming up -> today's periods ->
// latest results carousel -> chart, last.

export function DashboardScreen({
  studentName,
  viewerName,
  viewerRole,
  statCards,
  series,
  upcoming,
  today,
  todaysPeriods,
  routinePeriods,
  subjectNames,
  ctDates,
}: {
  studentName: string | null;
  /** The signed-in user's own name — the student, when viewerRole is
   *  "student"; otherwise whoever is looking at this student's dashboard on
   *  their behalf. */
  viewerName: string | null;
  viewerRole: "student" | "guardian" | "tutor";
  statCards: StatCardData[];
  series: SubjectSeries[];
  upcoming: UpcomingItem[];
  today: string;
  todaysPeriods: RoutinePeriodRow[];
  /** The full week's periods (all `day_of_week` rows), so the desktop rail's
   *  calendar can show any picked date's classes without a fetch. */
  routinePeriods: RoutinePeriodRow[];
  subjectNames: Map<string, string>;
  ctDates: Set<string>;
}) {
  // A guardian (or tutor) is looking at someone else's dashboard, so the
  // greeting addresses them by their own name, not the student's — "Good
  // morning, Student" read like the app didn't know who it was talking to.
  // The student's name stays visible underneath instead of disappearing.
  const isOwnDashboard = viewerRole === "student";

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink max-sm:text-xl">
          {greeting()}
          {viewerName ? `, ${firstName(viewerName)}` : ""}
        </h1>
        {!isOwnDashboard && studentName ? (
          <p className="text-sm font-normal text-muted">Student: {studentName}</p>
        ) : null}
      </div>

      {/* ---------------------------------------------------------- mobile --- */}
      <div className="flex flex-col gap-5 lg:hidden">
        <Card>
          <p className="mb-3 text-sm font-semibold text-ink">Coming up</p>
          <UpcomingList items={upcoming} today={today} />
        </Card>

        <Card>
          <p className="mb-3 text-sm font-semibold text-ink">Today</p>
          <TodayTimeline periods={todaysPeriods} subjectNames={subjectNames} />
        </Card>

        <Card>
          <p className="mb-3 text-sm font-semibold text-ink">Latest results</p>
          <StatCardsRow items={statCards} layout="carousel" />
        </Card>

        <Card className="min-w-0 max-w-full overflow-hidden">
          <p className="mb-3 text-sm font-semibold text-ink">Your progress</p>
          <TrendChart series={series} today={today} weeksLimit={6} />
        </Card>
      </div>

      {/* --------------------------------------------------------- desktop --- */}
      <div className="hidden flex-col gap-5 lg:flex">
        <StatCardsRow items={statCards} layout="grid" emptyVariant="card" />

        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="flex min-w-0 flex-col gap-5">
            <Card className="min-w-0 max-w-full overflow-hidden">
              <p className="mb-3 text-sm font-semibold text-ink">Your progress</p>
              <TrendChart series={series} today={today} />
            </Card>

            <Card>
              <p className="mb-3 text-sm font-semibold text-ink">Coming up</p>
              <UpcomingList items={upcoming} today={today} />
            </Card>
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <DaySchedulePanel
              today={today}
              ctDates={ctDates}
              routinePeriods={routinePeriods}
              subjectNames={subjectNames}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
