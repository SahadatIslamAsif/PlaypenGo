// The nightly run (SPEC.md §7).
//
// The cron route is deliberately thin: it checks the bearer token and calls
// this. Everything that decides *what* happens tonight lives here, and
// everything that decides *whether* it happens — planWindow, the digest
// composition — lives in the two pure modules next door, so this file is only
// ever reading rows, applying a decision, and writing rows back.
//
// The order matters and is the order §7 describes:
//
//   1. Open new windows. A chapter that reached p80/p100 today should be
//      watched from tonight, not from tomorrow night.
//   2. Advance every open window — send, ask, or close (§7.3, §7.5).
//   3. Compose one digest per person and send it (§7.1, §7.4).
//
// Step 3 is last because steps 1 and 2 are what put things in it.
//
// Everything is per-student. §7.2 says to chunk the work — "a nightly job
// across several recipients should not depend on [60s] being generous" — and
// the shape below is that chunk: one student's whole evening is independent of
// every other student's, so a slow one cannot corrupt a fast one and a future
// batching pass has a natural seam to cut along.

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  DEFAULT_TIMEZONE,
  localDate,
  localDayOfWeek,
  nextClassDays,
  addDays,
} from "@/lib/routines/schedule";
import type { RoutinePeriodRow } from "@/lib/routines/grid";
import {
  CWM_WINDOW_OCCURRENCES,
  planWindow,
  type ExistingAlert,
} from "./window";
import {
  composeStudentDigest,
  composeTutorDigest,
  isEmptyDigest,
  isEmptyTutorDigest,
  subjectLine,
  tutorSubjectLine,
  type DigestAssessment,
  type DigestConfirm,
  type DigestResult,
  type DigestUnlogged,
  type StudentDigest,
  type TutorRow,
  type WeekInReview,
} from "./digest";
import { logSkippedEmpty, sendDigest, type SendOutcome } from "@/lib/email/send";
import {
  GuardianDigestEmail,
  StudentDigestEmail,
  TutorDigestEmail,
} from "@/lib/email/templates";

type Client = SupabaseClient<Database>;

/** §7.4 section 6: "no result after 2 days". */
const UNLOGGED_AFTER_DAYS = 2;

/** Thursday. §7.4 section 7 is Thursday-only. */
const REVIEW_DAY = 4;

/** How far back "logged since yesterday" reaches. One run to the next. */
const LOGGED_SINCE_HOURS = 24;

export type RunSummary = {
  today: string;
  windowsOpened: number;
  alertsSent: number;
  windowsClosed: number;
  emails: Record<SendOutcome, number>;
};

/**
 * §3.2: "url-safe random, 32+ chars." 32 bytes of base64url is 43 characters,
 * comfortably over the floor 0025 enforces, and url-safe without escaping.
 */
function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function runEveningDigest(supabase: Client, now: Date): Promise<RunSummary> {
  const summary: RunSummary = {
    today: localDate(now, DEFAULT_TIMEZONE),
    windowsOpened: 0,
    windowsClosed: 0,
    alertsSent: 0,
    emails: { sent: 0, failed: 0, skipped_empty: 0, already_sent: 0 },
  };

  const { data: students } = await supabase
    .from("profiles")
    .select("id, full_name, email, timezone")
    .eq("role", "student");

  const digests = new Map<string, StudentDigest>();

  for (const student of students ?? []) {
    const timeZone = student.timezone ?? DEFAULT_TIMEZONE;
    const today = localDate(now, timeZone);

    const periods = await loadRoutine(supabase, student.id);

    summary.windowsOpened += await openWindows(supabase, student.id, periods, today);

    const advanced = await advanceWindows(supabase, student.id, periods, today, now);
    summary.windowsClosed += advanced.closed;
    summary.alertsSent += advanced.sent;

    const digest = await composeFor(supabase, student, timeZone, today, now, advanced);
    digests.set(student.id, digest);

    await sendStudentAndGuardian(supabase, student, digest, today, summary);
  }

  await sendTutors(supabase, digests, now, summary);

  return summary;
}

// ---------------------------------------------------------------- the routine ---

async function loadRoutine(supabase: Client, studentId: string): Promise<RoutinePeriodRow[]> {
  const { data: routine } = await supabase
    .from("routines")
    .select("id")
    .eq("student_id", studentId)
    .eq("is_active", true)
    .maybeSingle();

  if (!routine) return [];

  const { data } = await supabase
    .from("routine_periods")
    .select("id, day_of_week, period_no, start_time, end_time, raw_text, teacher_raw, student_subject_id, is_academic")
    .eq("routine_id", routine.id);

  return (data ?? []) as RoutinePeriodRow[];
}

// -------------------------------------------------------------- 1. open windows ---

/**
 * §7.3's trigger: "Once a chapter reaches p80 or p100 with no result yet, open a
 * window on the next 4 class occurrences of that subject."
 *
 * One window per chapter, ever. A chapter whose window already exhausted is not
 * reopened — §7.5 is explicit that "a chapter at 100% with no result must not
 * nag past its window", and reopening on the next run would make the four-
 * occurrence cap meaningless. So the exclusion is *any* CWM assessment linked to
 * the chapter, whatever its status.
 *
 * A subject the routine never mentions gets no window at all rather than an
 * empty one. There is nothing to watch, and an assessment row with no
 * occurrences would be a window that can only ever close as exhausted.
 */
async function openWindows(
  supabase: Client,
  studentId: string,
  periods: RoutinePeriodRow[],
  today: string,
): Promise<number> {
  if (periods.length === 0) return 0;

  const { data: chapters } = await supabase
    .from("chapters")
    .select("id, student_subject_id")
    .eq("student_id", studentId)
    .in("status", ["p80", "p100"]);

  if (!chapters?.length) return 0;

  const { data: linked } = await supabase
    .from("assessment_chapters")
    .select("chapter_id, assessments!inner(type)")
    .eq("student_id", studentId)
    .in(
      "chapter_id",
      chapters.map((c) => c.id),
    );

  const alreadyWatched = new Set(
    (linked ?? [])
      .filter((row) => {
        const assessment = row.assessments as unknown as { type: string } | null;
        return assessment?.type === "CWM";
      })
      .map((row) => row.chapter_id),
  );

  let opened = 0;

  for (const chapter of chapters) {
    if (alreadyWatched.has(chapter.id)) continue;

    const occurrences = nextClassDays(
      periods,
      chapter.student_subject_id,
      today,
      CWM_WINDOW_OCCURRENCES,
    );
    if (occurrences.length === 0) continue;

    const { data: assessment, error } = await supabase
      .from("assessments")
      .insert({
        student_id: studentId,
        student_subject_id: chapter.student_subject_id,
        type: "CWM",
        status: "predicted",
        // The engine is acting for the student, and `created_by` is a NOT NULL
        // reference to a profile — there is no service account to name here.
        created_by: studentId,
      })
      .select("id")
      .single();

    if (error || !assessment) continue;

    // §5.3's on-confirm attach picks the window "whose chapter matches the
    // inferred chapter", so a window without this link can never be chosen.
    await supabase.from("assessment_chapters").insert({
      assessment_id: assessment.id,
      chapter_id: chapter.id,
      student_id: studentId,
    });

    opened += 1;
  }

  return opened;
}

// ----------------------------------------------------------- 2. advance windows ---

type AdvanceResult = {
  sent: number;
  closed: number;
  /** Every open occurrence in the horizon, for the digest's sections 1-3. */
  upcoming: DigestAssessment[];
  /** §7.4 section 5's Yes/No questions, tokens already minted. */
  confirms: DigestConfirm[];
};

type OpenAssessment = {
  id: string;
  type: "CT" | "CWM";
  status: string;
  scheduled_date: string | null;
  student_subject_id: string;
  paper_id: string | null;
  created_at: string;
};

async function advanceWindows(
  supabase: Client,
  studentId: string,
  periods: RoutinePeriodRow[],
  today: string,
  now: Date,
): Promise<AdvanceResult> {
  const result: AdvanceResult = { sent: 0, closed: 0, upcoming: [], confirms: [] };

  const { data: open } = await supabase
    .from("assessments")
    .select("id, type, status, scheduled_date, student_subject_id, paper_id, created_at")
    .eq("student_id", studentId)
    .is("window_closed_at", null)
    .in("status", ["predicted", "scheduled", "occurred"]);

  if (!open?.length) return result;

  const names = await subjectNames(supabase, studentId);
  const chapterNames = await chapterNamesByAssessment(
    supabase,
    studentId,
    open.map((a) => a.id),
  );

  for (const assessment of open as OpenAssessment[]) {
    const occurrences = occurrencesFor(assessment, periods);
    if (occurrences.length === 0) continue;

    const alerts = await loadAlerts(supabase, assessment.id);
    const plan = planWindow({ occurrences, today, alerts, timeZone: DEFAULT_TIMEZONE });

    if (plan.close) {
      await supabase
        .from("assessments")
        .update({ window_closed_at: now.toISOString(), window_close_reason: plan.close })
        .eq("id", assessment.id)
        .is("window_closed_at", null);

      result.closed += 1;
      continue;
    }

    if (plan.send) {
      // §3.2's key is the upsert target, so a cron double-fire inside one
      // evening collapses onto the row that already exists rather than
      // producing a second.
      const existing = alerts.find(
        (a) => a.kind === plan.send!.kind && a.target_date === plan.send!.targetDate,
      );

      await supabase.from("alerts").upsert(
        {
          student_id: studentId,
          assessment_id: assessment.id,
          kind: plan.send.kind,
          target_date: plan.send.targetDate,
          sent_count: (existing ? 1 : 0) + 1,
          last_sent_at: now.toISOString(),
        },
        { onConflict: "assessment_id,target_date,kind" },
      );

      result.sent += 1;
    }

    for (const targetDate of plan.confirms) {
      const { data: alert } = await supabase
        .from("alerts")
        .upsert(
          {
            student_id: studentId,
            assessment_id: assessment.id,
            kind: "confirm",
            target_date: targetDate,
            sent_count: 1,
            last_sent_at: now.toISOString(),
          },
          { onConflict: "assessment_id,target_date,kind" },
        )
        .select("id")
        .single();

      if (!alert) continue;

      const token = mintToken();
      const { error } = await supabase
        .from("confirm_tokens")
        .insert({ token, alert_id: alert.id });

      // `unique (alert_id)` means a re-run finds the question already asked.
      // Reuse the live token rather than minting a second one nobody can
      // answer — §7.6 gives an occurrence exactly one question.
      const usable = error
        ? (
            await supabase
              .from("confirm_tokens")
              .select("token, used_at")
              .eq("alert_id", alert.id)
              .maybeSingle()
          ).data
        : { token, used_at: null };

      if (!usable || usable.used_at) continue;

      result.confirms.push({
        assessmentId: assessment.id,
        subject: names.get(assessment.student_subject_id) ?? "That subject",
        targetDate,
        token: usable.token,
      });
    }

    // §7.6: an occurrence already answered Yes is waiting on a paper, not on
    // another class, so it belongs in "papers to log" rather than in what is
    // coming up.
    if (assessment.status === "occurred") continue;

    for (const date of occurrences) {
      if (date <= today) continue;
      result.upcoming.push({
        assessmentId: `${assessment.id}-${date}`,
        subject: names.get(assessment.student_subject_id) ?? "That subject",
        paper: assessment.paper_id ? (names.get(assessment.paper_id) ?? null) : null,
        type: assessment.type,
        date,
        predicted: assessment.type === "CWM",
        chapter: chapterNames.get(assessment.id) ?? null,
      });
    }
  }

  return result;
}

/**
 * §7.3: a CT window is its scheduled date; a CWM window is four occurrences off
 * the routine.
 *
 * The CWM case re-derives from `created_at` — the day the window was opened —
 * rather than from today, because §7.3 requires the same four dates every night:
 * "Re-derive the window's four occurrence dates the same way the window was
 * opened." Deriving from today would slide the window forward one class every
 * evening and it would never exhaust.
 */
function occurrencesFor(
  assessment: OpenAssessment,
  periods: RoutinePeriodRow[],
): string[] {
  if (assessment.type === "CT") {
    return assessment.scheduled_date ? [assessment.scheduled_date] : [];
  }

  return nextClassDays(
    periods,
    assessment.student_subject_id,
    assessment.created_at.slice(0, 10),
    CWM_WINDOW_OCCURRENCES,
  );
}

async function loadAlerts(supabase: Client, assessmentId: string): Promise<ExistingAlert[]> {
  const { data } = await supabase
    .from("alerts")
    .select("kind, target_date, last_sent_at, confirm_tokens(answer)")
    .eq("assessment_id", assessmentId);

  return (data ?? []).map((row) => {
    const tokens = row.confirm_tokens as unknown as { answer: string | null }[] | { answer: string | null } | null;
    const answer = Array.isArray(tokens) ? (tokens[0]?.answer ?? null) : (tokens?.answer ?? null);

    return {
      kind: row.kind as ExistingAlert["kind"],
      target_date: row.target_date,
      last_sent_at: row.last_sent_at,
      answer: answer === "yes" || answer === "no" ? answer : null,
    };
  });
}

// ------------------------------------------------------------------- lookups ---

/** Subject and paper display names in one map — both are looked up by id. */
async function subjectNames(supabase: Client, studentId: string): Promise<Map<string, string>> {
  const [{ data: subjects }, { data: papers }] = await Promise.all([
    supabase.from("student_subjects").select("id, display_name").eq("student_id", studentId),
    supabase.from("subject_papers").select("id, name").eq("student_id", studentId),
  ]);

  const names = new Map<string, string>();
  for (const s of subjects ?? []) names.set(s.id, s.display_name);
  for (const p of papers ?? []) names.set(p.id, p.name);
  return names;
}

async function chapterNamesByAssessment(
  supabase: Client,
  studentId: string,
  assessmentIds: string[],
): Promise<Map<string, string>> {
  if (assessmentIds.length === 0) return new Map();

  const { data } = await supabase
    .from("assessment_chapters")
    .select("assessment_id, chapters!inner(name)")
    .eq("student_id", studentId)
    .in("assessment_id", assessmentIds);

  const names = new Map<string, string>();
  for (const row of data ?? []) {
    const chapter = row.chapters as unknown as { name: string } | null;
    // A CT can span several chapters (0017). The digest names one and lets the
    // app show the rest — a comma-separated list of three chapter strings in a
    // 12px caption is unreadable on a phone.
    if (chapter && !names.has(row.assessment_id)) names.set(row.assessment_id, chapter.name);
  }
  return names;
}

// ------------------------------------------------------------- 3. the digest ---

type StudentRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  timezone: string | null;
};

async function composeFor(
  supabase: Client,
  student: StudentRow,
  timeZone: string,
  today: string,
  now: Date,
  advanced: AdvanceResult,
): Promise<StudentDigest> {
  const names = await subjectNames(supabase, student.id);

  const since = new Date(now.getTime() - LOGGED_SINCE_HOURS * 3600 * 1000).toISOString();

  const { data: logged } = await supabase
    .from("results")
    .select(
      "raw_obtained, raw_total, converted, converted_scale, percentage, paper_missing, assessments!inner(type, occurred_date, student_subject_id, paper_id)",
    )
    .eq("student_id", student.id)
    .gte("logged_at", since);

  const loggedResults: DigestResult[] = (logged ?? []).map((row) => {
    const a = row.assessments as unknown as {
      type: string;
      occurred_date: string | null;
      student_subject_id: string;
      paper_id: string | null;
    };

    return {
      subject: names.get(a.student_subject_id) ?? "That subject",
      paper: a.paper_id ? (names.get(a.paper_id) ?? null) : null,
      type: a.type === "CT" ? "CT" : "CWM",
      occurredDate: a.occurred_date ?? today,
      rawObtained: Number(row.raw_obtained),
      rawTotal: Number(row.raw_total),
      converted: Number(row.converted),
      convertedScale: Number(row.converted_scale),
      percentage: Number(row.percentage),
      paperMissing: row.paper_missing,
    };
  });

  const unlogged = await loadUnlogged(supabase, student.id, today, names);

  return composeStudentDigest({
    today,
    student: { id: student.id, name: student.full_name ?? "there" },
    upcoming: advanced.upcoming,
    logged: loggedResults,
    confirms: advanced.confirms,
    unlogged,
    weekInReview:
      localDayOfWeek(now, timeZone) === REVIEW_DAY
        ? await loadWeekInReview(supabase, student.id, today, names)
        : null,
  });
}

/**
 * §7.4 section 6: "assessments confirmed as having happened with no result after
 * 2 days."
 *
 * Confirmed, not merely predicted — status 'occurred' is what §7.6's Yes tap
 * sets, and it is also what a scanned-and-dated paper leaves behind. A window
 * still guessing is not an unlogged paper; it is a guess.
 */
async function loadUnlogged(
  supabase: Client,
  studentId: string,
  today: string,
  names: Map<string, string>,
): Promise<DigestUnlogged[]> {
  const cutoff = addDays(today, -UNLOGGED_AFTER_DAYS);

  const { data } = await supabase
    .from("assessments")
    .select("id, type, occurred_date, student_subject_id, results(id)")
    .eq("student_id", studentId)
    .eq("status", "occurred")
    .not("occurred_date", "is", null)
    .lte("occurred_date", cutoff);

  return (data ?? [])
    .filter((row) => {
      const results = row.results as unknown as unknown[] | null;
      return !results || (Array.isArray(results) ? results.length === 0 : false);
    })
    .map((row) => ({
      subject: names.get(row.student_subject_id) ?? "That subject",
      type: row.type === "CT" ? ("CT" as const) : ("CWM" as const),
      occurredDate: row.occurred_date!,
      daysWaiting: daysBetween(row.occurred_date!, today),
    }));
}

/** §7.4 section 7: per-subject averages, best and weakest chapters, coverage. */
async function loadWeekInReview(
  supabase: Client,
  studentId: string,
  today: string,
  names: Map<string, string>,
): Promise<WeekInReview | null> {
  const weekStart = addDays(today, -7);

  const [{ data: results }, { data: chapters }] = await Promise.all([
    supabase
      .from("results")
      .select(
        "percentage, assessments!inner(id, student_subject_id, occurred_date, assessment_chapters(chapters(name)))",
      )
      .eq("student_id", studentId)
      .gte("assessments.occurred_date", weekStart),
    supabase
      .from("chapters")
      .select("student_subject_id, status")
      .eq("student_id", studentId),
  ]);

  const bySubject = new Map<string, number[]>();
  for (const row of results ?? []) {
    const a = row.assessments as unknown as { student_subject_id: string };
    bySubject.set(a.student_subject_id, [
      ...(bySubject.get(a.student_subject_id) ?? []),
      Number(row.percentage),
    ]);
  }

  const subjectAverages = [...bySubject.entries()]
    .map(([subjectId, values]) => ({
      subject: names.get(subjectId) ?? "That subject",
      percentage: values.reduce((sum, v) => sum + v, 0) / values.length,
      count: values.length,
    }))
    .sort((a, b) => b.percentage - a.percentage);

  const coverageBySubject = new Map<string, { done: number; total: number }>();
  for (const chapter of chapters ?? []) {
    const entry = coverageBySubject.get(chapter.student_subject_id) ?? { done: 0, total: 0 };
    // 'not_taught' is the teacher shrinking the syllabus (§8), not a gap in the
    // student's coverage — it counts toward neither side of the fraction.
    if (chapter.status === "not_taught") continue;
    entry.total += 1;
    if (chapter.status === "p80" || chapter.status === "p100") entry.done += 1;
    coverageBySubject.set(chapter.student_subject_id, entry);
  }

  const coverage = [...coverageBySubject.entries()]
    .map(([subjectId, c]) => ({ subject: names.get(subjectId) ?? "That subject", ...c }))
    .filter((c) => c.total > 0)
    .sort((a, b) => a.subject.localeCompare(b.subject));

  if (subjectAverages.length === 0 && coverage.length === 0) return null;

  // §7.4 section 7's "best and weakest chapters". A chapter's score is the mean
  // of the results filed against it, because 0017 made the link many-to-many:
  // one CT can span three chapters and carries ONE combined mark, so that mark
  // counts toward each of them. Crude — the paper does not say which chapter
  // lost the marks — but it is the only honest reading of a combined score, and
  // it is what makes a repeatedly-weak chapter surface across several weeks.
  const byChapter = new Map<string, number[]>();
  for (const row of results ?? []) {
    const a = row.assessments as unknown as {
      assessment_chapters?: { chapters?: { name: string } | null }[] | null;
    };
    for (const link of a.assessment_chapters ?? []) {
      const name = link.chapters?.name;
      if (!name) continue;
      byChapter.set(name, [...(byChapter.get(name) ?? []), Number(row.percentage)]);
    }
  }

  const ranked = [...byChapter.entries()]
    .map(([chapter, values]) => ({
      chapter,
      percentage: values.reduce((sum, v) => sum + v, 0) / values.length,
    }))
    .sort((a, b) => b.percentage - a.percentage);

  // One chapter is not a best and a weakest at once. Reporting the same line
  // twice under opposite headings reads as a bug, and it is: with a single
  // chapter there is nothing to compare.
  const hasSpread = ranked.length > 1;

  return {
    subjectAverages,
    bestChapter: hasSpread ? ranked[0] : null,
    weakestChapter: hasSpread ? ranked[ranked.length - 1] : null,
    coverage,
  };
}

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(...(from.split("-").map(Number) as [number, number, number]));
  const b = Date.UTC(...(to.split("-").map(Number) as [number, number, number]));
  return Math.round((b - a) / 86_400_000);
}

// ------------------------------------------------------------------ sending ---

function baseUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

/**
 * What a skipped evening records as its subject line.
 *
 * Not the composed one: `subjectLine` always produces *something*, and on a
 * digest with nothing in it that something is the last fallback, which claims a
 * week in review that is not there. A log row nobody can trust is worse than a
 * dull one — this is the row someone reads at a parent meeting to explain why
 * no mail went out on a given evening.
 */
const NOTHING_TO_REPORT = "Nothing to report";

async function sendStudentAndGuardian(
  supabase: Client,
  student: StudentRow,
  digest: StudentDigest,
  today: string,
  summary: RunSummary,
): Promise<void> {
  const empty = isEmptyDigest(digest);
  const subject = empty ? NOTHING_TO_REPORT : subjectLine(digest);

  if (student.email) {
    const request = {
      supabase,
      recipientId: student.id,
      to: student.email,
      sendDate: today,
      emailType: "digest_student" as const,
      subject,
      element: (
        <StudentDigestEmail digest={digest} subject={subject} baseUrl={baseUrl()} />
      ),
      payload: digest,
    };

    const outcome = empty ? await logSkippedEmpty(request) : await sendDigest(request);
    summary.emails[outcome] += 1;
  }

  // §1 step 4: an approved link, never a pending one. A guardian the tutor has
  // not approved sees nothing and is mailed nothing.
  const { data: guardians } = await supabase
    .from("guardian_links")
    .select("guardian_id, profiles!guardian_links_guardian_id_fkey(email)")
    .eq("student_id", student.id)
    .eq("status", "approved");

  for (const link of guardians ?? []) {
    const profile = link.profiles as unknown as { email: string | null } | null;
    if (!profile?.email) continue;

    const request = {
      supabase,
      recipientId: link.guardian_id,
      to: profile.email,
      sendDate: today,
      emailType: "digest_guardian" as const,
      subject,
      element: <GuardianDigestEmail digest={digest} subject={subject} />,
      payload: digest,
    };

    const outcome = empty ? await logSkippedEmpty(request) : await sendDigest(request);
    summary.emails[outcome] += 1;
  }
}

async function sendTutors(
  supabase: Client,
  digests: Map<string, StudentDigest>,
  now: Date,
  summary: RunSummary,
): Promise<void> {
  const { data: tutors } = await supabase
    .from("profiles")
    .select("id, full_name, email, timezone")
    .eq("role", "tutor");

  for (const tutor of tutors ?? []) {
    if (!tutor.email) continue;

    const { data: links } = await supabase
      .from("tutor_links")
      .select("student_id")
      .eq("tutor_id", tutor.id)
      .eq("status", "approved");

    const rows = await Promise.all(
      (links ?? [])
        .map((l) => digests.get(l.student_id))
        .filter((d): d is StudentDigest => Boolean(d))
        .map(async (digest) => ({
          digest,
          trend: await trendFor(supabase, digest.student.id),
        })),
    );

    if (rows.length === 0) continue;

    const today = localDate(now, tutor.timezone ?? DEFAULT_TIMEZONE);
    const digest = composeTutorDigest(
      today,
      { id: tutor.id, name: tutor.full_name ?? "there" },
      rows,
    );
    const empty = isEmptyTutorDigest(digest);
    const subject = empty ? NOTHING_TO_REPORT : tutorSubjectLine(digest);

    const request = {
      supabase,
      recipientId: tutor.id,
      to: tutor.email,
      sendDate: today,
      emailType: "digest_tutor" as const,
      subject,
      element: <TutorDigestEmail digest={digest} subject={subject} />,
      payload: digest,
    };

    const outcome = empty ? await logSkippedEmpty(request) : await sendDigest(request);
    summary.emails[outcome] += 1;
  }
}

/**
 * §7.4: "who is trending down against their own average."
 *
 * Their own, never another student's — §0 rules out cross-student comparison
 * outright. The three most recent results against everything before them; null
 * until there is enough history for the comparison to mean anything, because a
 * trend drawn from two marks is noise presented as a finding.
 */
async function trendFor(supabase: Client, studentId: string): Promise<TutorRow["trend"]> {
  const { data } = await supabase
    .from("results")
    .select("percentage, logged_at")
    .eq("student_id", studentId)
    .order("logged_at", { ascending: false })
    .limit(20);

  const values = (data ?? []).map((r) => Number(r.percentage));
  if (values.length < 5) return null;

  const recent = values.slice(0, 3);
  const rest = values.slice(3);

  const mean = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const delta = mean(recent) - mean(rest);

  // Five percentage points either way. Below that a "trend" is a hard paper.
  if (delta > 5) return "up";
  if (delta < -5) return "down";
  return "flat";
}
