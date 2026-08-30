import { redirect } from "next/navigation";
import Link from "next/link";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ResultCard } from "../../results/_components/result-card";
import {
  buildResultsList,
  listUnlogged,
  type ResultImageRow,
} from "@/lib/assessments/list";
import { buildUpcoming, itemsOnDate } from "@/lib/assessments/upcoming";
import { weakestChapters } from "@/lib/assessments/weak-chapters";
import { computeTrend } from "@/lib/assessments/trend";
import { buildWeekInReview, type WeekChapterRow, type WeekResultRow } from "@/lib/notifications/week-review";
import { addDays, localDate } from "@/lib/routines/schedule";
import { signScriptImage } from "@/lib/scans/storage";
import { createClient } from "@/lib/supabase/server";

// §8's per-student drill-down: "weak chapters, unlogged papers, trend
// against the student's own average" plus §3.3's one tutor write —
// "Correct a logged result in place" — which is what the embedded
// ResultCard list below is for (canCorrect, not canDelete or canAttach:
// those stay student-only per 0018).
//
// studentId must be a student this tutor actually has an approved link to —
// checked directly against tutor_links rather than trusting RLS alone, so an
// unauthorized id gets sent back to the roster instead of an empty-looking
// page that leaks the route shape.
export default async function TutorStudentPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if ((profile?.role ?? "student") !== "tutor") redirect("/");

  const { data: link } = await supabase
    .from("tutor_links")
    .select("id")
    .eq("tutor_id", user.id)
    .eq("student_id", studentId)
    .eq("status", "approved")
    .maybeSingle();

  if (!link) redirect("/tutor");

  const { data: studentProfile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", studentId)
    .single();

  const [
    { data: subjects },
    { data: chapters },
    { data: assessments },
    { data: results },
    { data: assessmentChapters },
    { data: routine },
  ] = await Promise.all([
    supabase.from("student_subjects").select("id, display_name").eq("student_id", studentId).eq("is_active", true),
    supabase.from("chapters").select("id, student_subject_id, status, name").eq("student_id", studentId),
    supabase
      .from("assessments")
      .select("id, student_subject_id, paper_id, type, status, scheduled_date, occurred_date")
      .eq("student_id", studentId),
    supabase
      .from("results")
      .select("id, assessment_id, raw_obtained, raw_total, converted, percentage, paper_missing, entry_mode, logged_at")
      .eq("student_id", studentId)
      .order("logged_at", { ascending: false }),
    supabase.from("assessment_chapters").select("assessment_id, chapter_id").eq("student_id", studentId),
    supabase.from("routines").select("id").eq("student_id", studentId).eq("is_active", true).maybeSingle(),
  ]);

  const { data: routinePeriods } = routine
    ? await supabase
        .from("routine_periods")
        .select("id, day_of_week, period_no, start_time, end_time, raw_text, teacher_raw, student_subject_id, is_academic")
        .eq("routine_id", routine.id)
    : { data: null };

  const subjectRows = subjects ?? [];
  const chapterRows = chapters ?? [];
  const assessmentRows = (assessments ?? []).map((a) => ({ ...a, type: a.type as "CT" | "CWM" }));
  const resultRows = (results ?? []).map((r) => ({ ...r, entry_mode: r.entry_mode as "ocr" | "manual" }));
  const assessmentChapterRows = assessmentChapters ?? [];
  const subjectNames = new Map(subjectRows.map((s) => [s.id, s.display_name]));

  const resultIds = resultRows.map((r) => r.id);
  const { data: resultImageRows } = resultIds.length
    ? await supabase.from("result_images").select("result_id, storage_path, page_no").in("result_id", resultIds)
    : { data: [] };

  const resultImages: ResultImageRow[] = (
    await Promise.all(
      (resultImageRows ?? []).map(async (row) => {
        const url = await signScriptImage(supabase, row.storage_path);
        return url ? { result_id: row.result_id, url, page_no: row.page_no } : null;
      }),
    )
  ).filter((row): row is ResultImageRow => row !== null);

  const items = buildResultsList(
    resultRows,
    assessmentRows,
    subjectRows,
    [],
    [],
    assessmentChapterRows,
    resultImages,
  );

  const today = localDate(new Date());
  const trend = computeTrend(resultRows.map((r) => r.percentage));

  const unloggedItems = listUnlogged(assessmentRows, null, today).map((a) => ({
    id: a.id,
    subjectName: subjectNames.get(a.student_subject_id) ?? "That subject",
    type: a.type,
    date: a.occurred_date ?? a.scheduled_date,
  }));

  const chaptersReady = chapterRows.filter(
    (c): c is typeof c & { status: "p80" | "p100" } => c.status === "p80" || c.status === "p100",
  );
  const upcoming = buildUpcoming(
    assessmentRows,
    chaptersReady,
    assessmentChapterRows,
    routinePeriods ?? [],
    subjectRows,
    today,
  );
  const tomorrow = itemsOnDate(upcoming, addDays(today, 1));

  const weak = weakestChapters(resultRows, assessmentRows, assessmentChapterRows, chapterRows);

  // §7.4 section 7's shape, computed on demand rather than only on the
  // Thursday digest's schedule - Thursday is an email cadence, not a rule
  // about when a tutor is allowed to see this. Built entirely from what's
  // already been fetched above; no extra query.
  const assessmentById = new Map(assessmentRows.map((a) => [a.id, a]));
  const chapterNameById = new Map(chapterRows.map((c) => [c.id, c.name]));
  const chapterIdsByAssessment = new Map<string, string[]>();
  for (const link of assessmentChapterRows) {
    const ids = chapterIdsByAssessment.get(link.assessment_id) ?? [];
    ids.push(link.chapter_id);
    chapterIdsByAssessment.set(link.assessment_id, ids);
  }

  const weekStart = addDays(today, -7);
  const weekResultRows: WeekResultRow[] = resultRows
    .map((r) => {
      const assessment = assessmentById.get(r.assessment_id);
      if (!assessment || !assessment.occurred_date || assessment.occurred_date < weekStart) return null;
      return {
        percentage: r.percentage,
        studentSubjectId: assessment.student_subject_id,
        chapterNames: (chapterIdsByAssessment.get(assessment.id) ?? [])
          .map((id) => chapterNameById.get(id))
          .filter((name): name is string => Boolean(name)),
      };
    })
    .filter((r): r is WeekResultRow => r !== null);

  const weekChapterRows: WeekChapterRow[] = chapterRows.map((c) => ({
    studentSubjectId: c.student_subject_id,
    status: c.status,
  }));

  const weekInReview = buildWeekInReview(weekResultRows, weekChapterRows, subjectNames);

  return (
    <div className="flex flex-col gap-5 pb-nav-clear lg:pb-0">
      <div>
        <Link href="/tutor" className="text-xs font-medium text-accent hover:underline">
          Students
        </Link>
        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-xl font-semibold text-ink">
              {studentProfile?.full_name ?? "Student"}
            </h1>
            <TrendBadge trend={trend} />
          </div>
          <Link
            href={`/tutor/${studentId}/reconciliation`}
            className="text-xs font-medium text-accent hover:underline"
          >
            Semester reconciliation
          </Link>
        </div>
      </div>

      <Card>
        <p className="text-sm font-semibold text-ink">Tomorrow</p>
        {tomorrow.length === 0 ? (
          <p className="mt-1 text-sm text-muted">Nothing due tomorrow.</p>
        ) : (
          <div className="mt-2 flex flex-col gap-1.5">
            {tomorrow.map((item) => (
              <p key={`${item.subjectId}-${item.kind}`} className="text-sm text-body">
                {item.subjectName} <span className="text-xs text-muted">· {item.kind === "scheduled_ct" ? "CT" : "CWM (predicted)"}</span>
              </p>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <p className="text-sm font-semibold text-ink">
          Unlogged papers {unloggedItems.length > 0 ? `(${unloggedItems.length})` : ""}
        </p>
        {unloggedItems.length === 0 ? (
          <p className="mt-1 text-sm text-muted">Nothing waiting to be logged.</p>
        ) : (
          <div className="mt-2 flex flex-col gap-1.5">
            {unloggedItems.map((item) => (
              <p key={item.id} className="text-sm text-body">
                {item.subjectName} <span className="text-xs text-muted">· {item.type}{item.date ? ` · ${item.date}` : ""}</span>
              </p>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <p className="text-sm font-semibold text-ink">Weak chapters</p>
        {weak.length === 0 ? (
          <p className="mt-1 text-sm text-muted">Not enough results yet to say.</p>
        ) : (
          <div className="mt-2 flex flex-col gap-1.5">
            {weak.map((w) => (
              <div key={w.chapterId} className="flex items-center justify-between text-sm">
                <p className="text-body">{w.chapterName}</p>
                <p className="text-xs text-muted">
                  {w.averagePercentage}% avg · {w.resultCount} result{w.resultCount === 1 ? "" : "s"}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {weekInReview ? (
        <Card>
          <p className="text-sm font-semibold text-ink">This week</p>
          <div className="mt-2 flex flex-col gap-1.5">
            {weekInReview.subjectAverages.map((s) => (
              <div key={s.subject} className="flex items-center justify-between text-sm">
                <p className="text-body">{s.subject}</p>
                <p className="text-xs text-muted">
                  {Math.round(s.percentage * 10) / 10}% avg · {s.count} result{s.count === 1 ? "" : "s"}
                </p>
              </div>
            ))}
          </div>
          {weekInReview.bestChapter ? (
            <p className="mt-2 text-xs text-muted">
              Best: {weekInReview.bestChapter.chapter} ({Math.round(weekInReview.bestChapter.percentage * 10) / 10}%)
            </p>
          ) : null}
          {weekInReview.weakestChapter ? (
            <p className="mt-1 text-xs text-muted">
              Weakest: {weekInReview.weakestChapter.chapter} (
              {Math.round(weekInReview.weakestChapter.percentage * 10) / 10}%)
            </p>
          ) : null}
        </Card>
      ) : null}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-ink">Results</p>
          <Link
            href={`/results?student=${studentId}`}
            className="text-xs font-medium text-accent hover:underline"
          >
            View chart & full history
          </Link>
        </div>
        {items.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">No results logged yet.</p>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <ResultCard key={item.resultId} item={item} canDelete={false} canAttach={false} canCorrect />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TrendBadge({ trend }: { trend: "up" | "down" | "flat" | null }) {
  if (trend === "up") {
    return (
      <span className="inline-flex items-center gap-1 rounded-pill bg-tint-mint px-2 py-0.5 text-xs font-medium text-tint-ink">
        <TrendingUp className="h-3.5 w-3.5" strokeWidth={1.5} /> Trending up
      </span>
    );
  }
  if (trend === "down") {
    return (
      <span className="inline-flex items-center gap-1 rounded-pill bg-danger-tint px-2 py-0.5 text-xs font-medium text-danger">
        <TrendingDown className="h-3.5 w-3.5" strokeWidth={1.5} /> Trending down
      </span>
    );
  }
  if (trend === "flat") {
    return (
      <span className="inline-flex items-center gap-1 rounded-pill bg-surface-sunk px-2 py-0.5 text-xs font-medium text-muted">
        <Minus className="h-3.5 w-3.5" strokeWidth={1.5} /> Flat
      </span>
    );
  }
  return null;
}
