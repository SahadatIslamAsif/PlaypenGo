// Render smoke tests for §7.4's three templates.
//
// These exist because of when the templates run: once a night, at 8pm, inside a
// cron function nobody is watching. A template that throws on an empty section
// or a null paper name fails there, silently, and the first sign of it is a
// student asking why the app stopped emailing. So every template is rendered
// against a full digest and a sparse one, and the assertions check the few
// things that are rules rather than styling:
//
//   * a predicted CWM is always worded as a prediction;
//   * both the raw and the converted mark appear (§6 — the converted one is the
//     whole reason the app exists);
//   * the guardian's copy carries no Yes/No control and no instruction to log
//     anything, because §3.3 makes them read-only;
//   * no emoji anywhere (the design system bans them outright).

import { describe, expect, it } from "vitest";
import { render } from "@react-email/render";
import {
  composeStudentDigest,
  composeTutorDigest,
  subjectLine,
  tutorSubjectLine,
  type DigestInput,
} from "@/lib/notifications/digest";
import { GuardianDigestEmail, StudentDigestEmail, TutorDigestEmail } from "./templates";

const BASE_URL = "https://playpengo.example";

const full: DigestInput = {
  today: "2026-08-29",
  student: { id: "s1", name: "Rakib Hasan Chowdhury" },
  upcoming: [
    {
      assessmentId: "a1",
      subject: "Physics",
      paper: null,
      type: "CT",
      date: "2026-08-30",
      predicted: false,
      chapter: "1.5.4: Circular Motion",
    },
    {
      assessmentId: "a2",
      subject: "Env. Management",
      paper: null,
      type: "CWM",
      date: "2026-08-31",
      predicted: true,
      chapter: null,
    },
    {
      assessmentId: "a3",
      subject: "Maths",
      paper: "Add Math",
      type: "CT",
      date: "2026-09-02",
      predicted: false,
      chapter: null,
    },
  ],
  logged: [
    {
      subject: "English Literature",
      paper: null,
      type: "CWM",
      occurredDate: "2026-08-28",
      rawObtained: 15,
      rawTotal: 15,
      converted: 15,
      convertedScale: 15,
      percentage: 100,
      paperMissing: false,
    },
  ],
  confirms: [
    {
      assessmentId: "a4",
      subject: "Chemistry",
      targetDate: "2026-08-27",
      token: "c".repeat(36),
    },
  ],
  unlogged: [
    { subject: "Biology", type: "CWM", occurredDate: "2026-08-25", daysWaiting: 4 },
  ],
  weekInReview: {
    subjectAverages: [{ subject: "Physics", percentage: 82.5, count: 3 }],
    bestChapter: { chapter: "1.2: Motion", percentage: 95 },
    weakestChapter: { chapter: "2.1: Waves", percentage: 61 },
    coverage: [{ subject: "Physics", done: 4, total: 9 }],
  },
};

const sparse: DigestInput = {
  today: "2026-08-29",
  student: { id: "s1", name: "Rakib" },
  upcoming: [
    {
      assessmentId: "a1",
      subject: "Physics",
      paper: null,
      type: "CWM",
      date: "2026-08-30",
      predicted: true,
      chapter: null,
    },
  ],
  logged: [],
  confirms: [],
  unlogged: [],
  weekInReview: null,
};

/** The design system: "No emoji anywhere... or email templates. Icons only." */
const EMOJI = /\p{Extended_Pictographic}/u;

describe("StudentDigestEmail", () => {
  it("renders a full digest", async () => {
    const digest = composeStudentDigest(full);
    const html = await render(
      <StudentDigestEmail digest={digest} subject={subjectLine(digest)} baseUrl={BASE_URL} />,
    );

    expect(html).toContain("Physics CT");
    // The prediction is always worded as one.
    expect(html).toContain("Env. Management CWM likely");
    expect(html).toContain("Maths Add Math CT");
    expect(html).toContain("Biology");
  });

  it("shows the raw mark and the converted mark together", async () => {
    const digest = composeStudentDigest(full);
    const html = await render(
      <StudentDigestEmail digest={digest} subject={subjectLine(digest)} baseUrl={BASE_URL} />,
    );

    // §6's no-op case, which must still read as a converted mark: 15/15 raw,
    // 15.0/15 converted.
    expect(html).toContain("15/15");
    expect(html).toContain("15.0/15");
  });

  it("links both answers of the Yes/No question at /c/<token>", async () => {
    const digest = composeStudentDigest(full);
    const html = await render(
      <StudentDigestEmail digest={digest} subject={subjectLine(digest)} baseUrl={BASE_URL} />,
    );

    expect(html).toContain(`${BASE_URL}/c/${"c".repeat(36)}?a=yes`);
    expect(html).toContain(`${BASE_URL}/c/${"c".repeat(36)}?a=no`);
  });

  it("renders a sparse digest without empty section headings", async () => {
    const digest = composeStudentDigest(sparse);
    const html = await render(
      <StudentDigestEmail digest={digest} subject={subjectLine(digest)} baseUrl={BASE_URL} />,
    );

    expect(html).toContain("Physics CWM likely");
    expect(html).not.toContain("Did this happen?");
    expect(html).not.toContain("Logged since yesterday");
    expect(html).not.toContain("Rest of the week");
  });

  it("switches to the compact table when the next three days are busy", async () => {
    const busy = composeStudentDigest({
      ...full,
      upcoming: [
        ...full.upcoming.slice(0, 2),
        { ...full.upcoming[2], date: "2026-09-01" },
      ],
    });

    expect(busy.compact).toBe(true);

    const html = await render(
      <StudentDigestEmail digest={busy} subject={subjectLine(busy)} baseUrl={BASE_URL} />,
    );

    expect(html).toContain("The next few days");
    expect(html).not.toContain(">Tomorrow<");
  });

  it("produces a plain-text alternative", async () => {
    const digest = composeStudentDigest(full);
    const text = await render(
      <StudentDigestEmail digest={digest} subject={subjectLine(digest)} baseUrl={BASE_URL} />,
      { plainText: true },
    );

    expect(text).toContain("Physics CT");
    expect(text.length).toBeGreaterThan(50);
  });

  it("contains no emoji", async () => {
    const digest = composeStudentDigest(full);
    const html = await render(
      <StudentDigestEmail digest={digest} subject={subjectLine(digest)} baseUrl={BASE_URL} />,
    );

    expect(html).not.toMatch(EMOJI);
  });
});

describe("GuardianDigestEmail", () => {
  it("shows the same assessments and marks as the student's", async () => {
    const digest = composeStudentDigest(full);
    const html = await render(
      <GuardianDigestEmail digest={digest} subject={subjectLine(digest)} />,
    );

    expect(html).toContain("Physics CT");
    expect(html).toContain("Env. Management CWM likely");
    // §1: "Full transparency — no filtering of bad marks."
    expect(html).toContain("15/15");
    expect(html).toContain("15.0/15");
  });

  it("offers no write affordance at all — §3.3 makes the guardian read-only", async () => {
    const digest = composeStudentDigest(full);
    const html = await render(
      <GuardianDigestEmail digest={digest} subject={subjectLine(digest)} />,
    );

    expect(html).not.toContain("/c/");
    expect(html).not.toContain("Did this happen?");
    expect(html).not.toContain("Scan the paper");
  });

  it("still reports an unlogged paper, as news rather than as a task", async () => {
    const digest = composeStudentDigest(full);
    const html = await render(
      <GuardianDigestEmail digest={digest} subject={subjectLine(digest)} />,
    );

    expect(html).toContain("Biology");
    expect(html).toContain("not recorded yet");
  });

  it("contains no emoji", async () => {
    const digest = composeStudentDigest(full);
    const html = await render(
      <GuardianDigestEmail digest={digest} subject={subjectLine(digest)} />,
    );

    expect(html).not.toMatch(EMOJI);
  });
});

describe("TutorDigestEmail", () => {
  it("renders one row per student, worst first", async () => {
    const digest = composeTutorDigest(
      "2026-08-29",
      { id: "t1", name: "Asif" },
      [
        { digest: composeStudentDigest(sparse), trend: "up" },
        {
          digest: composeStudentDigest({
            ...full,
            student: { id: "s2", name: "Ayan Rahman" },
          }),
          trend: "down",
        },
      ],
    );

    const html = await render(
      <TutorDigestEmail digest={digest} subject={tutorSubjectLine(digest)} />,
    );

    expect(html).toContain("Ayan Rahman");
    expect(html).toContain("Rakib");
    expect(html.indexOf("Ayan Rahman")).toBeLessThan(html.indexOf(">Rakib"));
    // Words, not arrows or emoji.
    expect(html).toContain("Down");
  });

  it("contains no emoji", async () => {
    const digest = composeTutorDigest("2026-08-29", { id: "t1", name: "Asif" }, [
      { digest: composeStudentDigest(full), trend: "flat" },
    ]);

    const html = await render(
      <TutorDigestEmail digest={digest} subject={tutorSubjectLine(digest)} />,
    );

    expect(html).not.toMatch(EMOJI);
  });
});
