import { describe, expect, it } from "vitest";
import { buildWeekInReview, type WeekChapterRow, type WeekResultRow } from "./week-review";

const names = new Map([
  ["phy", "Physics"],
  ["chem", "Chemistry"],
]);

describe("buildWeekInReview", () => {
  it("is null with no results and no chapters", () => {
    expect(buildWeekInReview([], [], names)).toBeNull();
  });

  it("averages percentage per subject, best-first", () => {
    const results: WeekResultRow[] = [
      { percentage: 90, studentSubjectId: "phy", chapterNames: [] },
      { percentage: 50, studentSubjectId: "chem", chapterNames: [] },
    ];
    const review = buildWeekInReview(results, [], names);
    expect(review?.subjectAverages).toEqual([
      { subject: "Physics", percentage: 90, count: 1 },
      { subject: "Chemistry", percentage: 50, count: 1 },
    ]);
  });

  it("picks best and weakest chapter only when there's a spread", () => {
    const results: WeekResultRow[] = [
      { percentage: 90, studentSubjectId: "phy", chapterNames: ["Friction"] },
      { percentage: 40, studentSubjectId: "phy", chapterNames: ["Momentum"] },
    ];
    const review = buildWeekInReview(results, [], names);
    expect(review?.bestChapter).toEqual({ chapter: "Friction", percentage: 90 });
    expect(review?.weakestChapter).toEqual({ chapter: "Momentum", percentage: 40 });
  });

  it("reports neither best nor weakest with only one chapter - nothing to compare", () => {
    const results: WeekResultRow[] = [
      { percentage: 90, studentSubjectId: "phy", chapterNames: ["Friction"] },
    ];
    const review = buildWeekInReview(results, [], names);
    expect(review?.bestChapter).toBeNull();
    expect(review?.weakestChapter).toBeNull();
  });

  it("a combined-mark result counts toward every chapter it's linked to", () => {
    const results: WeekResultRow[] = [
      { percentage: 80, studentSubjectId: "phy", chapterNames: ["Friction", "Momentum"] },
    ];
    const review = buildWeekInReview(results, [], names);
    // Two chapters, both at 80 - a tie, so ranked[0] (best) and
    // ranked[last] (weakest) are different entries of the same value.
    expect(review?.bestChapter?.percentage).toBe(80);
    expect(review?.weakestChapter?.percentage).toBe(80);
  });

  it("computes coverage as done/total, excluding not_taught from both sides", () => {
    const chapters: WeekChapterRow[] = [
      { studentSubjectId: "phy", status: "p100" },
      { studentSubjectId: "phy", status: "p80" },
      { studentSubjectId: "phy", status: "not_started" },
      { studentSubjectId: "phy", status: "not_taught" },
    ];
    const review = buildWeekInReview([], chapters, names);
    expect(review?.coverage).toEqual([{ subject: "Physics", done: 2, total: 3 }]);
  });

  it("is null when every chapter is not_taught and nothing else survives either side", () => {
    const chapters: WeekChapterRow[] = [{ studentSubjectId: "phy", status: "not_taught" }];
    expect(buildWeekInReview([], chapters, names)).toBeNull();
  });

  it("omits a subject from coverage once every one of ITS chapters is not_taught, while keeping others", () => {
    const chapters: WeekChapterRow[] = [
      { studentSubjectId: "phy", status: "not_taught" },
      { studentSubjectId: "chem", status: "p80" },
    ];
    const review = buildWeekInReview([], chapters, names);
    expect(review?.coverage).toEqual([{ subject: "Chemistry", done: 1, total: 1 }]);
  });
});
