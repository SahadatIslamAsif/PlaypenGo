// §7.4's composition. The assertions that matter most are the ones about what
// is NOT capped: "Tomorrow and Day after are never truncated — during the week
// before exams there can legitimately be several CTs a day, and hiding them
// defeats the product." A cap that creeps onto section 1 is invisible until the
// one week the app most needs to be right.

import { describe, expect, it } from "vitest";
import {
  composeStudentDigest,
  composeTutorDigest,
  describeAssessment,
  formatConverted,
  formatRaw,
  isEmptyDigest,
  isEmptyTutorDigest,
  subjectLine,
  tutorSubjectLine,
  type DigestAssessment,
  type DigestInput,
  type DigestResult,
  type StudentDigest,
} from "./digest";

const TODAY = "2026-08-29";

function assessment(
  partial: Partial<DigestAssessment> & { subject: string; date: string },
): DigestAssessment {
  return {
    assessmentId: `${partial.subject}-${partial.date}`,
    paper: null,
    type: "CWM",
    predicted: true,
    chapter: null,
    ...partial,
  };
}

function result(partial: Partial<DigestResult> & { subject: string }): DigestResult {
  return {
    paper: null,
    type: "CWM",
    occurredDate: "2026-08-28",
    rawObtained: 8,
    rawTotal: 10,
    converted: 12,
    convertedScale: 15,
    percentage: 80,
    paperMissing: false,
    ...partial,
  };
}

function input(partial: Partial<DigestInput> = {}): DigestInput {
  return {
    today: TODAY,
    student: { id: "s1", name: "Rakib" },
    upcoming: [],
    logged: [],
    confirms: [],
    unlogged: [],
    weekInReview: null,
    ...partial,
  };
}

describe("composeStudentDigest — §7.4's sections", () => {
  it("splits tomorrow, the day after, and the rest of the week", () => {
    const digest = composeStudentDigest(
      input({
        upcoming: [
          assessment({ subject: "Physics", date: "2026-08-30" }),
          assessment({ subject: "Chemistry", date: "2026-08-31" }),
          assessment({ subject: "Maths", date: "2026-09-02" }),
        ],
      }),
    );

    expect(digest.tomorrow.map((a) => a.subject)).toEqual(["Physics"]);
    expect(digest.dayAfter.map((a) => a.subject)).toEqual(["Chemistry"]);
    expect(digest.restOfWeek.shown.map((a) => a.subject)).toEqual(["Maths"]);
  });

  it("never truncates tomorrow, however many land on it", () => {
    const digest = composeStudentDigest(
      input({
        upcoming: Array.from({ length: 8 }, (_, i) =>
          assessment({ subject: `Subject ${i}`, date: "2026-08-30", type: "CT", predicted: false }),
        ),
      }),
    );

    expect(digest.tomorrow).toHaveLength(8);
  });

  it("never truncates the day after either", () => {
    const digest = composeStudentDigest(
      input({
        upcoming: Array.from({ length: 7 }, (_, i) =>
          assessment({ subject: `Subject ${i}`, date: "2026-08-31" }),
        ),
      }),
    );

    expect(digest.dayAfter).toHaveLength(7);
  });

  it("caps the rest of the week at five and counts the remainder", () => {
    const digest = composeStudentDigest(
      input({
        upcoming: Array.from({ length: 8 }, (_, i) =>
          assessment({ subject: `Subject ${i}`, date: "2026-09-02" }),
        ),
      }),
    );

    expect(digest.restOfWeek.shown).toHaveLength(5);
    expect(digest.restOfWeek.more).toBe(3);
  });

  it("excludes anything past the seven-day horizon", () => {
    const digest = composeStudentDigest(
      input({ upcoming: [assessment({ subject: "Physics", date: "2026-09-20" })] }),
    );

    expect(digest.restOfWeek.shown).toEqual([]);
    expect(isEmptyDigest(digest)).toBe(true);
  });

  it("excludes today — the digest is about what is coming", () => {
    const digest = composeStudentDigest(
      input({ upcoming: [assessment({ subject: "Physics", date: TODAY })] }),
    );

    expect(isEmptyDigest(digest)).toBe(true);
  });

  it("puts a known CT ahead of a predicted CWM on the same day", () => {
    const digest = composeStudentDigest(
      input({
        upcoming: [
          assessment({ subject: "Chemistry", date: "2026-08-30" }),
          assessment({ subject: "Physics", date: "2026-08-30", type: "CT", predicted: false }),
        ],
      }),
    );

    expect(digest.tomorrow.map((a) => a.subject)).toEqual(["Physics", "Chemistry"]);
  });

  it("sorts unlogged papers by how long they have been waiting", () => {
    const digest = composeStudentDigest(
      input({
        unlogged: [
          { subject: "Physics", type: "CWM", occurredDate: "2026-08-26", daysWaiting: 3 },
          { subject: "Maths", type: "CT", occurredDate: "2026-08-22", daysWaiting: 7 },
        ],
      }),
    );

    expect(digest.unlogged.map((u) => u.subject)).toEqual(["Maths", "Physics"]);
  });
});

describe("the layout switch — §7.4", () => {
  it("stays in prose for two assessments in the next three days", () => {
    const digest = composeStudentDigest(
      input({
        upcoming: [
          assessment({ subject: "Physics", date: "2026-08-30" }),
          assessment({ subject: "Chemistry", date: "2026-08-31" }),
        ],
      }),
    );

    expect(digest.compact).toBe(false);
  });

  it("switches to the compact table at three", () => {
    const digest = composeStudentDigest(
      input({
        upcoming: [
          assessment({ subject: "Physics", date: "2026-08-30" }),
          assessment({ subject: "Chemistry", date: "2026-08-31" }),
          assessment({ subject: "Maths", date: "2026-09-01" }),
        ],
      }),
    );

    expect(digest.compact).toBe(true);
  });

  it("does not count assessments beyond the third day toward the switch", () => {
    const digest = composeStudentDigest(
      input({
        upcoming: [
          assessment({ subject: "Physics", date: "2026-08-30" }),
          assessment({ subject: "Chemistry", date: "2026-08-31" }),
          assessment({ subject: "Maths", date: "2026-09-03" }),
        ],
      }),
    );

    expect(digest.compact).toBe(false);
  });
});

describe("isEmptyDigest — §7.1's send/don't-send decision", () => {
  it("is empty when every section is", () => {
    expect(isEmptyDigest(composeStudentDigest(input()))).toBe(true);
  });

  it("is not empty for a result logged since yesterday", () => {
    const digest = composeStudentDigest(input({ logged: [result({ subject: "Physics" })] }));
    expect(isEmptyDigest(digest)).toBe(false);
  });

  it("is not empty for a pending Yes/No question", () => {
    const digest = composeStudentDigest(
      input({
        confirms: [
          { assessmentId: "a1", subject: "Physics", targetDate: "2026-08-28", token: "t".repeat(32) },
        ],
      }),
    );

    expect(isEmptyDigest(digest)).toBe(false);
  });

  it("is not empty on a Thursday carrying only the week in review", () => {
    const digest = composeStudentDigest(
      input({
        weekInReview: {
          subjectAverages: [{ subject: "Physics", percentage: 80, count: 2 }],
          bestChapter: null,
          weakestChapter: null,
          coverage: [],
        },
      }),
    );

    expect(isEmptyDigest(digest)).toBe(false);
  });
});

describe("subjectLine — §7.4's adaptive line", () => {
  it("writes the spec's own example", () => {
    const digest = composeStudentDigest(
      input({
        upcoming: [
          assessment({ subject: "Physics", date: "2026-08-30", type: "CT", predicted: false }),
          assessment({ subject: "Chemistry", date: "2026-08-30", type: "CWM" }),
        ],
      }),
    );

    expect(subjectLine(digest)).toBe("Tomorrow: Physics CT + Chemistry CWM likely");
  });

  it("names two and counts the rest", () => {
    const digest = composeStudentDigest(
      input({
        upcoming: [
          assessment({ subject: "Physics", date: "2026-08-30", type: "CT", predicted: false }),
          assessment({ subject: "Chemistry", date: "2026-08-30", type: "CT", predicted: false }),
          assessment({ subject: "Maths", date: "2026-08-30", type: "CT", predicted: false }),
          assessment({ subject: "Biology", date: "2026-08-30", type: "CT", predicted: false }),
        ],
      }),
    );

    // Same day, same type: alphabetical. Arbitrary, but stable night to night,
    // which is what stops the subject line churning while nothing has changed.
    expect(subjectLine(digest)).toBe("Tomorrow: Biology CT + Chemistry CT +2 more");
  });

  it("names the paper when a subject splits into two", () => {
    const digest = composeStudentDigest(
      input({
        upcoming: [
          assessment({ subject: "Maths", paper: "Add Math", date: "2026-08-30", type: "CT", predicted: false }),
        ],
      }),
    );

    expect(subjectLine(digest)).toBe("Tomorrow: Maths Add Math CT");
  });

  it("falls back to the day after when tomorrow is clear", () => {
    const digest = composeStudentDigest(
      input({ upcoming: [assessment({ subject: "Physics", date: "2026-08-31" })] }),
    );

    expect(subjectLine(digest)).toBe("Day after: Physics CWM likely");
  });

  it("asks the Yes/No question when that is why the mail is going out", () => {
    const digest = composeStudentDigest(
      input({
        confirms: [
          { assessmentId: "a1", subject: "Physics", targetDate: "2026-08-28", token: "t".repeat(32) },
        ],
      }),
    );

    expect(subjectLine(digest)).toBe("Did the Physics CWM happen?");
  });

  it("reports a single logged mark in the subject line", () => {
    const digest = composeStudentDigest(
      input({ logged: [result({ subject: "Physics", type: "CWM" })] }),
    );

    expect(subjectLine(digest)).toBe("Physics CWM: 8/10");
  });

  it("counts them when there is more than one", () => {
    const digest = composeStudentDigest(
      input({
        logged: [result({ subject: "Physics" }), result({ subject: "Chemistry" })],
      }),
    );

    expect(subjectLine(digest)).toBe("2 results logged");
  });

  it("names an unlogged paper rather than going generic", () => {
    const digest = composeStudentDigest(
      input({
        unlogged: [{ subject: "Physics", type: "CWM", occurredDate: "2026-08-26", daysWaiting: 3 }],
      }),
    );

    expect(subjectLine(digest)).toBe("Physics paper still unlogged");
  });
});

describe("mark formatting — §6", () => {
  it("writes a raw mark the way the teacher wrote it", () => {
    expect(formatRaw(8)).toBe("8");
    expect(formatRaw(15)).toBe("15");
  });

  it("writes every converted mark to one decimal place, the no-op case included", () => {
    // §6: "CWM 15/15 -> 15.0 / 15 (already on scale; the formula is a no-op, do
    // not special-case it)."
    expect(formatConverted(15)).toBe("15.0");
    expect(formatConverted(7.5)).toBe("7.5");
    expect(formatConverted(11.3)).toBe("11.3");
  });
});

describe("composeTutorDigest — §7.4, §8", () => {
  function studentDigest(name: string, over: Partial<DigestInput> = {}): StudentDigest {
    return composeStudentDigest(input({ student: { id: name, name }, ...over }));
  }

  it("sorts by unlogged count — §8's primary signal", () => {
    const digest = composeTutorDigest(TODAY, { id: "t1", name: "Asif" }, [
      {
        digest: studentDigest("Ayan", {
          unlogged: [{ subject: "Physics", type: "CWM", occurredDate: "2026-08-26", daysWaiting: 3 }],
        }),
        trend: "flat",
      },
      {
        digest: studentDigest("Rakib", {
          unlogged: [
            { subject: "Physics", type: "CWM", occurredDate: "2026-08-26", daysWaiting: 3 },
            { subject: "Maths", type: "CT", occurredDate: "2026-08-24", daysWaiting: 5 },
          ],
        }),
        trend: "down",
      },
    ]);

    expect(digest.rows.map((r) => r.studentName)).toEqual(["Rakib", "Ayan"]);
  });

  it("is empty when no student has anything outstanding or coming", () => {
    const digest = composeTutorDigest(TODAY, { id: "t1", name: "Asif" }, [
      { digest: studentDigest("Rakib"), trend: null },
    ]);

    expect(isEmptyTutorDigest(digest)).toBe(true);
  });

  it("leads with the unlogged count in its subject line", () => {
    const digest = composeTutorDigest(TODAY, { id: "t1", name: "Asif" }, [
      {
        digest: studentDigest("Rakib", {
          upcoming: [assessment({ subject: "Physics", date: "2026-08-30" })],
          unlogged: [{ subject: "Maths", type: "CT", occurredDate: "2026-08-24", daysWaiting: 5 }],
        }),
        trend: "down",
      },
    ]);

    expect(tutorSubjectLine(digest)).toBe("1 student with work tomorrow, 1 unlogged");
  });

  it("names the student when only one has work and nothing is outstanding", () => {
    const digest = composeTutorDigest(TODAY, { id: "t1", name: "Asif" }, [
      {
        digest: studentDigest("Rakib", {
          upcoming: [
            assessment({ subject: "Physics", date: "2026-08-30", type: "CT", predicted: false }),
          ],
        }),
        trend: null,
      },
    ]);

    expect(tutorSubjectLine(digest)).toBe("Rakib tomorrow: Physics CT");
  });
});

describe("describeAssessment", () => {
  it("marks a prediction as likely and a scheduled CT as fact", () => {
    expect(describeAssessment(assessment({ subject: "Chemistry", date: "2026-08-30" })))
      .toBe("Chemistry CWM likely");
    expect(
      describeAssessment(
        assessment({ subject: "Physics", date: "2026-08-30", type: "CT", predicted: false }),
      ),
    ).toBe("Physics CT");
  });
});
