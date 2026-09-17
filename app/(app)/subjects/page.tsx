import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { SubjectTree } from "@/app/(app)/_components/subject-tree";
import { buildSubjectTree } from "@/lib/subjects/tree";
import { localDate } from "@/lib/routines/schedule";
import { createClient } from "@/lib/supabase/server";

export default async function SubjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  // Tutor drill-down into a student's tree is Phase 7 (a student roster
  // doesn't exist yet); nothing to show here for a tutor in the meantime.
  if (profile?.role === "tutor") {
    redirect("/");
  }

  let studentId = user.id;

  if (profile?.role === "guardian") {
    const { data: link } = await supabase
      .from("guardian_links")
      .select("student_id")
      .eq("guardian_id", user.id)
      .eq("status", "approved")
      .limit(1)
      .maybeSingle();

    if (!link) {
      return (
        <Card>
          <p className="text-sm font-semibold text-ink">Nothing to show yet</p>
          <p className="mt-1 text-sm text-muted">
            Once your link is approved, your student&apos;s subjects will appear here.
          </p>
        </Card>
      );
    }

    studentId = link.student_id;
  }

  const editable = profile?.role === "student";

  const [
    { data: subjects },
    { data: papers },
    { data: chapters },
    { data: catalog },
    { data: ctAssessments },
    { data: ctChapterLinks },
  ] = await Promise.all([
      supabase
        .from("student_subjects")
        .select("id, display_name, teacher_name, sort_order")
        .eq("student_id", studentId)
        .order("sort_order"),
      supabase
        .from("subject_papers")
        .select("id, student_subject_id, name, sort_order")
        .eq("student_id", studentId)
        .order("sort_order"),
      supabase
        .from("chapters")
        .select("id, student_subject_id, paper_id, name, status, sort_order, syllabus_removed_at")
        .eq("student_id", studentId)
        .order("sort_order"),
      editable
        ? supabase.from("subjects_catalog").select("id, name, common_aliases").order("name")
        : Promise.resolve({ data: [] }),
      // Every CT for the student — buildSubjectTree() matches against
      // ctChapterLinks below (vestigial: nothing in the UI reads
      // ChapterNode.ct any more, now that a CT is scheduled at the subject
      // level, but the tree stays exactly the shape it already is rather
      // than touching that code path for this change). student_subject_id
      // is read here for the default "CT N" name the schedule sheet
      // proposes - 0031's backfill numbers by count per subject, and the UI
      // has to compute the same number to stay in step with it.
      supabase
        .from("assessments")
        .select("id, scheduled_date, status, student_subject_id")
        .eq("student_id", studentId)
        .eq("type", "CT")
        .order("created_at", { ascending: true }),
      // 0017: which chapters each CT covers now lives in its own table.
      supabase
        .from("assessment_chapters")
        .select("assessment_id, chapter_id")
        .eq("student_id", studentId),
    ]);

  const tree = buildSubjectTree(
    subjects ?? [],
    papers ?? [],
    chapters ?? [],
    ctAssessments ?? [],
    ctChapterLinks ?? [],
  );

  const today = localDate(new Date());
  const ctDates = new Set(
    (ctAssessments ?? [])
      .filter((a) => a.scheduled_date)
      .map((a) => a.scheduled_date as string),
  );

  // 0031's backfill numbers "CT N" by count per subject, cancelled rows
  // included - the schedule sheet's default name has to count the same way,
  // or a student with three CTs (one cancelled) would be offered "CT 3" for
  // what 0031 already numbered "CT 4".
  const ctCounts = new Map<string, number>();
  for (const a of ctAssessments ?? []) {
    ctCounts.set(a.student_subject_id, (ctCounts.get(a.student_subject_id) ?? 0) + 1);
  }

  return (
    <SubjectTree
      tree={tree}
      editable={editable}
      catalog={catalog ?? []}
      studentId={studentId}
      today={today}
      ctDates={ctDates}
      ctCounts={ctCounts}
    />
  );
}
