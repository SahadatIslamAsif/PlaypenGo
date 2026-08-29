import { redirect } from "next/navigation";
import Link from "next/link";
import { AttachReviewScreen } from "./_components/attach-review-screen";
import { ReviewScreen, type SubjectOption } from "./_components/review-screen";
import { Card } from "@/components/ui/card";
import { resolveSubject, type SubjectCandidate } from "@/lib/routines/resolve";
import type { Agreement } from "@/lib/scans/confidence";
import type { RawParse } from "@/lib/scans/parse/schema";
import { signScanImage } from "@/lib/scans/storage";
import { createClient } from "@/lib/supabase/server";

// §5.3's verification modal, wired to a real job. jobId must be a job at
// status 'review' that belongs to this student - anything else (not
// found, someone else's job, a job still mid-flight) gets a status
// message instead of the edit form, never a crash or a silent redirect
// away from the link the student actually followed.
export default async function ScanReviewPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
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

  if ((profile?.role ?? "student") !== "student") redirect("/");

  // RLS (is_owner_student) already means a job that isn't this student's
  // own simply doesn't come back - no separate ownership check needed.
  const { data: job } = await supabase
    .from("scan_jobs")
    .select("id, status, error, raw_parse, result_id, target_result_id")
    .eq("id", jobId)
    .maybeSingle();

  if (!job) {
    return (
      <Card>
        <p className="text-sm font-semibold text-ink">Scan not found</p>
        <p className="mt-1 text-sm text-muted">
          This link doesn&apos;t match a paper you&apos;ve scanned.
        </p>
      </Card>
    );
  }

  // Server Actions refresh this route's server tree once confirmScanJob
  // returns, so this branch - not review-screen.tsx's own client-side
  // "saved" state - is what the student actually sees right after Save.
  // It has to read the real result rather than show a generic line, and it
  // has to work identically on a cold revisit of the same link later.
  if (job.status === "confirmed" && job.result_id) {
    const { data: result } = await supabase
      .from("results")
      .select("converted, percentage")
      .eq("id", job.result_id)
      .maybeSingle();

    return (
      <Card>
        <p className="text-sm font-semibold text-ink">Result saved</p>
        {result ? (
          <p className="mt-1 text-sm text-body">
            {result.converted !== null ? result.converted.toFixed(1) : "—"}
            {result.percentage !== null ? ` · ${result.percentage}%` : ""}
          </p>
        ) : null}
        <Link
          href="/results"
          className="mt-4 inline-flex h-10 items-center justify-center rounded-button bg-ink px-4 text-sm font-medium text-shell transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          View results
        </Link>
      </Card>
    );
  }

  if (job.status !== "review" || !job.raw_parse) {
    return (
      <Card>
        <p className="text-sm font-semibold text-ink">{statusHeadline(job.status)}</p>
        <p className="mt-1 text-sm text-muted">{statusDetail(job.status, job.error)}</p>
      </Card>
    );
  }

  const rawParse = job.raw_parse as unknown as RawParse;

  const { data: pagesForImages } = await supabase
    .from("scan_pages")
    .select("page_no, storage_path")
    .eq("scan_job_id", jobId)
    .order("page_no");

  const pageImages = await Promise.all(
    (pagesForImages ?? []).map((page) => signScanImage(supabase, page.storage_path)),
  );

  // §5.3's "attach paper later" - this job was created with a target result
  // already known (createScanJob's targetResultId), so there is no subject
  // to resolve and no marks to enter: the assessment already settled all of
  // that. A much smaller screen than the general review flow below, and it
  // returns before any of that flow's subject/CT/routine queries run.
  if (job.target_result_id) {
    const { data: target } = await supabase
      .from("results")
      .select("id, assessment_id, raw_obtained, raw_total, converted, percentage, entry_mode")
      .eq("id", job.target_result_id)
      .maybeSingle();

    // entry_mode flips to 'ocr' the moment a paper attaches (0023's own
    // guard on attach_scan_job_to_result) - a job whose target already moved
    // past 'manual' has nothing left to attach to, same "not ready" shape as
    // any other terminal status below.
    if (!target || target.entry_mode !== "manual") {
      return (
        <Card>
          <p className="text-sm font-semibold text-ink">Can&apos;t attach here</p>
          <p className="mt-1 text-sm text-muted">
            That result already has a paper attached, or no longer exists.
          </p>
        </Card>
      );
    }

    const { data: assessment } = await supabase
      .from("assessments")
      .select("student_subject_id, type, occurred_date")
      .eq("id", target.assessment_id)
      .maybeSingle();

    const { data: subject } = assessment
      ? await supabase
          .from("student_subjects")
          .select("display_name")
          .eq("id", assessment.student_subject_id)
          .maybeSingle()
      : { data: null };

    const { data: existingLinks } = await supabase
      .from("assessment_chapters")
      .select("chapter_id")
      .eq("assessment_id", target.assessment_id);

    const chaptersAlreadySet = (existingLinks ?? []).length > 0;

    const { data: chapterOptions } =
      !chaptersAlreadySet && assessment
        ? await supabase
            .from("chapters")
            .select("id, name")
            .eq("student_id", user.id)
            .eq("student_subject_id", assessment.student_subject_id)
            .order("sort_order")
        : { data: [] };

    return (
      <AttachReviewScreen
        jobId={jobId}
        resultId={target.id}
        rawParse={rawParse}
        pageImages={pageImages.map((url) => url ?? "")}
        seededChapters={chaptersAlreadySet ? [] : (chapterOptions ?? [])}
        chaptersAlreadySet={chaptersAlreadySet}
        profileName={profile?.full_name ?? ""}
        subjectName={subject?.display_name ?? "Unknown subject"}
        type={(assessment?.type as "CT" | "CWM") ?? "CWM"}
        occurredDate={assessment?.occurred_date ?? ""}
        rawObtained={target.raw_obtained}
        rawTotal={target.raw_total}
        converted={target.converted}
        percentage={target.percentage}
      />
    );
  }

  const [{ data: studentSubjects }, { data: aliases }, { data: routine }] = await Promise.all([
    supabase
      .from("student_subjects")
      .select("id, display_name, catalog_id")
      .eq("student_id", user.id)
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("subject_aliases")
      .select("alias_text, student_subject_id, catalog_id")
      .not("student_subject_id", "is", null),
    supabase
      .from("routines")
      .select("id")
      .eq("student_id", user.id)
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  // Same candidate-building as routine/page.tsx: student_subjects, each
  // merged with its own corrections (subject_aliases) and its catalogue
  // entry's common_aliases - one resolution rule for a routine cell and a
  // scanned header alike (lib/routines/resolve.ts's own point).
  const catalogIds = (studentSubjects ?? [])
    .map((s) => s.catalog_id)
    .filter((id): id is string => Boolean(id));

  const { data: catalog } = catalogIds.length
    ? await supabase.from("subjects_catalog").select("id, common_aliases").in("id", catalogIds)
    : { data: null };

  const catalogAliases = new Map((catalog ?? []).map((c) => [c.id, c.common_aliases ?? []]));

  const subjectCandidates: SubjectCandidate[] = (studentSubjects ?? []).map((subject) => ({
    id: subject.id,
    display_name: subject.display_name,
    aliases: [
      ...(aliases ?? [])
        .filter((a) => a.student_subject_id === subject.id)
        .map((a) => a.alias_text),
      ...(subject.catalog_id ? (catalogAliases.get(subject.catalog_id) ?? []) : []),
    ],
  }));

  const { subjectId: matchedSubjectId } = resolveSubject(
    rawParse.header.subject_raw ?? "",
    subjectCandidates,
  );

  const [{ data: chapters }, { data: scheduledCTs }, { data: periods }] = await Promise.all([
    matchedSubjectId
      ? supabase
          .from("chapters")
          .select("id, name")
          .eq("student_id", user.id)
          .eq("student_subject_id", matchedSubjectId)
          .order("sort_order")
      : Promise.resolve({ data: [] }),
    matchedSubjectId && rawParse.header.date
      ? supabase
          .from("assessments")
          .select("id")
          .eq("student_id", user.id)
          .eq("student_subject_id", matchedSubjectId)
          .eq("type", "CT")
          .eq("scheduled_date", rawParse.header.date)
          .neq("status", "cancelled")
      : Promise.resolve({ data: [] }),
    routine
      ? supabase
          .from("routine_periods")
          .select("day_of_week, is_academic, student_subject_id")
          .eq("routine_id", routine.id)
      : Promise.resolve({ data: [] }),
  ]);

  const subjectAgreement = weekdaySubjectAgreement(
    matchedSubjectId,
    rawParse.header.date,
    periods ?? [],
  );
  const typeAgreement: Agreement =
    (scheduledCTs?.length ?? 0) > 0
      ? rawParse.body_type_hint === "CT"
        ? "agree"
        : rawParse.body_type_hint === "CWM"
          ? "disagree"
          : "unknown"
      : "unknown";

  const subjectOptions: SubjectOption[] = (studentSubjects ?? []).map((s) => ({
    id: s.id,
    display_name: s.display_name,
  }));

  return (
    <ReviewScreen
      jobId={jobId}
      rawParse={rawParse}
      pageImages={pageImages.map((url) => url ?? "")}
      seededChapters={chapters ?? []}
      subjectOptions={subjectOptions}
      profileName={profile?.full_name ?? ""}
      matchedSubjectId={matchedSubjectId}
      subjectAgreement={subjectAgreement}
      typeAgreement={typeAgreement}
    />
  );
}

function statusHeadline(status: string): string {
  switch (status) {
    case "uploading":
      return "Still uploading";
    case "parsing":
      return "Still reading the paper";
    case "confirmed":
      return "Already saved";
    case "abandoned":
      return "This scan was discarded";
    case "failed":
      return "Couldn't read this paper";
    default:
      return "Not ready yet";
  }
}

function statusDetail(status: string, error: string | null): string {
  switch (status) {
    case "uploading":
    case "parsing":
      return "Come back once it's finished - this page will show the result to check.";
    case "confirmed":
      return "This paper's result is already logged - find it in Results.";
    case "abandoned":
      return "It was discarded before it finished uploading. Scan the paper again to try once more.";
    case "failed":
      return error ?? "The parse failed.";
    default:
      return "This page will show the result to check once it's ready.";
  }
}

/**
 * "Parsed subject vs the routine's subject for that weekday" (§5.3). No
 * periods that day (including no active routine at all - `periods` is
 * simply empty) is not evidence of anything either way, same reasoning
 * grouping.ts already applies to an unresolved page: absence reads as
 * "unknown", never as "disagree".
 */
function weekdaySubjectAgreement(
  matchedSubjectId: string | null,
  occurredDate: string | null,
  periods: { day_of_week: number; is_academic: boolean; student_subject_id: string | null }[],
): Agreement {
  if (!matchedSubjectId || !occurredDate) return "unknown";

  const weekday = new Date(`${occurredDate}T00:00:00Z`).getUTCDay();
  const daySubjects = new Set(
    periods
      .filter((p) => p.day_of_week === weekday && p.is_academic && p.student_subject_id)
      .map((p) => p.student_subject_id),
  );
  if (daySubjects.size === 0) return "unknown";

  return daySubjects.has(matchedSubjectId) ? "agree" : "disagree";
}
