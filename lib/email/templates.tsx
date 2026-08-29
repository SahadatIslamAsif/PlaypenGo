// §7.4's three templates.
//
// "Three recipients, three templates, same job:
//    Student  — action-focused: what to revise, what to log.
//    Guardian — full transparency: same assessments, plus marks and trend.
//    Tutor    — one table across all linked students: who has what tomorrow,
//               who has unlogged papers, who is trending down against their own
//               average. Thursday adds a per-student roll-up."
//
// The difference between the student's and the guardian's is not the data —
// §1 forbids filtering ("Full transparency — no filtering of bad marks") — it is
// the address and the verbs. The student is told what to do; the guardian is
// told what happened. So the guardian's template carries no "log this" nudge and
// no Yes/No buttons, because §1 and §3.3 make the guardian read-only, and a
// button that writes would be the one edit affordance in their entire experience
// of the app.

import { Section, Text } from "@react-email/components";
import {
  type StudentDigest,
  type TutorDigest,
  describeAssessment,
} from "@/lib/notifications/digest";
import {
  AssessmentEntry,
  Card,
  CompactSchedule,
  ConfirmQuestion,
  DigestLayout,
  ResultRows,
  WeekInReviewCard,
} from "./components";
import { color, shortDate, style } from "./theme";

/** `/c/<token>?a=yes`. The base URL is the app's own origin. */
function confirmUrl(baseUrl: string, token: string, answer: "yes" | "no"): string {
  return `${baseUrl.replace(/\/$/, "")}/c/${token}?a=${answer}`;
}

// ------------------------------------------------------------------ student ---

export function StudentDigestEmail({
  digest,
  subject,
  baseUrl,
}: {
  digest: StudentDigest;
  subject: string;
  baseUrl: string;
}) {
  const upcoming = [...digest.tomorrow, ...digest.dayAfter, ...digest.restOfWeek.shown];

  return (
    <DigestLayout
      preview={subject}
      greeting={`Evening, ${firstName(digest.student.name)}`}
      subtitle="Here's what's coming and what still needs logging."
    >
      {/* §7.4's layout switch collapses sections 1-3 into one table when the
          next three days are busy. The sections stay separate otherwise: on a
          quiet evening a table of one row is more ceremony than information. */}
      {digest.compact ? (
        upcoming.length > 0 ? (
          <Card title="The next few days">
            <CompactSchedule assessments={upcoming} />
            {digest.restOfWeek.more > 0 ? (
              <Text style={{ ...style.caption, marginTop: "12px" }}>
                +{digest.restOfWeek.more} more later this week
              </Text>
            ) : null}
          </Card>
        ) : null
      ) : (
        <>
          {digest.tomorrow.length > 0 ? (
            <Card title="Tomorrow">
              {digest.tomorrow.map((a) => (
                <AssessmentEntry key={a.assessmentId} assessment={a} />
              ))}
            </Card>
          ) : null}

          {digest.dayAfter.length > 0 ? (
            <Card title="Day after">
              {digest.dayAfter.map((a) => (
                <AssessmentEntry key={a.assessmentId} assessment={a} />
              ))}
            </Card>
          ) : null}

          {digest.restOfWeek.shown.length > 0 ? (
            <Card title="Rest of the week">
              {digest.restOfWeek.shown.map((a) => (
                <AssessmentEntry key={a.assessmentId} assessment={a} showDate />
              ))}
              {digest.restOfWeek.more > 0 ? (
                <Text style={{ ...style.caption, marginTop: "8px" }}>
                  +{digest.restOfWeek.more} more
                </Text>
              ) : null}
            </Card>
          ) : null}
        </>
      )}

      {digest.logged.length > 0 ? (
        <Card title="Logged since yesterday">
          <ResultRows results={digest.logged} />
        </Card>
      ) : null}

      {digest.confirms.length > 0 ? (
        <Card title="Did this happen?">
          {digest.confirms.map((c) => (
            <ConfirmQuestion
              key={c.assessmentId}
              subject={c.subject}
              targetDate={c.targetDate}
              yesUrl={confirmUrl(baseUrl, c.token, "yes")}
              noUrl={confirmUrl(baseUrl, c.token, "no")}
            />
          ))}
        </Card>
      ) : null}

      {digest.unlogged.length > 0 ? (
        <Card title="Papers still to log">
          {digest.unlogged.map((u, i) => (
            <Section key={`${u.subject}-${i}`} style={style.entry}>
              <Text style={style.entryTitle}>
                {`${u.subject} ${u.type}`}
              </Text>
              <Text style={style.entryMeta}>
                {`${shortDate(u.occurredDate)} · waiting ${u.daysWaiting} ${u.daysWaiting === 1 ? "day" : "days"}`}
              </Text>
            </Section>
          ))}
          <Text style={{ ...style.caption, marginTop: "8px" }}>
            Scan the paper when it comes back and the mark files itself.
          </Text>
        </Card>
      ) : null}

      {digest.weekInReview ? <WeekInReviewCard review={digest.weekInReview} /> : null}
    </DigestLayout>
  );
}

// ----------------------------------------------------------------- guardian ---

export function GuardianDigestEmail({
  digest,
  subject,
}: {
  digest: StudentDigest;
  subject: string;
}) {
  const name = firstName(digest.student.name);
  const upcoming = [...digest.tomorrow, ...digest.dayAfter, ...digest.restOfWeek.shown];

  return (
    <DigestLayout
      preview={subject}
      greeting={`${name}'s day ahead`}
      subtitle="Assessments coming up, and every mark logged so far."
    >
      {digest.compact ? (
        upcoming.length > 0 ? (
          <Card title="The next few days">
            <CompactSchedule assessments={upcoming} />
          </Card>
        ) : null
      ) : (
        <>
          {digest.tomorrow.length > 0 ? (
            <Card title="Tomorrow">
              {digest.tomorrow.map((a) => (
                <AssessmentEntry key={a.assessmentId} assessment={a} />
              ))}
            </Card>
          ) : null}

          {digest.dayAfter.length > 0 ? (
            <Card title="Day after">
              {digest.dayAfter.map((a) => (
                <AssessmentEntry key={a.assessmentId} assessment={a} />
              ))}
            </Card>
          ) : null}

          {digest.restOfWeek.shown.length > 0 ? (
            <Card title="Rest of the week">
              {digest.restOfWeek.shown.map((a) => (
                <AssessmentEntry key={a.assessmentId} assessment={a} showDate />
              ))}
              {digest.restOfWeek.more > 0 ? (
                <Text style={{ ...style.caption, marginTop: "8px" }}>
                  +{digest.restOfWeek.more} more
                </Text>
              ) : null}
            </Card>
          ) : null}
        </>
      )}

      {/* §1: "Full transparency — no filtering of bad marks." Every result the
          student logged, exactly as they logged it. */}
      {digest.logged.length > 0 ? (
        <Card title="New marks">
          <ResultRows results={digest.logged} />
        </Card>
      ) : null}

      {/* No Yes/No buttons and no "log this" nudge: §3.3 makes the guardian
          read-only on every table, and an email that invited them to write
          would be promising something the database refuses. The fact is still
          reported — it just reads as news rather than as a task. */}
      {digest.unlogged.length > 0 ? (
        <Card title="Papers not yet logged">
          {digest.unlogged.map((u, i) => (
            <Section key={`${u.subject}-${i}`} style={style.entry}>
              <Text style={style.entryTitle}>
                {`${u.subject} ${u.type}`}
              </Text>
              {/* "Taken", not "Sat" — the short date already begins with a
                  weekday, and "Sat Tue 25 Aug" reads as a contradiction. */}
              <Text style={style.entryMeta}>
                {`Taken ${shortDate(u.occurredDate)} · mark not recorded yet`}
              </Text>
            </Section>
          ))}
        </Card>
      ) : null}

      {digest.weekInReview ? <WeekInReviewCard review={digest.weekInReview} /> : null}
    </DigestLayout>
  );
}

// -------------------------------------------------------------------- tutor ---

export function TutorDigestEmail({
  digest,
  subject,
}: {
  digest: TutorDigest;
  subject: string;
}) {
  const rows = digest.rows.filter(
    (r) => r.tomorrow.length > 0 || r.unloggedCount > 0 || r.weekInReview,
  );

  return (
    <DigestLayout
      preview={subject}
      greeting="Tonight across your students"
      subtitle="Sorted by unlogged papers — what hasn't been recorded is the point."
    >
      <Card title="Roster">
        <table style={style.table}>
          <thead>
            <tr>
              <th style={style.th}>Student</th>
              <th style={style.th}>Tomorrow</th>
              <th style={{ ...style.th, textAlign: "right" }}>Unlogged</th>
              <th style={{ ...style.th, textAlign: "right" }}>Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.studentId}>
                <td style={{ ...style.td, color: color.ink, fontWeight: 600 }}>
                  {r.studentName}
                </td>
                <td style={style.td}>
                  {r.tomorrow.length === 0 ? (
                    <span style={{ color: color.muted }}>Nothing</span>
                  ) : (
                    r.tomorrow.map((a) => (
                      <div key={a.assessmentId}>{describeAssessment(a)}</div>
                    ))
                  )}
                </td>
                <td
                  style={{
                    ...style.td,
                    ...style.numeric,
                    textAlign: "right",
                    fontWeight: r.unloggedCount > 0 ? 600 : 400,
                    color: r.unloggedCount > 0 ? color.ink : color.muted,
                  }}
                >
                  {r.unloggedCount}
                </td>
                <td style={{ ...style.td, textAlign: "right", color: color.muted }}>
                  {trendLabel(r.trend)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Thursday's per-student roll-up. */}
      {rows
        .filter((r) => r.weekInReview)
        .map((r) => (
          <Section key={`${r.studentId}-review`}>
            <Text style={{ ...style.caption, margin: "16px 0 4px" }}>{r.studentName}</Text>
            <WeekInReviewCard review={r.weekInReview!} />
          </Section>
        ))}
    </DigestLayout>
  );
}

/**
 * Words, not arrows. §7.4 asks for "who is trending down against their own
 * average"; a bare glyph would be smaller but reads as decoration in a table
 * that is otherwise all text, and the design system bans emoji outright.
 */
function trendLabel(trend: "up" | "down" | "flat" | null): string {
  switch (trend) {
    case "up":
      return "Up";
    case "down":
      return "Down";
    case "flat":
      return "Steady";
    default:
      return "—";
  }
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "there";
}
