// The alert window, as arithmetic (ARCHITECTURE.md §7.3, §7.5, §7.6).
//
// §7.3 replaced an earlier single-guess model outright: a CWM used to get one
// predicted date and two alerts, and a chapter that stayed unmarked past that
// day had nothing left to fall back on. Now every open assessment gets a
// *window of class occurrences to watch* — one for a CT (its scheduled date),
// four for a CWM (the next four times that subject meets, read off the
// routine) — and the same two-evening pattern fires ahead of each occurrence
// the window still has open.
//
// Everything here is pure. The engine's only real decisions live in this file
// so they can be tested without a database, a clock, or an SMTP server; the
// cron route supplies rows and a date and writes back whatever comes out.
//
// ---------------------------------------------------------------------------
// The one thing worth reading twice
//
// §3.2: `alerts` rows appear as occurrences are *reached*, never up front. So
// the row set is not a log of how far the window has got, and must never be
// counted as one:
//
//   * `window_exhausted` is re-derived from the routine (`occurrences` below),
//     because "a skipped occurrence — its evening claimed by a sibling — may
//     never have gotten a row of its own, and undercounting would leave the
//     window open past its four occurrences".
//   * `two_no_in_a_row` is computed over *answered* occurrences only. An
//     occurrence whose confirm token expired unused "is skipped entirely,
//     neither breaking nor extending anything".
//
// Both are stated that way in §7.3, and both are the kind of thing that reads
// as an implementation detail right up until it silently nags a student for a
// fortnight.

import { addDays, DEFAULT_TIMEZONE, localDate } from "@/lib/routines/schedule";

/** §7.3: "the next 4 class occurrences of that subject". */
export const CWM_WINDOW_OCCURRENCES = 4;

/** §3.2's four alert kinds. */
export type AlertKind = "advance" | "night_before" | "confirm" | "unlogged";

/** §7.5's five close reasons, as constrained by migrations 0020 and 0028. */
export type WindowCloseReason =
  | "result_logged"
  | "two_no_in_a_row"
  | "window_exhausted"
  | "ct_cancelled"
  | "never_reached";

export type ConfirmAnswer = "yes" | "no";

/**
 * One existing `alerts` row, plus the answer recorded against it if it is a
 * 'confirm' row whose token was actually spent.
 *
 * `answer` is null for every other case, and the two that produce null are
 * deliberately indistinguishable here: a token still live and a token expired
 * unused are both "not answered", and §7.3 treats them identically.
 */
export type ExistingAlert = {
  kind: AlertKind;
  target_date: string;
  last_sent_at: string | null;
  answer?: ConfirmAnswer | null;
};

export type WindowInput = {
  /**
   * The occurrence dates this window watches, ascending, re-derived from the
   * routine every run rather than read back from `alerts`. A CT window holds
   * exactly one; a CWM window holds up to four.
   */
  occurrences: string[];
  /** Tonight's date in the student's timezone, `YYYY-MM-DD`. */
  today: string;
  /** Every `alerts` row already written for this assessment. */
  alerts: ExistingAlert[];
  timeZone?: string;
};

export type WindowPlan = {
  /**
   * The single advance-or-night-before alert tonight's evening is spent on, if
   * any. Never more than one: §7.3 caps sends to distinct evenings, and this
   * shape is that cap made unrepresentable rather than merely checked.
   */
  send: { kind: "advance" | "night_before"; targetDate: string } | null;
  /**
   * Occurrences that have arrived and still have no 'confirm' row — §7.4's
   * "Did this happen?" section. Independent of `send`: §7.3 is explicit that an
   * occurrence gets its confirm row "whether or not its advance/night-before
   * ever got an independent send".
   */
  confirms: string[];
  /** Non-null when tonight's run should close the window (§7.5). */
  close: WindowCloseReason | null;
};

/**
 * The evenings this assessment has already spent, as local dates.
 *
 * §7.3's exact query, in TypeScript: the distinct `last_sent_at::date` of every
 * 'advance' or 'night_before' row. 'confirm' and 'unlogged' are excluded on
 * purpose — they are not part of the two-evening pattern and do not compete for
 * an evening.
 */
export function eveningsUsed(
  alerts: ExistingAlert[],
  timeZone = DEFAULT_TIMEZONE,
): Set<string> {
  const used = new Set<string>();

  for (const alert of alerts) {
    if (alert.kind !== "advance" && alert.kind !== "night_before") continue;
    if (!alert.last_sent_at) continue;
    used.add(localDate(new Date(alert.last_sent_at), timeZone));
  }

  return used;
}

/**
 * The answers this window has collected, in occurrence order.
 *
 * §7.3: "Take every 'confirm'-kind alerts row for the assessment, ordered by
 * target_date, and look up each one's confirm_tokens.answer where one was
 * actually recorded. Build the sequence of *answered* occurrences only."
 */
export function answeredSequence(alerts: ExistingAlert[]): ConfirmAnswer[] {
  return alerts
    .filter((a) => a.kind === "confirm" && (a.answer === "yes" || a.answer === "no"))
    .sort((a, b) => a.target_date.localeCompare(b.target_date))
    .map((a) => a.answer as ConfirmAnswer);
}

/**
 * §7.3's `two_no_in_a_row`, over answered occurrences only.
 *
 * "The window closes the moment the last two entries in that sequence are both
 * `no`. A `yes` anywhere resets the count, so this is specifically two `no`s
 * back-to-back — never two over the window's whole life, and never a single
 * `no`."
 *
 * Reading only the last two entries is what delivers all three of those
 * clauses at once: a `yes` between two `no`s is never the last two, and a lone
 * `no` never fills both slots.
 */
export function closesForTwoNoInARow(alerts: ExistingAlert[]): boolean {
  const answers = answeredSequence(alerts);
  if (answers.length < 2) return false;
  return answers[answers.length - 1] === "no" && answers[answers.length - 2] === "no";
}

/**
 * §7.3's `window_exhausted`, computed from the routine.
 *
 * "Once today is past the fourth occurrence's date and the assessment is still
 * unmarked." Strictly past: on the evening of the last occurrence the class has
 * happened but its "Did this happen?" question has not been asked yet, and
 * closing there would retire the window without ever putting it.
 *
 * A window with no occurrences at all — a subject the routine never mentions —
 * is not exhausted, it is unopenable, and the caller never gets this far.
 *
 * This is a fact about dates only — "have all four occurrences passed" — and
 * says nothing about whether the engine was ever actually running to ask about
 * any of them. `closeReasonForExhaustion` below is what tells those two
 * situations apart; this function stays exactly what its name says.
 */
export function isExhausted(occurrences: string[], today: string): boolean {
  if (occurrences.length === 0) return false;
  const last = occurrences[occurrences.length - 1];
  return today > last;
}

/**
 * `window_exhausted` vs `never_reached` — both fire only once `isExhausted`
 * is already true, and both retire the window the same way; the only question
 * is which sentence honestly describes what happened.
 *
 * §7.3/§7.5 wrote `window_exhausted` to mean "we asked about all four
 * occurrences and got no result" — the four-occurrence cap doing the same job
 * the old flat 14-day expiry used to. That reading assumes the engine was
 * actually running while the window was open. It was not designed against a
 * gap between nightly runs: a Supabase free project pausing after ~7 days of
 * inactivity (§2), a broken cron-job.org schedule, a paused Vercel account —
 * any of these can mean the very first time the engine looks at a window is
 * already after every one of its occurrences has passed. `isExhausted` is
 * still true in that case, but nothing was ever asked, and reporting
 * `window_exhausted` would tell a tutor "the student never confirmed a paper
 * that was asked about four times", when the honest story is "this was never
 * reached by a running instance of the app".
 *
 * The distinguishing fact is already sitting in `alerts`, no new state
 * required: a window the engine genuinely watched night to night has a
 * `confirm` row for at least one occurrence, minted the evening that
 * occurrence's date arrived (advanceWindows's confirm loop runs on every live
 * night). A window the engine never got to touch before hitting exhaustion on
 * first contact has none at all — not even one. Partial engagement (a `confirm`
 * exists for some but not all occurrences, e.g. a shorter gap mid-window)
 * counts as reached: the engine was running for at least part of this
 * window's life, which is what `window_exhausted` is actually claiming.
 */
export function closeReasonForExhaustion(
  alerts: ExistingAlert[],
): "window_exhausted" | "never_reached" {
  const everAsked = alerts.some((a) => a.kind === "confirm");
  return everAsked ? "window_exhausted" : "never_reached";
}

/**
 * Tonight's decision for one open window.
 *
 * Order matters, and it is the order §7.5 implies: a window that should close
 * closes, and does not also send. The reverse would mail a student about an
 * occurrence the same run decided to stop watching.
 *
 * `result_logged` is deliberately absent from everything below. Migration 0020
 * made it a database fact — `results_mark_assessment_logged()` writes
 * `window_closed_at` / `window_close_reason` the moment a result lands, from
 * whichever of the three writers got there, so by the time the engine runs a
 * logged window is already closed and never reaches this function. `ct_cancelled`
 * is likewise the cancel action's business, not the nightly run's.
 */
export function planWindow(input: WindowInput): WindowPlan {
  const { occurrences, today, alerts, timeZone = DEFAULT_TIMEZONE } = input;

  const idle: WindowPlan = { send: null, confirms: [], close: null };

  if (closesForTwoNoInARow(alerts)) {
    return { ...idle, close: "two_no_in_a_row" };
  }

  if (isExhausted(occurrences, today)) {
    return { ...idle, close: closeReasonForExhaustion(alerts) };
  }

  // §7.6: a Yes sets the assessment to 'occurred' and creates a pending-result
  // placeholder; "the window closes the normal way once that result is logged".
  // So the window stays open — it is waiting for the paper, not for another
  // class — but it has nothing left to predict. Sending an advance alert for a
  // CWM the student has already told us happened is the single most obviously
  // broken thing this engine could do.
  const confirmedHappened = answeredSequence(alerts).includes("yes");

  const confirms = confirmedHappened
    ? []
    : occurrences.filter(
        (date) =>
          // §7.4 section 5: "predicted CWMs whose class day has passed". The
          // evening of the class day itself counts — school ended hours before
          // the 8pm digest, and waiting a further day asks about a paper the
          // student may already be holding.
          date <= today &&
          // "Asked" means delivered, not merely written. A row's mere
          // existence is not enough to exclude it — the caller writes a
          // confirm row (and mints its token) before it knows whether
          // tonight's digest email will actually send, so a row with
          // last_sent_at still null represents a question that was reserved
          // but never reached anyone, and must be re-offered. `answer` is
          // checked too, defensively: answering at all is only possible once
          // the question actually reached someone, whatever this row's own
          // delivery bookkeeping says.
          !alerts.some(
            (a) =>
              a.kind === "confirm" &&
              a.target_date === date &&
              (a.last_sent_at !== null || a.answer != null),
          ),
      );

  if (confirmedHappened) return { ...idle, confirms };

  const used = eveningsUsed(alerts, timeZone);

  // §7.3: "If tonight's date (Asia/Dhaka) is already in that set, skip the send
  // outright — no row gets written for it." The confirms above are unaffected,
  // which is the whole point of computing them first.
  if (used.has(today)) return { ...idle, confirms };

  // Occurrences ascending, so when occurrence 1's night-before and occurrence
  // 2's advance compute to the same evening — unavoidable on a subject that
  // meets every school day, like Maths — the nearer occurrence claims it. §7.3
  // says "whichever is processed first"; this makes that order the useful one
  // rather than an accident of row ordering.
  for (const date of [...occurrences].sort()) {
    if (date <= today) continue;

    const alreadySent = (kind: "advance" | "night_before") =>
      alerts.some((a) => a.kind === kind && a.target_date === date && a.last_sent_at);

    if (addDays(date, -1) === today && !alreadySent("night_before")) {
      return { send: { kind: "night_before", targetDate: date }, confirms, close: null };
    }

    if (addDays(date, -2) === today && !alreadySent("advance")) {
      return { send: { kind: "advance", targetDate: date }, confirms, close: null };
    }
  }

  return { ...idle, confirms };
}
