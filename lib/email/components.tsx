// Shared pieces of the three digest templates (§7.4).
//
// "Three recipients, three templates, same job." The templates differ in what
// they show and how they address the reader; the shapes below are what all
// three draw from, so a change to how an assessment reads happens once.

import type { ReactNode } from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import {
  describeAssessment,
  formatConverted,
  formatRaw,
  type DigestAssessment,
  type DigestResult,
  type WeekInReview,
} from "@/lib/notifications/digest";
import { color, shortDate, style } from "./theme";

export function DigestLayout({
  preview,
  greeting,
  subtitle,
  children,
}: {
  preview: string;
  greeting: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <Html lang="en">
      <Head />
      {/* The inbox preview line. Set to the subject line's own content so the
          two agree rather than the client guessing from the first paragraph. */}
      <Preview>{preview}</Preview>
      <Body style={style.body}>
        <Container style={style.container}>
          <Heading style={style.greeting}>{greeting}</Heading>
          {subtitle ? <Text style={{ ...style.caption, marginBottom: "20px" }}>{subtitle}</Text> : null}
          {children}
          <Text style={style.footer}>
            PlaypenGo — a running record of assessments the school portal publishes
            at semester end.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Section style={style.card}>
      <Heading as="h2" style={style.sectionTitle}>
        {title}
      </Heading>
      {children}
    </Section>
  );
}

/**
 * One assessment as the design system's timeline entry: a tinted card with an
 * accent bar on its left edge.
 *
 * A predicted CWM is always worded as a prediction — `describeAssessment`
 * appends "likely" — because §0 is clear that a CWM has no announced date and
 * the app must never present its guess as one.
 */
export function AssessmentEntry({
  assessment,
  showDate = false,
}: {
  assessment: DigestAssessment;
  showDate?: boolean;
}) {
  return (
    <Section style={style.entry}>
      <Text style={style.entryTitle}>{describeAssessment(assessment)}</Text>
      {assessment.chapter || showDate ? (
        <Text style={style.entryMeta}>
          {[showDate ? shortDate(assessment.date) : null, assessment.chapter]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      ) : null}
    </Section>
  );
}

/**
 * §7.4's layout switch: "when 3+ assessments fall within the next 3 days, render
 * a compact day-by-day table instead of prose blocks, so exam week is scannable
 * rather than a wall of text."
 */
export function CompactSchedule({ assessments }: { assessments: DigestAssessment[] }) {
  const byDate = new Map<string, DigestAssessment[]>();
  for (const a of assessments) {
    byDate.set(a.date, [...(byDate.get(a.date) ?? []), a]);
  }

  return (
    <table style={style.table}>
      <thead>
        <tr>
          <th style={{ ...style.th, width: "34%" }}>Day</th>
          <th style={style.th}>Assessments</th>
        </tr>
      </thead>
      <tbody>
        {[...byDate.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, items]) => (
            <tr key={date}>
              <td style={{ ...style.td, color: color.ink, fontWeight: 600 }}>
                {shortDate(date)}
              </td>
              <td style={style.td}>
                {items.map((a) => (
                  <div key={a.assessmentId}>{describeAssessment(a)}</div>
                ))}
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}

/**
 * §7.4 section 4: "results with raw and converted marks."
 *
 * Both, always. §6: the raw mark is what the teacher wrote and the converted
 * mark is what the school's scale will say — the app exists precisely because
 * nobody sees the second one until semester end, so showing only one defeats
 * the point.
 */
export function ResultRows({ results }: { results: DigestResult[] }) {
  return (
    <table style={style.table}>
      <thead>
        <tr>
          <th style={style.th}>Assessment</th>
          <th style={{ ...style.th, textAlign: "right" }}>Mark</th>
          <th style={{ ...style.th, textAlign: "right" }}>Converted</th>
        </tr>
      </thead>
      <tbody>
        {results.map((r, i) => (
          <tr key={`${r.subject}-${r.occurredDate}-${i}`}>
            <td style={style.td}>
              <span style={{ color: color.ink, fontWeight: 600 }}>
                {r.paper ? `${r.subject} ${r.paper}` : r.subject}
              </span>
              <div style={{ fontSize: "12px", color: color.muted }}>
                {`${r.type} · ${shortDate(r.occurredDate)}${r.paperMissing ? " · logged manually (no paper attached)" : ""}`}
              </div>
            </td>
            {/* Built as one template literal, not adjacent expressions. React
                separates neighbouring expressions with an empty comment node,
                which splits `15/15` into three text nodes — invisible in a
                browser, but it defeats a plain-text render and gives Outlook's
                sanitiser something to trip over inside a mark. */}
            <td style={{ ...style.td, ...style.numeric, textAlign: "right", whiteSpace: "nowrap" }}>
              {`${formatRaw(r.rawObtained)}/${formatRaw(r.rawTotal)}`}
            </td>
            <td
              style={{
                ...style.td,
                ...style.numeric,
                textAlign: "right",
                whiteSpace: "nowrap",
                color: color.ink,
                fontWeight: 600,
              }}
            >
              {`${formatConverted(r.converted)}/${formatRaw(r.convertedScale)}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * §7.4 section 5 / §7.6: the Yes/No pair. Two real links, side by side, each
 * carrying its answer — one tap, no sign-in.
 */
export function ConfirmQuestion({
  subject,
  targetDate,
  yesUrl,
  noUrl,
}: {
  subject: string;
  targetDate: string;
  yesUrl: string;
  noUrl: string;
}) {
  return (
    <Section style={{ marginBottom: "16px" }}>
      <Text style={{ ...style.paragraph, marginBottom: "8px" }}>
        Did the <strong style={{ color: color.ink }}>{subject}</strong> CWM happen on{" "}
        {shortDate(targetDate)}?
      </Text>
      <Link href={yesUrl} style={{ ...style.buttonPrimary, marginRight: "8px" }}>
        Yes
      </Link>
      <Link href={noUrl} style={style.buttonSecondary}>
        No
      </Link>
    </Section>
  );
}

/** §7.4 section 7, Thursdays only. */
export function WeekInReviewCard({ review }: { review: WeekInReview }) {
  return (
    <Card title="Your week in review">
      {review.subjectAverages.length > 0 ? (
        <table style={{ ...style.table, marginBottom: "16px" }}>
          <thead>
            <tr>
              <th style={style.th}>Subject</th>
              <th style={{ ...style.th, textAlign: "right" }}>Average</th>
            </tr>
          </thead>
          <tbody>
            {review.subjectAverages.map((s) => (
              <tr key={s.subject}>
                <td style={style.td}>
                  {s.subject}
                  <span style={{ color: color.muted, fontSize: "12px" }}>
                    {" "}
                    · {s.count} {s.count === 1 ? "result" : "results"}
                  </span>
                </td>
                <td style={{ ...style.td, ...style.numeric, textAlign: "right", color: color.ink, fontWeight: 600 }}>
                  {s.percentage.toFixed(0)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {review.bestChapter ? (
        <Text style={style.paragraph}>
          Strongest: {review.bestChapter.chapter} ({review.bestChapter.percentage.toFixed(0)}%)
        </Text>
      ) : null}
      {review.weakestChapter ? (
        <Text style={style.paragraph}>
          Weakest: {review.weakestChapter.chapter} ({review.weakestChapter.percentage.toFixed(0)}%)
        </Text>
      ) : null}

      {review.coverage.length > 0 ? (
        <>
          <Hr style={{ borderColor: color.hairline, margin: "16px 0" }} />
          <Text style={{ ...style.caption, marginBottom: "6px" }}>Syllabus covered</Text>
          {review.coverage.map((c) => (
            <Text key={c.subject} style={{ ...style.paragraph, margin: "0 0 4px" }}>
              {c.subject}{" "}
              <span style={{ ...style.numeric, color: color.muted }}>
                {`${c.done}/${c.total} chapters`}
              </span>
            </Text>
          ))}
        </>
      ) : null}
    </Card>
  );
}
