// The tutor's "trend against the student's own average" (§8) - never against
// another student, §0's non-goals rule out cross-student comparison outright.
// Pulled out of lib/notifications/engine.tsx's trendFor() so the tutor
// roster (Phase 7) can compute the same arrow without a second definition of
// what "trending up" means, and so the math has a unit test independent of
// a Supabase round trip.

export type Trend = "up" | "down" | "flat" | null;

/** Five percentage points either way - below that a "trend" is a hard paper. */
const DELTA_THRESHOLD = 5;

/** Below this much history a trend is noise presented as a finding. */
const MIN_HISTORY = 5;

const RECENT_COUNT = 3;

/**
 * `percentages` is newest-first (the order `.order("logged_at", { ascending:
 * false })` returns). Compares the mean of the most recent three results
 * against the mean of everything before them; null until there are at least
 * five results to compare.
 */
export function computeTrend(percentages: number[]): Trend {
  if (percentages.length < MIN_HISTORY) return null;

  const recent = percentages.slice(0, RECENT_COUNT);
  const rest = percentages.slice(RECENT_COUNT);

  const mean = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const delta = mean(recent) - mean(rest);

  if (delta > DELTA_THRESHOLD) return "up";
  if (delta < -DELTA_THRESHOLD) return "down";
  return "flat";
}
