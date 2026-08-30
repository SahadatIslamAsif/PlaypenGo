// Composing the 8pm digest (ARCHITECTURE.md §7.1, §7.4).
//
// §7.1 is the constraint everything here answers to: "One email, per person,
// per day, maximum. Everything is folded into a single 8:00 PM (Asia/Dhaka)
// message. If every section is empty, nothing is sent. Violating this gets the
// app muted in week two."
//
// So this file does three jobs and no others:
//
//   1. Slice already-fetched rows into §7.4's seven sections, applying the one
//      cap the spec allows and refusing the ones it forbids.
//   2. Decide whether the result is empty, because that decision is what stands
//      between the app and being muted.
//   3. Write the subject line, which §7.4 requires to be useful unopened.
//
// Rendering is not here — §7.4's three recipients get three templates, and both
// the student's and the guardian's read from the same composed digest. The
// difference between them is what they are shown, not what was computed.
//
// Pure throughout: the route fetches, this arranges, the templates render.

import { addDays } from "@/lib/routines/schedule";

export type AssessmentType = "CT" | "CWM";

/** One upcoming assessment, its date already resolved to a single occurrence. */
export type DigestAssessment = {
  assessmentId: string;
  subject: string;
  paper: string | null;
  type: AssessmentType;
  /** The scheduled date for a CT, the occurrence being watched for a CWM. */
  date: string;
  /**
   * True for a CWM window occurrence, false for a CT on the calendar. Drives
   * the word "likely" everywhere this is rendered: the app must never present a
   * prediction as a fact, and §0 is explicit that a CWM has no announced date.
   */
  predicted: boolean;
  chapter: string | null;
};

export type DigestResult = {
  subject: string;
  paper: string | null;
  type: AssessmentType;
  occurredDate: string;
  rawObtained: number;
  rawTotal: number;
  converted: number;
  convertedScale: number;
  percentage: number;
  paperMissing: boolean;
};

/** §7.4 section 5 / §7.6: one occurrence, and the token that answers for it. */
export type DigestConfirm = {
  assessmentId: string;
  subject: string;
  targetDate: string;
  token: string;
};

/** §7.4 section 6: confirmed as having happened, still no result. */
export type DigestUnlogged = {
  subject: string;
  type: AssessmentType;
  occurredDate: string;
  daysWaiting: number;
};

/** §7.4 section 7, Thursdays only. */
export type WeekInReview = {
  subjectAverages: { subject: string; percentage: number; count: number }[];
  bestChapter: { chapter: string; percentage: number } | null;
  weakestChapter: { chapter: string; percentage: number } | null;
  coverage: { subject: string; done: number; total: number }[];
};

export type DigestInput = {
  /** The date the digest is being sent, in the recipient's timezone. */
  today: string;
  student: { id: string; name: string };
  /** Every open occurrence in the horizon, in any order. */
  upcoming: DigestAssessment[];
  logged: DigestResult[];
  confirms: DigestConfirm[];
  unlogged: DigestUnlogged[];
  weekInReview: WeekInReview | null;
};

export type StudentDigest = {
  today: string;
  student: { id: string; name: string };
  tomorrow: DigestAssessment[];
  dayAfter: DigestAssessment[];
  restOfWeek: { shown: DigestAssessment[]; more: number };
  logged: DigestResult[];
  confirms: DigestConfirm[];
  unlogged: DigestUnlogged[];
  weekInReview: WeekInReview | null;
  /**
   * §7.4's layout switch: "when 3+ assessments fall within the next 3 days,
   * render a compact day-by-day table instead of prose blocks, so exam week is
   * scannable rather than a wall of text."
   */
  compact: boolean;
};

/**
 * §7.4 section 3's cap. Sections 1 and 2 have none, deliberately — "Tomorrow
 * and Day after are never truncated: during the week before exams there can
 * legitimately be several CTs a day, and hiding them defeats the product."
 */
export const REST_OF_WEEK_LIMIT = 5;

/**
 * How far past the day after "rest of the week" reaches.
 *
 * §7.4 names the section but not its horizon. A rolling seven days is the
 * reading that stays useful: a calendar week would make this section
 * permanently empty on a Thursday, which is precisely the evening the digest
 * also carries the week in review and the student is most likely to be planning
 * ahead.
 */
const HORIZON_DAYS = 7;

export function composeStudentDigest(input: DigestInput): StudentDigest {
  const { today, upcoming } = input;

  const tomorrow = addDays(today, 1);
  const dayAfter = addDays(today, 2);
  const horizonEnd = addDays(today, HORIZON_DAYS);

  const on = (date: string) =>
    upcoming.filter((a) => a.date === date).sort(compareAssessments);

  const rest = upcoming
    .filter((a) => a.date > dayAfter && a.date <= horizonEnd)
    .sort(compareAssessments);

  // §7.4's layout switch counts assessments across the next three days —
  // tomorrow, the day after, and the one after that. Today is excluded: the
  // digest is about what is coming, and a test that already happened this
  // morning does not make tomorrow's list harder to scan.
  const withinThreeDays = upcoming.filter(
    (a) => a.date > today && a.date <= addDays(today, 3),
  ).length;

  return {
    today,
    student: input.student,
    tomorrow: on(tomorrow),
    dayAfter: on(dayAfter),
    restOfWeek: {
      shown: rest.slice(0, REST_OF_WEEK_LIMIT),
      more: Math.max(0, rest.length - REST_OF_WEEK_LIMIT),
    },
    logged: [...input.logged].sort((a, b) => a.occurredDate.localeCompare(b.occurredDate)),
    confirms: [...input.confirms].sort((a, b) => a.targetDate.localeCompare(b.targetDate)),
    unlogged: [...input.unlogged].sort((a, b) => b.daysWaiting - a.daysWaiting),
    weekInReview: input.weekInReview,
    compact: withinThreeDays >= 3,
  };
}

/** Date first, then a CT ahead of a CWM: a known date outranks a prediction. */
function compareAssessments(a: DigestAssessment, b: DigestAssessment): number {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  if (a.type !== b.type) return a.type === "CT" ? -1 : 1;
  return a.subject.localeCompare(b.subject);
}

/**
 * §7.1: "If every section is empty, nothing is sent."
 *
 * Every section, including the week in review — a Thursday with no assessments,
 * no results and nothing outstanding still has nothing to say, and a roll-up of
 * an empty week is not a reason to write to someone.
 */
export function isEmptyDigest(digest: StudentDigest): boolean {
  return (
    digest.tomorrow.length === 0 &&
    digest.dayAfter.length === 0 &&
    digest.restOfWeek.shown.length === 0 &&
    digest.logged.length === 0 &&
    digest.confirms.length === 0 &&
    digest.unlogged.length === 0 &&
    !digest.weekInReview
  );
}

/** "Physics CT", "Chemistry CWM likely". */
export function describeAssessment(a: DigestAssessment): string {
  const name = a.paper ? `${a.subject} ${a.paper}` : a.subject;
  return a.predicted ? `${name} ${a.type} likely` : `${name} ${a.type}`;
}

/** How many assessments a subject line names before it says "+N more". */
const SUBJECT_LINE_ITEMS = 2;

/**
 * §7.4: "Adaptive subject line: `Tomorrow: Physics CT + Chemistry CWM likely` —
 * useful even unopened. Generic subject lines get ignored."
 *
 * The fallbacks matter as much as the headline case. A digest that goes out
 * because two papers came back, or because the app needs a Yes/No tap, must say
 * so in the subject — falling back to the app's name would be exactly the
 * generic line the spec rejects.
 */
export function subjectLine(digest: StudentDigest): string {
  if (digest.tomorrow.length > 0) {
    return `Tomorrow: ${joinAssessments(digest.tomorrow)}`;
  }

  if (digest.dayAfter.length > 0) {
    return `Day after: ${joinAssessments(digest.dayAfter)}`;
  }

  if (digest.confirms.length > 0) {
    const first = digest.confirms[0];
    return digest.confirms.length === 1
      ? `Did the ${first.subject} CWM happen?`
      : `Did these ${digest.confirms.length} CWMs happen?`;
  }

  if (digest.logged.length > 0) {
    const first = digest.logged[0];
    return digest.logged.length === 1
      ? `${first.subject} ${first.type}: ${formatRaw(first.rawObtained)}/${formatRaw(first.rawTotal)}`
      : `${digest.logged.length} results logged`;
  }

  if (digest.unlogged.length > 0) {
    return digest.unlogged.length === 1
      ? `${digest.unlogged[0].subject} paper still unlogged`
      : `${digest.unlogged.length} papers still unlogged`;
  }

  if (digest.restOfWeek.shown.length > 0) {
    return `This week: ${joinAssessments(digest.restOfWeek.shown)}`;
  }

  // Reachable only on a Thursday whose sole content is the roll-up.
  return "Your week in review";
}

function joinAssessments(items: DigestAssessment[]): string {
  const named = items.slice(0, SUBJECT_LINE_ITEMS).map(describeAssessment).join(" + ");
  const more = items.length - SUBJECT_LINE_ITEMS;
  return more > 0 ? `${named} +${more} more` : named;
}

/**
 * The raw mark, exactly as the teacher wrote it on the paper: `8/10`, `15/15`.
 * Whole numbers stay whole — a teacher who wrote 8 did not write 8.0.
 */
export function formatRaw(value: number): string {
  return String(value);
}

/**
 * The converted mark, always to one decimal place — §6: "One decimal place, as
 * the school does." That includes the no-op case the spec calls out
 * specifically: a CWM of 15/15 converts to `15.0 / 15`, and rendering it as
 * `15` would quietly present a converted mark in a different shape from every
 * other converted mark in the same email.
 */
export function formatConverted(value: number): string {
  return value.toFixed(1);
}

// ---------------------------------------------------------------- the tutor ---
//
// §7.4: "Tutor — one table across all linked students: who has what tomorrow,
// who has unlogged papers, who is trending down against their own average.
// Thursday adds a per-student roll-up."
//
// §8 sharpens what the table is for: "The tutor does not log papers. The
// dashboard's job is noticing what the student hasn't logged." So the row is
// sorted by that, not by name.

export type TutorRow = {
  studentId: string;
  studentName: string;
  tomorrow: DigestAssessment[];
  unloggedCount: number;
  /**
   * The student against their own average, never against another student —
   * §0's non-goals rule out cross-student comparison entirely. Null when there
   * is not enough history to say anything honest.
   */
  trend: "up" | "down" | "flat" | null;
  weekInReview: WeekInReview | null;
};

export type TutorDigest = {
  today: string;
  tutor: { id: string; name: string };
  rows: TutorRow[];
};

export function composeTutorDigest(
  today: string,
  tutor: { id: string; name: string },
  digests: { digest: StudentDigest; trend: TutorRow["trend"] }[],
): TutorDigest {
  const rows: TutorRow[] = digests.map(({ digest, trend }) => ({
    studentId: digest.student.id,
    studentName: digest.student.name,
    tomorrow: digest.tomorrow,
    unloggedCount: digest.unlogged.length,
    trend,
    weekInReview: digest.weekInReview,
  }));

  // Unlogged count first — "the primary signal on this screen" (§8) — then
  // tomorrow's load, then name so the order is stable night to night.
  rows.sort(
    (a, b) =>
      b.unloggedCount - a.unloggedCount ||
      b.tomorrow.length - a.tomorrow.length ||
      a.studentName.localeCompare(b.studentName),
  );

  return { today, tutor, rows };
}

/** A tutor digest with nothing to report on any student is not sent either. */
export function isEmptyTutorDigest(digest: TutorDigest): boolean {
  return digest.rows.every(
    (r) =>
      r.tomorrow.length === 0 && r.unloggedCount === 0 && !r.weekInReview,
  );
}

export function tutorSubjectLine(digest: TutorDigest): string {
  const unlogged = digest.rows.reduce((sum, r) => sum + r.unloggedCount, 0);
  const withWork = digest.rows.filter((r) => r.tomorrow.length > 0);

  if (unlogged > 0 && withWork.length > 0) {
    return `${withWork.length} student${withWork.length === 1 ? "" : "s"} with work tomorrow, ${unlogged} unlogged`;
  }

  if (unlogged > 0) {
    return `${unlogged} unlogged paper${unlogged === 1 ? "" : "s"}`;
  }

  if (withWork.length === 1) {
    return `${withWork[0].studentName} tomorrow: ${joinAssessments(withWork[0].tomorrow)}`;
  }

  if (withWork.length > 1) {
    return `${withWork.length} students with work tomorrow`;
  }

  return "Your week in review";
}
