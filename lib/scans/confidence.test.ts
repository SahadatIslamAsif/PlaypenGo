import { describe, expect, it } from "vitest";
import { deriveConfidence, LOW_CONFIDENCE_THRESHOLD } from "./confidence";

describe("deriveConfidence", () => {
  it("agreement highlights nothing, even with a low raw score", () => {
    expect(deriveConfidence(0.1, "agree")).toEqual({ highlighted: false });
  });

  it("disagreement highlights, even with a high raw score", () => {
    expect(deriveConfidence(0.99, "disagree")).toEqual({ highlighted: true });
  });

  it("falls back to the raw score only when no second signal exists", () => {
    expect(deriveConfidence(0.9, "unknown")).toEqual({ highlighted: false });
    expect(deriveConfidence(0.5, "unknown")).toEqual({ highlighted: true });
  });

  it("treats the threshold itself as confident, not below it", () => {
    expect(deriveConfidence(LOW_CONFIDENCE_THRESHOLD, "unknown")).toEqual({ highlighted: false });
    expect(deriveConfidence(LOW_CONFIDENCE_THRESHOLD - 0.01, "unknown")).toEqual({
      highlighted: true,
    });
  });
});
