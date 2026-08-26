// §6's conversion, as a second implementation of the generated columns from
// migration 0013. The SQL columns are the guarantee — nothing can be stored
// with the wrong number — but they only exist once a row is saved, and the
// entry form needs to show `7.5 / 15 · 50%` while the tutor is still typing.
// This module is what drives that live preview.
//
// Both implementations are tested against the same three worked examples from
// §6, so they cannot silently drift apart. If this file and the SQL columns
// ever disagree, one of the two test suites will say so.

export type AssessmentType = "CT" | "CWM";

// §6: "CWM: converted = round(raw_obtained / raw_total * 15, 1)" and
// "CT: ... * 25". §10 item 4 flags 25 as unconfirmed but treats it as settled
// for v1 — see 0013_assessments.sql's converted_scale column for the note on
// why the scale is stored per-result rather than hard-coded at read time.
export const CONVERSION_SCALE: Record<AssessmentType, number> = {
  CWM: 15,
  CT: 25,
};

/** One decimal place, matching "as the school does" (§6). */
function roundTo1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * percentage = raw_obtained / raw_total * 100
 *
 * Returns null rather than NaN/Infinity for a blank or zero total — the
 * live-preview caller checks for null and shows nothing instead of "NaN%"
 * while the total field is still empty.
 */
export function percentage(obtained: number, total: number): number | null {
  if (!Number.isFinite(obtained) || !Number.isFinite(total) || total <= 0) {
    return null;
  }
  return roundTo1((obtained / total) * 100);
}

/**
 * converted = round(raw_obtained / raw_total * scale, 1)
 *
 * §6: "CWM 15/15 -> 15.0/15 (already on scale; the formula is a no-op, do not
 * special-case it)" — and this function doesn't: 15/15 * 15 runs through the
 * same arithmetic as every other input, landing on 15.0 by falling out of the
 * formula rather than an early return.
 */
export function convert(obtained: number, total: number, scale: number): number | null {
  if (
    !Number.isFinite(obtained) ||
    !Number.isFinite(total) ||
    total <= 0 ||
    !Number.isFinite(scale)
  ) {
    return null;
  }
  return roundTo1((obtained / total) * scale);
}

export type MarkPreview = {
  percentage: number | null;
  converted: number | null;
  scale: number;
};

/** The whole live preview in one call, keyed off the assessment type. */
export function previewMarks(
  obtained: number,
  total: number,
  type: AssessmentType,
): MarkPreview {
  const scale = CONVERSION_SCALE[type];
  return {
    percentage: percentage(obtained, total),
    converted: convert(obtained, total, scale),
    scale,
  };
}

/** `7.5 / 15`, `15.0 / 15` — one decimal place on the numerator, always. */
export function formatConverted(converted: number | null, scale: number): string {
  if (converted === null) return "—";
  return `${converted.toFixed(1)} / ${scale}`;
}

/** `12 / 15` — the raw mark, exactly as the teacher wrote it, no rounding. */
export function formatRaw(obtained: number, total: number): string {
  return `${obtained} / ${total}`;
}
