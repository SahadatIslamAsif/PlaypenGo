// §6's three worked examples, asserted here on the exact same terms as
// supabase/tests/0014_assessments.test.sql asserts them through the generated
// columns. Two independent implementations of the same arithmetic, so a
// regression in either one shows up as a mismatch rather than a shared bug.

import { describe, expect, it } from "vitest";
import { convert, CONVERSION_SCALE, formatConverted, formatRaw, percentage, previewMarks } from "./marks";

describe("percentage", () => {
  it("computes raw_obtained / raw_total * 100", () => {
    expect(percentage(5, 10)).toBe(50.0);
    expect(percentage(18, 40)).toBe(45.0);
  });

  it("returns null rather than NaN for a zero or blank total", () => {
    expect(percentage(5, 0)).toBeNull();
    expect(percentage(5, NaN)).toBeNull();
  });
});

describe("convert — §6's worked examples", () => {
  it("CWM 5/10 -> 7.5/15", () => {
    expect(convert(5, 10, CONVERSION_SCALE.CWM)).toBe(7.5);
  });

  it("CWM 15/15 -> 15.0/15 - the formula is a no-op, not a special case", () => {
    expect(convert(15, 15, CONVERSION_SCALE.CWM)).toBe(15.0);
  });

  it("CT 18/40 -> 11.3/25", () => {
    expect(convert(18, 40, CONVERSION_SCALE.CT)).toBe(11.3);
  });

  it("rounds to one decimal place, as the school does", () => {
    // 1/3 * 15 = 5.0 repeating; the school's one-decimal convention rounds it.
    expect(convert(1, 3, CONVERSION_SCALE.CWM)).toBe(5.0);
    expect(convert(2, 3, CONVERSION_SCALE.CT)).toBe(16.7);
  });

  it("records a bonus mark above the scale rather than clamping it", () => {
    // §6 deliberately does not constrain obtained <= total.
    expect(convert(16, 15, CONVERSION_SCALE.CWM)).toBe(16.0);
  });

  it("returns null for a zero total", () => {
    expect(convert(5, 0, CONVERSION_SCALE.CT)).toBeNull();
  });
});

describe("previewMarks", () => {
  it("bundles percentage and converted under the right scale for CWM", () => {
    expect(previewMarks(5, 10, "CWM")).toEqual({
      percentage: 50.0,
      converted: 7.5,
      scale: 15,
    });
  });

  it("bundles them under the right scale for CT", () => {
    expect(previewMarks(18, 40, "CT")).toEqual({
      percentage: 45.0,
      converted: 11.3,
      scale: 25,
    });
  });
});

describe("formatting", () => {
  it("formats the converted figure with a fixed one decimal place", () => {
    expect(formatConverted(15, 15)).toBe("15.0 / 15");
    expect(formatConverted(7.5, 15)).toBe("7.5 / 15");
    expect(formatConverted(null, 15)).toBe("—");
  });

  it("formats the raw mark exactly as entered, no rounding", () => {
    expect(formatRaw(12, 15)).toBe("12 / 15");
    expect(formatRaw(18, 40)).toBe("18 / 40");
  });
});
