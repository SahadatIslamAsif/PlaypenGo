import { describe, expect, it } from "vitest";
import { computeTrend } from "./trend";

describe("computeTrend", () => {
  it("is null with fewer than five results - a trend from two marks is noise", () => {
    expect(computeTrend([90, 80, 70, 60])).toBeNull();
  });

  it("is 'up' when the last three average more than 5 points above the rest", () => {
    expect(computeTrend([90, 88, 92, 70, 68, 72])).toBe("up");
  });

  it("is 'down' when the last three average more than 5 points below the rest", () => {
    expect(computeTrend([60, 58, 62, 85, 82, 88])).toBe("down");
  });

  it("is 'flat' inside the 5-point band either way", () => {
    expect(computeTrend([80, 78, 82, 79, 81, 80])).toBe("flat");
  });

  it("reads the array as newest-first, matching the logged_at desc query", () => {
    // Recent three (index 0-2) are worse than the rest - "down", regardless
    // of where in real time they actually happened.
    expect(computeTrend([60, 58, 62, 90, 88, 92])).toBe("down");
  });
});
