// §5.3's centre-line ambiguity test, against both real samples the spec names.

import { describe, expect, it } from "vitest";
import { matchCentreLine, type ChapterCandidate } from "./centre-line";

describe("matchCentreLine", () => {
  it("matches the English Literature sample - exact matching fails, token overlap doesn't", () => {
    const chapters: ChapterCandidate[] = [
      { id: "ch1", name: "A Zoo in My Luggage: A Novel in Advance (with Chap 1)" },
      { id: "ch2", name: "Poetry: Selected Verse" },
    ];
    const result = matchCentreLine("Zoo in my Luggage", chapters);
    expect(result).toEqual({ kind: "chapter", chapterId: "ch1", score: expect.any(Number) });
  });

  it("matches the Env. Management sample as a type marker, not a chapter", () => {
    const chapters: ChapterCandidate[] = [{ id: "ch1", name: "Chapter 2 Natural Resources" }];
    expect(matchCentreLine("C.W.M", chapters)).toEqual({ kind: "type", type: "CWM" });
  });

  it("recognises C.T the same way", () => {
    expect(matchCentreLine("C.T", [])).toEqual({ kind: "type", type: "CT" });
  });

  it("keeps unrelated text as free-text topic_line rather than forcing a decision", () => {
    const chapters: ChapterCandidate[] = [{ id: "ch1", name: "Photosynthesis" }];
    const result = matchCentreLine("Revision Test 3", chapters);
    expect(result).toEqual({ kind: "topic", text: "Revision Test 3" });
  });

  it("prefers a chapter match over a coincidental type-marker collision", () => {
    // A chapter literally named "CT scan basics" should still win over the
    // type-marker branch, since chapter matching is tried first.
    const chapters: ChapterCandidate[] = [{ id: "ch1", name: "CT scan basics" }];
    const result = matchCentreLine("CT scan basics", chapters);
    expect(result.kind).toBe("chapter");
  });

  it("returns topic for empty text without matching anything", () => {
    expect(matchCentreLine("   ", [{ id: "ch1", name: "Anything" }])).toEqual({
      kind: "topic",
      text: "",
    });
  });
});
