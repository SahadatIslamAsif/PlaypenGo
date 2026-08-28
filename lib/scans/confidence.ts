// §5.3's confidence rule, made concrete: "the model's self-reported
// confidence is uncalibrated ... use it only to decide highlighting, never
// to decide a value. Where two independent signals exist, derive
// confidence from their agreement instead ... Agreement raises confidence,
// disagreement lowers it and forces the field into the highlighted state."
//
// Agreement is the strong signal and wins outright: when a second,
// independent read of the same fact exists (header total vs ellipse
// denominator; parsed subject vs the routine's subject for that weekday;
// visual type vs scheduled CT), whether the two agree decides highlighting
// on its own - the model's own score never overrides that, in either
// direction. Only when no second signal exists at all does the raw score
// get consulted, and even then only against a threshold, never surfaced as
// a number anyone should read as a percentage they can trust.

export type Agreement = "agree" | "disagree" | "unknown";

export type ConfidenceResult = {
  highlighted: boolean;
};

/** Below this, an uncalibrated score is treated as "not confident" when
 * it's the only signal available - not a number anyone should read as a
 * probability, just where this app draws its own line. Also what "never
 * auto-select a chapter below the confidence threshold" (§5.3) checks
 * against: a chapter suggestion is pre-ticked exactly when it clears this,
 * i.e. exactly when it would NOT be highlighted. */
export const LOW_CONFIDENCE_THRESHOLD = 0.75;

export function deriveConfidence(modelScore: number, agreement: Agreement): ConfidenceResult {
  if (agreement !== "unknown") {
    return { highlighted: agreement === "disagree" };
  }
  return { highlighted: modelScore < LOW_CONFIDENCE_THRESHOLD };
}
