// The one thing shared across all three Gemini pipelines (routines, scans,
// syllabus), unlike everything else in them - toSdkSchema, isRetryableUnavailable
// and isQuotaExceeded are each deliberately duplicated per pipeline so the three
// stay uncoupled from each other's parsing logic. This is different: the whole
// point of 0032's counter is that it's ONE number shared by all three, so
// duplicating the increment logic three times would risk the three pipelines
// quietly disagreeing about how to count toward it - the one thing that can't
// happen to a shared total.
//
// Kept here rather than inside a client.ts: parseRoutine/parsePaper/parseSyllabus
// have no Supabase dependency today (scripts/parse-paper.ts and friends call them
// straight from a CLI, outside any request/cookie context `lib/supabase/server`
// needs), and this file must not become the thing that breaks that. The route
// handlers already hold a request-scoped client; they pass it in.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Where the scan screen's threshold warning starts showing (~20 requests/day
 * on gemini-3.6-flash's free tier, shared across all three pipelines - see
 * the design report this constant follows). Chosen to leave enough headroom
 * after it fires to still finish a normal scanning session, rather than
 * warning so close to the wall it's already too late to act on.
 */
export const DAILY_WARNING_THRESHOLD = 15;

/**
 * Records one real call to Gemini against 0032's shared daily counter.
 * Call this at send - immediately before each outbound request, including a
 * 503's retry - never after a response comes back. Counting on response
 * would undercount the one case that matters most: Google receives and
 * counts the request, then this app's own process dies or times out before
 * it reads the reply, and the local number ends up lower than the truth
 * instead of higher. Counting at send can only ever drift the safe way - a
 * request that fails before reaching Google at all makes the local count
 * too high, never too low.
 *
 * Best-effort: a failure here is logged and swallowed, never thrown. This is
 * a usage signal for a threshold warning, not a gate - it must never be the
 * reason a scan, routine parse, or syllabus import fails.
 */
export async function recordGeminiCall(supabase: SupabaseClient<Database>): Promise<void> {
  const { error } = await supabase.rpc("record_gemini_call");
  if (error) {
    console.error("record_gemini_call failed:", error.message);
  }
}

/**
 * Today's count against the shared daily quota (today meaning the Pacific
 * calendar date 0032's functions key against, the same boundary Google's
 * own quota resets on - not the caller's local date). Read for the scan
 * screen's threshold warning.
 *
 * Best-effort like recordGeminiCall: a read failure returns 0 rather than
 * throwing, so it can never be the reason the scan screen fails to render -
 * worst case for that day is simply no warning shown.
 */
export async function getGeminiUsageToday(supabase: SupabaseClient<Database>): Promise<number> {
  const { data, error } = await supabase.rpc("get_gemini_usage_today");
  if (error) {
    console.error("get_gemini_usage_today failed:", error.message);
    return 0;
  }
  return data ?? 0;
}
