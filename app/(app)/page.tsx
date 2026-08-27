import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { DashboardScreen } from "./_components/dashboard/dashboard-screen";
import type { StatCardData } from "./_components/dashboard/stat-card";
import { buildResultsList } from "@/lib/assessments/list";
import { toWeeklySeries } from "@/lib/assessments/series";
import { buildUpcoming } from "@/lib/assessments/upcoming";
import { localDate, todaysPeriods } from "@/lib/routines/schedule";
import { resolveViewedStudentId } from "@/lib/students/resolve";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  const { student } = await searchParams;
  const studentId = await resolveViewedStudentId(supabase, user.id, profile?.role, student);

  if (!studentId) {
    return (
      <Card>
        <p className="text-sm font-semibold text-ink">Nothing to show yet</p>
        <p className="mt-1 text-sm text-muted">
          {profile?.role === "guardian"
            ? "Once your link is approved, your student's dashboard will appear here."
            : "Nothing linked yet."}
        </p>
      </Card>
    );
  }

  const [
    { data: subjects },
    { data: assessments },
    { data: results },
    { data: chaptersReady },
    { data: routine },
    { data: studentProfile },
    { data: assessmentChapters },
  ] = await Promise.all([
    supabase
      .from("student_subjects")
      .select("id, display_name")
      .eq("student_id", studentId)
      .eq("is_active", true),
    supabase
      .from("assessments")
      .select("id, student_subject_id, paper_id, type, status, scheduled_date, occurred_date")
      .eq("student_id", studentId),
    supabase
      .from("results")
      .select("id, assessment_id, raw_obtained, raw_total, converted, percentage, paper_missing, entry_mode, logged_at")
      .eq("student_id", studentId)
      .order("logged_at", { ascending: false }),
    supabase
      .from("chapters")
      .select("id, student_subject_id, status")
      .eq("student_id", studentId)
      .in("status", ["p80", "p100"]),
    supabase
      .from("routines")
      .select("id")
      .eq("student_id", studentId)
      .eq("is_active", true)
      .maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", studentId).single(),
    supabase
      .from("assessment_chapters")
      .select("assessment_id, chapter_id")
      .eq("student_id", studentId),
  ]);

  const { data: routinePeriods } = routine
    ? await supabase
        .from("routine_periods")
        .select(
          "id, day_of_week, period_no, start_time, end_time, raw_text, teacher_raw, student_subject_id, is_academic",
        )
        .eq("routine_id", routine.id)
    : { data: null };

  const subjectRows = subjects ?? [];
  const assessmentRows = (assessments ?? []).map((a) => ({
    ...a,
    type: a.type as "CT" | "CWM",
  }));
  const resultRows = (results ?? []).map((r) => ({
    ...r,
    entry_mode: r.entry_mode as "ocr" | "manual",
  }));
  const chapterRows = (chaptersReady ?? []).map((c) => ({
    ...c,
    status: c.status as "p80" | "p100",
  }));
  const routinePeriodRows = routinePeriods ?? [];
  const assessmentChapterRows = assessmentChapters ?? [];

  const today = localDate(new Date());
  const subjectNames = new Map(subjectRows.map((s) => [s.id, s.display_name]));

  const resultsList = buildResultsList(resultRows, assessmentRows, subjectRows, [], []);
  const statCards: StatCardData[] = resultsList.slice(0, 3).map((r) => ({
    date: r.date,
    subjectName: r.subjectName,
    type: r.type,
    rawObtained: r.rawObtained,
    rawTotal: r.rawTotal,
    converted: r.converted,
    percentage: r.percentage,
  }));

  const series = toWeeklySeries(resultRows, assessmentRows, subjectRows);

  const upcoming = buildUpcoming(
    assessmentRows,
    chapterRows,
    assessmentChapterRows,
    routinePeriodRows,
    subjectRows,
    today,
  );

  const ctDates = new Set(
    assessmentRows
      .filter((a) => a.type === "CT" && a.scheduled_date)
      .map((a) => a.scheduled_date as string),
  );

  const { periods: todaysGridPeriods } = todaysPeriods(routinePeriodRows);

  return (
    <DashboardScreen
      studentName={studentProfile?.full_name ?? null}
      statCards={statCards}
      series={series}
      upcoming={upcoming}
      today={today}
      todaysPeriods={todaysGridPeriods}
      subjectNames={subjectNames}
      ctDates={ctDates}
    />
  );
}
