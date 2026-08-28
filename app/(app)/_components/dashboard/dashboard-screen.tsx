import { Card } from "@/components/ui/card";
import { MiniCalendar } from "../mini-calendar";
import { DesktopProgressChart, MobileProgressChart } from "./progress-chart";
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
  statCards,
  series,
  upcoming,
  today,
  todaysPeriods,
  subjectNames,
  ctDates,
}: {
  studentName: string | null;
  statCards: StatCardData[];
  series: SubjectSeries[];
  upcoming: UpcomingItem[];
  today: string;
  todaysPeriods: RoutinePeriodRow[];
  subjectNames: Map<string, string>;
  ctDates: Set<string>;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink max-sm:text-xl">
          {greeting()}
          {studentName ? `, ${firstName(studentName)}` : ""}
        </h1>
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

        <Card>
          <p className="mb-3 text-sm font-semibold text-ink">Your progress</p>
          <MobileProgressChart series={series} today={today} />
        </Card>
      </div>

      {/* --------------------------------------------------------- desktop --- */}
      <div className="hidden gap-5 lg:grid lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-5">
          <StatCardsRow items={statCards} layout="grid" emptyVariant="card" />

          <Card>
            <p className="mb-3 text-sm font-semibold text-ink">Your progress</p>
            <DesktopProgressChart series={series} />
          </Card>

          <Card>
            <p className="mb-3 text-sm font-semibold text-ink">Coming up</p>
            <UpcomingList items={upcoming} today={today} />
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <MiniCalendar today={today} ctDates={ctDates} />
          </Card>

          <Card>
            <p className="mb-3 text-sm font-semibold text-ink">Today</p>
            <TodayTimeline periods={todaysPeriods} subjectNames={subjectNames} />
          </Card>
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
