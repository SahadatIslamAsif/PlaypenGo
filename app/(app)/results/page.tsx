import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { ResultsScreen } from "./_components/results-screen";
import { buildResultsList, type ResultImageRow } from "@/lib/assessments/list";
import { toWeeklySeries } from "@/lib/assessments/series";
import { localDate } from "@/lib/routines/schedule";
import { signScriptImage } from "@/lib/scans/storage";
import { resolveViewedStudentId } from "@/lib/students/resolve";
import { createClient } from "@/lib/supabase/server";

export default async function ResultsPage({
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
    .select("role")
    .eq("id", user.id)
    .single();

  const role = profile?.role ?? "student";
  const { student } = await searchParams;
  const studentId = await resolveViewedStudentId(supabase, user.id, role, student);

  if (!studentId) {
    return (
      <Card>
        <p className="text-sm font-semibold text-ink">Nothing to show yet</p>
        <p className="mt-1 text-sm text-muted">
          {role === "guardian"
            ? "Once your link is approved, your student's results will appear here."
            : "Nothing linked yet."}
        </p>
      </Card>
    );
  }

  // §3.3: logging a result is the student's act alone, so this gates only the
  // entry sheet. The tutor's one write — correcting a mark already on the
  // screen, per 0018's results_update — is `canCorrect` below; a tutor
  // viewing this page via /tutor/[studentId]'s "View all results" link (or
  // `?student=`) gets that instead of `editable`/`canDelete`.
  const editable = role === "student";
  const canDelete = role === "student";
  const canCorrect = role === "tutor";

  const [
    { data: subjects },
    { data: papers },
    { data: chapters },
    { data: assessments },
    { data: results },
    { data: assessmentChapters },
  ] = await Promise.all([
    supabase
      .from("student_subjects")
      .select("id, display_name")
      .eq("student_id", studentId)
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("subject_papers")
      .select("id, student_subject_id, name")
      .eq("student_id", studentId),
    supabase
      .from("chapters")
      .select("id, student_subject_id, paper_id, name")
      .eq("student_id", studentId)
      .order("sort_order"),
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
      .from("assessment_chapters")
      .select("assessment_id, chapter_id")
      .eq("student_id", studentId),
  ]);

  const subjectRows = subjects ?? [];
  const paperRows = papers ?? [];
  const chapterRows = chapters ?? [];
  const assessmentRows = (assessments ?? []).map((a) => ({ ...a, type: a.type as "CT" | "CWM" }));
  const resultRows = (results ?? []).map((r) => ({ ...r, entry_mode: r.entry_mode as "ocr" | "manual" }));
  const assessmentChapterRows = assessmentChapters ?? [];

  // §5.3's evidence images - nothing displayed them behind a logged mark
  // anywhere until now. result_images_select (0021) already widens to
  // can_read_student(), so the guardian and tutor get exactly the same
  // signed URLs a student would; only the student ever gets a Delete.
  const resultIds = resultRows.map((r) => r.id);
  const { data: resultImageRows } = resultIds.length
    ? await supabase
        .from("result_images")
        .select("result_id, storage_path, page_no")
        .in("result_id", resultIds)
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
    paperRows,
    chapterRows,
    assessmentChapterRows,
    resultImages,
  );
  const series = toWeeklySeries(resultRows, assessmentRows, subjectRows);

  return (
    <ResultsScreen
      studentId={studentId}
      editable={editable}
      canDelete={canDelete}
      canCorrect={canCorrect}
      items={items}
      unloggedAssessments={assessmentRows}
      series={series}
      today={localDate(new Date())}
      subjects={subjectRows}
      papers={paperRows}
      chapters={chapterRows}
    />
  );
}
