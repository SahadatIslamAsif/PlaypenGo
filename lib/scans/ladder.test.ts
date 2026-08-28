// §5.3's ellipse ladder, tested against the spec's own worked examples so a
// failure here is a rule that is wrong, not a model that misread.

import { describe, expect, it } from "vitest";
import {
  laterPageCandidates,
  page1Ellipses,
  resolveMarks,
  type HeaderMarks,
  type MarkCandidate,
} from "./ladder";

const noHeader: HeaderMarks = {
  totalMarksField: null,
  obtainedMarksField: null,
  obtainedFieldStruckThrough: false,
};

describe("resolveMarks", () => {
  it("takes the page-1 ellipse and never looks further, even if the header disagrees", () => {
    const candidates: MarkCandidate[] = [
      { page: 1, valueObtained: 15, valueTotal: 15, style: "ellipse", location: "mid-page right" },
    ];
    const header: HeaderMarks = {
      totalMarksField: 20,
      obtainedMarksField: 12,
      obtainedFieldStruckThrough: false,
    };
    expect(resolveMarks(candidates, header)).toEqual({
      obtained: 15,
      total: 15,
      source: "ellipse",
    });
  });

  it("never sums or weighs a page-2 ellipse — the Env. Management sample's un-denominated 6", () => {
    const candidates: MarkCandidate[] = [
      { page: 2, valueObtained: 6, valueTotal: null, style: "ellipse", location: "bottom" },
    ];
    expect(resolveMarks(candidates, noHeader)).toEqual({
      obtained: null,
      total: null,
      source: "none",
    });
  });

  it("falls back to the header pair when no page-1 ellipse exists", () => {
    const header: HeaderMarks = {
      totalMarksField: 10,
      obtainedMarksField: 7,
      obtainedFieldStruckThrough: false,
    };
    expect(resolveMarks([], header)).toEqual({ obtained: 7, total: 10, source: "header" });
  });

  it("treats a struck-through obtained blank as empty, not as a value", () => {
    const header: HeaderMarks = {
      totalMarksField: 15,
      obtainedMarksField: 9,
      obtainedFieldStruckThrough: true,
    };
    expect(resolveMarks([], header)).toEqual({ obtained: null, total: null, source: "none" });
  });

  it("leaves both fields empty when nothing is found - never guesses", () => {
    expect(resolveMarks([], noHeader)).toEqual({ obtained: null, total: null, source: "none" });
  });

  it("treats an unreadable total as blank - the '15 reads as L5' case", () => {
    const header: HeaderMarks = {
      totalMarksField: Number.NaN,
      obtainedMarksField: 9,
      obtainedFieldStruckThrough: false,
    };
    expect(resolveMarks([], header)).toEqual({ obtained: null, total: null, source: "none" });
  });

  it("rejects a negative or non-integer mark the same way", () => {
    const header: HeaderMarks = {
      totalMarksField: 10,
      obtainedMarksField: -3,
      obtainedFieldStruckThrough: false,
    };
    expect(resolveMarks([], header)).toEqual({ obtained: null, total: null, source: "none" });
  });

  it("takes the first of multiple page-1 ellipses, per rule 4", () => {
    const candidates: MarkCandidate[] = [
      { page: 1, valueObtained: 8, valueTotal: 10, style: "ellipse", location: "top" },
      { page: 1, valueObtained: 20, valueTotal: 10, style: "ellipse", location: "margin" },
    ];
    expect(resolveMarks(candidates, noHeader)).toEqual({
      obtained: 8,
      total: 10,
      source: "ellipse",
    });
  });

  it("ignores a page-1 candidate that isn't ellipse-styled - a tick or question number", () => {
    const candidates: MarkCandidate[] = [
      { page: 1, valueObtained: 3, valueTotal: null, style: "tick", location: "margin" },
    ];
    const header: HeaderMarks = {
      totalMarksField: 10,
      obtainedMarksField: 7,
      obtainedFieldStruckThrough: false,
    };
    expect(resolveMarks(candidates, header)).toEqual({ obtained: 7, total: 10, source: "header" });
  });
});

describe("page1Ellipses / laterPageCandidates", () => {
  it("splits candidates by page for the review screen's display, not the ladder", () => {
    const candidates: MarkCandidate[] = [
      { page: 1, valueObtained: 15, valueTotal: 15, style: "ellipse", location: "right" },
      { page: 2, valueObtained: 6, valueTotal: null, style: "ellipse", location: "bottom" },
    ];
    expect(page1Ellipses(candidates)).toHaveLength(1);
    expect(laterPageCandidates(candidates)).toHaveLength(1);
    expect(laterPageCandidates(candidates)[0].page).toBe(2);
  });
});
