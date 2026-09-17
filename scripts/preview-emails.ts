// Renders §7.4's three digest templates against invented sample data and
// writes them to .email-preview/*.html, then opens them in the default
// browser. There is no SMTP round trip here - `npm run email:preview` is
// the fast loop for checking a copy change (wording, layout, a new field)
// without waiting for the nightly cron or standing up react-email's own
// dev server, which this repo's lib/email/ layout doesn't match anyway.
//
// Every name and mark below is invented, same rule ARCHITECTURE.md holds
// its own worked examples to - never real student data.

import { mkdir, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { render } from "@react-email/render";
import {
  composeStudentDigest,
  composeTutorDigest,
  subjectLine,
  tutorSubjectLine,
  type DigestInput,
} from "../lib/notifications/digest";
import { GuardianDigestEmail, StudentDigestEmail, TutorDigestEmail } from "../lib/email/templates";

const BASE_URL = "https://playpengo.example";
const OUT_DIR = path.join(process.cwd(), ".email-preview");

const sample: DigestInput = {
  today: "2026-08-29",
  student: { id: "s1", name: "Priyanka Das" },
  upcoming: [
    {
      assessmentId: "a1",
      subject: "Mathematics",
      paper: "Math D",
      type: "CT",
      date: "2026-08-30",
      predicted: false,
      chapter: "Number Systems",
      name: "Test 2",
    },
    {
      assessmentId: "a2",
      subject: "Environmental Management",
      paper: null,
      type: "CWM",
      date: "2026-08-31",
      predicted: true,
      chapter: "Rock Cycle",
      name: null,
    },
    {
      assessmentId: "a3",
      subject: "Business Studies",
      paper: null,
      type: "CT",
      date: "2026-09-02",
      predicted: false,
      chapter: null,
      name: null,
    },
  ],
  logged: [
    {
      subject: "English",
      paper: null,
      type: "CWM",
      occurredDate: "2026-08-28",
      rawObtained: 12,
      rawTotal: 15,
      converted: 12,
      convertedScale: 15,
      percentage: 80,
      paperMissing: false,
    },
    {
      subject: "Mathematics",
      paper: "Add Math",
      type: "CT",
      occurredDate: "2026-08-27",
      rawObtained: 18,
      rawTotal: 40,
      converted: 11.3,
      convertedScale: 25,
      percentage: 45,
      paperMissing: true,
    },
  ],
  confirms: [
    {
      assessmentId: "a4",
      subject: "Chemistry",
      targetDate: "2026-08-27",
      token: "preview-token-not-real-do-not-use",
    },
  ],
  unlogged: [
    { subject: "Biology", type: "CWM", occurredDate: "2026-08-25", daysWaiting: 4, name: null },
  ],
  weekInReview: {
    subjectAverages: [
      { subject: "Mathematics", percentage: 78, count: 4 },
      { subject: "English", percentage: 91, count: 2 },
    ],
    bestChapter: { chapter: "Photosynthesis", percentage: 95 },
    weakestChapter: { chapter: "Simultaneous Equations", percentage: 58 },
    coverage: [
      { subject: "Mathematics", done: 6, total: 12 },
      { subject: "Environmental Management", done: 4, total: 9 },
    ],
  },
};

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const studentDigest = composeStudentDigest(sample);
  const guardianDigest = studentDigest; // §1: guardian sees the same data, not filtered.
  const tutorDigest = composeTutorDigest(
    sample.today,
    { id: "t1", name: "Imran Hossain" },
    [
      { digest: studentDigest, trend: "down" },
      {
        digest: composeStudentDigest({
          ...sample,
          student: { id: "s2", name: "Rakib Hasan" },
          unlogged: [],
        }),
        trend: "up",
      },
    ],
  );

  const files: { name: string; html: string }[] = [
    {
      name: "student.html",
      html: await render(
        StudentDigestEmail({ digest: studentDigest, subject: subjectLine(studentDigest), baseUrl: BASE_URL }),
      ),
    },
    {
      name: "guardian.html",
      html: await render(
        GuardianDigestEmail({ digest: guardianDigest, subject: subjectLine(guardianDigest) }),
      ),
    },
    {
      name: "tutor.html",
      html: await render(
        TutorDigestEmail({ digest: tutorDigest, subject: tutorSubjectLine(tutorDigest) }),
      ),
    },
  ];

  for (const file of files) {
    await writeFile(path.join(OUT_DIR, file.name), file.html, "utf8");
  }

  console.log(`Wrote ${files.length} preview files to ${OUT_DIR}`);

  const openWith = platform() === "win32" ? "start" : platform() === "darwin" ? "open" : "xdg-open";
  for (const file of files) {
    const target = path.join(OUT_DIR, file.name);
    // `start` is a cmd.exe builtin, not a real executable - it has to run
    // through the shell, and the empty "" first argument is start's own
    // window-title placeholder, required whenever the path itself might
    // need quoting.
    if (platform() === "win32") {
      spawn("cmd", ["/c", "start", "", target], { shell: false, detached: true, stdio: "ignore" }).unref();
    } else {
      spawn(openWith, [target], { detached: true, stdio: "ignore" }).unref();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
