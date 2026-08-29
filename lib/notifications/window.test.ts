// §7.3's window arithmetic. Three of these cases are the reason the spec spells
// the computation out rather than describing it in prose:
//
//   * the distinct-evenings cap, where a subject meeting every school day makes
//     one occurrence's night-before collide with the next one's advance;
//   * two_no_in_a_row over *answered* occurrences only, so an expired token
//     neither breaks nor extends a run of no's;
//   * window_exhausted derived from the routine rather than from counting rows,
//     because a skipped occurrence never wrote a row to count.

import { describe, expect, it } from "vitest";
import {
  answeredSequence,
  closesForTwoNoInARow,
  eveningsUsed,
  isExhausted,
  planWindow,
  type ExistingAlert,
} from "./window";

/** 8pm Asia/Dhaka on the given date, as the timestamptz the DB would hand back. */
function sentOn(isoDate: string): string {
  return `${isoDate}T14:00:00.000Z`;
}

function alert(partial: Partial<ExistingAlert> & { kind: ExistingAlert["kind"]; target_date: string }): ExistingAlert {
  return { last_sent_at: null, answer: null, ...partial };
}

// Chemistry meets Sun/Mon/Tue. A window opened on Saturday 2026-08-29 watches
// Sun 30, Mon 31, Tue 1, then the following Sun 6.
const CHEM = ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-06"];

describe("eveningsUsed — §7.3's distinct-evenings query", () => {
  it("collects the local dates of advance and night_before sends", () => {
    const used = eveningsUsed([
      alert({ kind: "advance", target_date: "2026-08-30", last_sent_at: sentOn("2026-08-28") }),
      alert({ kind: "night_before", target_date: "2026-08-30", last_sent_at: sentOn("2026-08-29") }),
    ]);

    expect([...used].sort()).toEqual(["2026-08-28", "2026-08-29"]);
  });

  it("ignores confirm and unlogged rows — they do not compete for an evening", () => {
    const used = eveningsUsed([
      alert({ kind: "confirm", target_date: "2026-08-30", last_sent_at: sentOn("2026-08-30") }),
      alert({ kind: "unlogged", target_date: "2026-08-30", last_sent_at: sentOn("2026-09-02") }),
    ]);

    expect(used.size).toBe(0);
  });

  it("ignores a row that was created but never sent", () => {
    expect(eveningsUsed([alert({ kind: "advance", target_date: "2026-08-30" })]).size).toBe(0);
  });

  it("reads the evening in Dhaka, not UTC", () => {
    // 2026-08-29T20:30+06:00 is 14:30Z on the 29th — same day either way. But
    // 2026-08-29T23:30+06:00 is 17:30Z on the 29th, and a naive UTC read of a
    // send made just before midnight Dhaka would still say the 29th. The case
    // that actually separates them is a send at 05:00 Dhaka on the 30th, which
    // is 23:00Z on the 29th.
    const used = eveningsUsed([
      alert({ kind: "advance", target_date: "2026-09-01", last_sent_at: "2026-08-29T23:00:00.000Z" }),
    ]);

    expect([...used]).toEqual(["2026-08-30"]);
  });
});

describe("answeredSequence — §7.3", () => {
  it("orders by occurrence, not by insertion", () => {
    const answers = answeredSequence([
      alert({ kind: "confirm", target_date: "2026-09-01", answer: "no" }),
      alert({ kind: "confirm", target_date: "2026-08-30", answer: "yes" }),
    ]);

    expect(answers).toEqual(["yes", "no"]);
  });

  it("skips an occurrence whose token expired unused", () => {
    const answers = answeredSequence([
      alert({ kind: "confirm", target_date: "2026-08-30", answer: "no" }),
      alert({ kind: "confirm", target_date: "2026-08-31" }),
      alert({ kind: "confirm", target_date: "2026-09-01", answer: "no" }),
    ]);

    // Two entries, not three: the unanswered middle occurrence is "skipped
    // entirely, neither breaking nor extending anything".
    expect(answers).toEqual(["no", "no"]);
  });
});

describe("closesForTwoNoInARow — §7.3, §7.5", () => {
  it("does not close on a single no", () => {
    expect(closesForTwoNoInARow([
      alert({ kind: "confirm", target_date: "2026-08-30", answer: "no" }),
    ])).toBe(false);
  });

  it("closes on two no's back to back", () => {
    expect(closesForTwoNoInARow([
      alert({ kind: "confirm", target_date: "2026-08-30", answer: "no" }),
      alert({ kind: "confirm", target_date: "2026-08-31", answer: "no" }),
    ])).toBe(true);
  });

  it("does not close on two no's separated by a yes — a yes resets the count", () => {
    expect(closesForTwoNoInARow([
      alert({ kind: "confirm", target_date: "2026-08-30", answer: "no" }),
      alert({ kind: "confirm", target_date: "2026-08-31", answer: "yes" }),
      alert({ kind: "confirm", target_date: "2026-09-01", answer: "no" }),
    ])).toBe(false);
  });

  it("closes when an expired token sits between two no's", () => {
    // §7.3: the unanswered occurrence is skipped, so these two no's ARE
    // back-to-back in the answered sequence even though a third occurrence
    // happened between them.
    expect(closesForTwoNoInARow([
      alert({ kind: "confirm", target_date: "2026-08-30", answer: "no" }),
      alert({ kind: "confirm", target_date: "2026-08-31" }),
      alert({ kind: "confirm", target_date: "2026-09-01", answer: "no" }),
    ])).toBe(true);
  });
});

describe("isExhausted — §7.3, computed from the routine", () => {
  it("is not exhausted on the evening of the last occurrence", () => {
    // The class happened this morning; its "Did this happen?" question has not
    // been asked yet, and closing here would retire the window without putting
    // it.
    expect(isExhausted(CHEM, "2026-09-06")).toBe(false);
  });

  it("is exhausted the day after the last occurrence", () => {
    expect(isExhausted(CHEM, "2026-09-07")).toBe(true);
  });

  it("is not exhausted while occurrences remain", () => {
    expect(isExhausted(CHEM, "2026-08-31")).toBe(false);
  });
});

describe("planWindow — the nightly decision", () => {
  it("sends the advance alert two evenings out", () => {
    const plan = planWindow({ occurrences: CHEM, today: "2026-08-28", alerts: [] });

    expect(plan.send).toEqual({ kind: "advance", targetDate: "2026-08-30" });
    expect(plan.close).toBeNull();
  });

  it("sends the night-before alert the evening before", () => {
    const plan = planWindow({
      occurrences: CHEM,
      today: "2026-08-29",
      alerts: [alert({ kind: "advance", target_date: "2026-08-30", last_sent_at: sentOn("2026-08-28") })],
    });

    expect(plan.send).toEqual({ kind: "night_before", targetDate: "2026-08-30" });
  });

  it("fires on a Friday and a Saturday when the occurrence is a Sunday", () => {
    // §7.3: "a Friday/Saturday send is exactly as normal here as it always
    // was" — the routine decides which day the class falls on, never which
    // evenings the student is reachable. 2026-08-28 is a Friday, 08-29 a
    // Saturday, and the occurrence is Sunday the 30th.
    expect(planWindow({ occurrences: CHEM, today: "2026-08-28", alerts: [] }).send?.kind)
      .toBe("advance");
    expect(planWindow({ occurrences: CHEM, today: "2026-08-29", alerts: [] }).send?.kind)
      .toBe("night_before");
  });

  it("spends an evening only once — the distinct-evenings cap", () => {
    // 2026-08-29 is occurrence 1's night-before AND occurrence 2's advance.
    // Something already claimed the evening, so nothing more is sent and no row
    // is written for the loser.
    const plan = planWindow({
      occurrences: CHEM,
      today: "2026-08-29",
      alerts: [
        alert({ kind: "night_before", target_date: "2026-08-30", last_sent_at: sentOn("2026-08-29") }),
      ],
    });

    expect(plan.send).toBeNull();
  });

  it("gives a colliding evening to the nearer occurrence", () => {
    // Same evening, nothing claimed yet: occurrence 1's night-before wins over
    // occurrence 2's advance, because the class it warns about is sooner.
    const plan = planWindow({ occurrences: CHEM, today: "2026-08-29", alerts: [] });

    expect(plan).toMatchObject({
      send: { kind: "night_before", targetDate: "2026-08-30" },
    });
  });

  it("costs a daily subject at most one send per evening across the window", () => {
    // The §7.3 worst case: a subject meeting every school day. Four
    // occurrences would naively produce eight sends; walk the whole window
    // evening by evening and count what actually goes out.
    const daily = ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"];
    const sent: ExistingAlert[] = [];
    const evenings: string[] = [];

    for (const today of [
      "2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01",
    ]) {
      const plan = planWindow({ occurrences: daily, today, alerts: sent });
      if (plan.send) {
        evenings.push(today);
        sent.push(alert({ ...plan.send, target_date: plan.send.targetDate, last_sent_at: sentOn(today) }));
      }
      for (const date of plan.confirms) {
        sent.push(alert({ kind: "confirm", target_date: date }));
      }
    }

    // One send per evening, never two — and five evenings spanned, not eight.
    expect(evenings).toEqual([
      "2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01",
    ]);
    expect(sent.filter((a) => a.kind === "advance" || a.kind === "night_before")).toHaveLength(5);
  });

  it("creates a confirm row on the evening of the occurrence itself", () => {
    const plan = planWindow({ occurrences: CHEM, today: "2026-08-30", alerts: [] });

    expect(plan.confirms).toEqual(["2026-08-30"]);
  });

  it("creates a confirm row even when the occurrence's evening was claimed by a sibling", () => {
    // §7.3: "The occurrence is still tracked on its own terms: its confirm row
    // is created independently once its target_date passes, whether or not its
    // advance/night-before ever got an independent send."
    const plan = planWindow({
      occurrences: CHEM,
      today: "2026-08-31",
      alerts: [
        alert({ kind: "advance", target_date: "2026-09-01", last_sent_at: sentOn("2026-08-31") }),
        alert({ kind: "confirm", target_date: "2026-08-30" }),
      ],
    });

    expect(plan.send).toBeNull();
    expect(plan.confirms).toEqual(["2026-08-31"]);
  });

  it("does not ask the same occurrence twice", () => {
    const plan = planWindow({
      occurrences: CHEM,
      today: "2026-08-31",
      alerts: [
        alert({ kind: "confirm", target_date: "2026-08-30" }),
        alert({ kind: "confirm", target_date: "2026-08-31" }),
      ],
    });

    expect(plan.confirms).toEqual([]);
  });

  it("stops predicting once an occurrence is confirmed as having happened", () => {
    // §7.6: a Yes moves the assessment to 'occurred' and waits on the paper.
    // The window stays open — it just has nothing left to predict.
    const plan = planWindow({
      occurrences: CHEM,
      today: "2026-08-31",
      alerts: [alert({ kind: "confirm", target_date: "2026-08-30", answer: "yes" })],
    });

    expect(plan.send).toBeNull();
    expect(plan.confirms).toEqual([]);
    expect(plan.close).toBeNull();
  });

  it("moves to the next occurrence after a single No", () => {
    // §7.6: "No does not close the window by itself. It advances to the next
    // occurrence still open in the window."
    const plan = planWindow({
      occurrences: CHEM,
      today: "2026-08-30",
      alerts: [
        alert({ kind: "confirm", target_date: "2026-08-30", answer: "no" }),
        alert({ kind: "night_before", target_date: "2026-08-30", last_sent_at: sentOn("2026-08-29") }),
      ],
    });

    expect(plan.close).toBeNull();
    expect(plan.send).toEqual({ kind: "night_before", targetDate: "2026-08-31" });
  });

  it("closes on two no's, and sends nothing in the same run", () => {
    const plan = planWindow({
      occurrences: CHEM,
      today: "2026-08-31",
      alerts: [
        alert({ kind: "confirm", target_date: "2026-08-30", answer: "no" }),
        alert({ kind: "confirm", target_date: "2026-08-31", answer: "no" }),
      ],
    });

    expect(plan).toEqual({ send: null, confirms: [], close: "two_no_in_a_row" });
  });

  it("closes as exhausted once the window's last occurrence has passed", () => {
    const plan = planWindow({ occurrences: CHEM, today: "2026-09-07", alerts: [] });

    expect(plan.close).toBe("window_exhausted");
  });

  it("prefers two_no_in_a_row over exhaustion when both are true", () => {
    // Both close the window; the reason recorded should be the one that
    // actually stopped it, and the two no's stopped it days earlier.
    const plan = planWindow({
      occurrences: CHEM,
      today: "2026-09-07",
      alerts: [
        alert({ kind: "confirm", target_date: "2026-08-30", answer: "no" }),
        alert({ kind: "confirm", target_date: "2026-08-31", answer: "no" }),
      ],
    });

    expect(plan.close).toBe("two_no_in_a_row");
  });

  it("handles a CT's one-occurrence window", () => {
    const ct = ["2026-09-03"];

    expect(planWindow({ occurrences: ct, today: "2026-09-01", alerts: [] }).send)
      .toEqual({ kind: "advance", targetDate: "2026-09-03" });
    expect(planWindow({ occurrences: ct, today: "2026-09-02", alerts: [] }).send)
      .toEqual({ kind: "night_before", targetDate: "2026-09-03" });
    expect(planWindow({ occurrences: ct, today: "2026-09-04", alerts: [] }).close)
      .toBe("window_exhausted");
  });

  it("never re-sends an alert whose row already went out", () => {
    // A cron double-fire inside one evening. The unique key would collapse the
    // upsert anyway, but a second send is a second email, and §7.1 is explicit
    // about what that costs.
    const alerts = [
      alert({ kind: "advance", target_date: "2026-08-30", last_sent_at: sentOn("2026-08-28") }),
    ];

    expect(planWindow({ occurrences: CHEM, today: "2026-08-28", alerts }).send).toBeNull();
  });
});
