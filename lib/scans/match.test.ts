import { describe, expect, it } from "vitest";
import {
  findCTAttachment,
  findCWMAttachment,
  findDuplicateResult,
  namesMatch,
  type CTCandidate,
  type CWMWindowCandidate,
  type ExistingResult,
} from "./match";

describe("namesMatch", () => {
  it("passes the spec's own example - a fuller parsed name against a shorter profile", () => {
    expect(namesMatch("Rakib Hasan Chowdhury", "Rakib Chowdhury")).toBe(true);
  });

  it("passes in the other direction too - a fuller profile against a shorter parse", () => {
    expect(namesMatch("Rakib Chowdhury", "Rakib Hasan Chowdhury")).toBe(true);
  });

  it("fails on a genuinely different name, not just a different length", () => {
    expect(namesMatch("Rakin Ahmed", "Rakib Chowdhury")).toBe(false);
  });

  it("is not fooled by whole-string edit distance on a short surname swap", () => {
    // "Rakib Chowdhury" vs "Rakib Karim" are edit-distance-close but share no
    // surname token - token-subset matching must still reject this.
    expect(namesMatch("Rakib Karim", "Rakib Chowdhury")).toBe(false);
  });
});

describe("findCTAttachment", () => {
  const candidates: CTCandidate[] = [
    { id: "ct1", scheduledDate: "2026-08-20" },
    { id: "ct2", scheduledDate: "2026-08-27" },
  ];

  it("auto-attaches only on an exact date match", () => {
    expect(findCTAttachment(candidates, "2026-08-20")).toEqual({ matchId: "ct1", options: [] });
  });

  it("never fuzzy-matches a postponed date - offers every open CT as an option instead", () => {
    expect(findCTAttachment(candidates, "2026-08-22")).toEqual({
      matchId: null,
      options: candidates,
    });
  });

  it("offers nothing when there is no open CT for the subject at all", () => {
    expect(findCTAttachment([], "2026-08-22")).toEqual({ matchId: null, options: [] });
  });
});

describe("findCWMAttachment", () => {
  const windows: CWMWindowCandidate[] = [
    { id: "w1", chapterIds: ["c1"], createdAt: "2026-08-01T00:00:00Z" },
    { id: "w2", chapterIds: ["c2"], createdAt: "2026-08-10T00:00:00Z" },
  ];

  it("prefers the window whose chapter matches the inferred chapter", () => {
    expect(findCWMAttachment(windows, "c2")).toEqual({ matchId: "w2", matchedBy: "chapter" });
  });

  it("falls back to the oldest open window when the chapter is unknown", () => {
    expect(findCWMAttachment(windows, null)).toEqual({ matchId: "w1", matchedBy: "oldest" });
  });

  it("falls back to the oldest window when the inferred chapter matches none of them", () => {
    expect(findCWMAttachment(windows, "c9")).toEqual({ matchId: "w1", matchedBy: "oldest" });
  });

  it("returns nothing when there is no open window - the caller files a new assessment", () => {
    expect(findCWMAttachment([], "c1")).toEqual({ matchId: null, matchedBy: null });
  });
});

describe("findDuplicateResult", () => {
  const existing: ExistingResult[] = [
    { id: "r1", studentSubjectId: "phy", occurredDate: "2026-08-18", rawObtained: 15, rawTotal: 15 },
  ];

  it("matches on subject + date + exact raw score", () => {
    expect(
      findDuplicateResult(existing, {
        studentSubjectId: "phy",
        occurredDate: "2026-08-18",
        rawObtained: 15,
        rawTotal: 15,
      }),
    ).toEqual(existing[0]);
  });

  it("falls through as a new result when the score differs - a rescan with a corrected mark", () => {
    expect(
      findDuplicateResult(existing, {
        studentSubjectId: "phy",
        occurredDate: "2026-08-18",
        rawObtained: 14,
        rawTotal: 15,
      }),
    ).toBeNull();
  });

  it("does not match a different subject on the same date and score", () => {
    expect(
      findDuplicateResult(existing, {
        studentSubjectId: "chem",
        occurredDate: "2026-08-18",
        rawObtained: 15,
        rawTotal: 15,
      }),
    ).toBeNull();
  });
});
