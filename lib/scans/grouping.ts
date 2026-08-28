// §5.3's page grouping — but narrowed by the settled decision that one scan
// job is one paper. Upstream `scan_jobs`/`scan_pages` already enforce that:
// there is no second header row to attach a headerless page to inside one
// job. What this module does is flag the two ways a capture can turn out not
// to be one paper after all, so the review screen can act on it rather than
// silently mis-file the pages:
//
//   * the first page has no header — an orphan. §5.3: "Ask; do not attach it
//     to nothing."
//   * a later page reports a header that genuinely belongs to a different
//     paper — "this looks like two papers," and the fix is the same paper /
//     new paper toggle's split action, never a rejected upload. Losing a
//     capture the student already made is the one outcome to avoid.
//
// Splitting is the toggle's only job — it spawns a second scan job and
// re-parses, never merges two jobs into one.
//
// "A later page has a header" is not by itself evidence of a second paper:
// §5.3 also says "A CT question paper may print its header on every page.
// Guard with same subject + same date + consecutive → same paper." A CT
// captured as three pages, each reprinting the header, is one paper — flagging
// it would make the warning fire on every ordinary multi-page CT, and a
// warning that's usually wrong gets ignored on the day it's actually right.
// So the guard is biased toward silence: a later header page is only flagged
// when its subject or date genuinely disagrees with the paper it would
// otherwise continue, never merely because it exists.
//
// `subject`/`date` are whatever the caller has already resolved for that
// page's header — a matched subject identifier and the parsed ISO date, not
// raw OCR text — the same way match.ts leaves subject/chapter resolution to
// its caller rather than doing it itself.

export type PageInfo = {
  pageNo: number;
  hasHeader: boolean | null;
  subject: string | null;
  date: string | null;
};

export type GroupingWarning =
  | { kind: "orphan_first_page" }
  | { kind: "possible_split"; atPageNo: number };

/**
 * `hasHeader: null` means the parse has not run yet, or didn't report on that
 * page — never treated as a signal either way, same as before.
 *
 * Page numbers are upload order with no gaps (scan_pages is 1..N, never
 * sparse), so walking the pages in order and comparing each header page
 * against the most recently seen one *is* the "consecutive" half of the
 * guard — there is no earlier-but-non-adjacent header page it could be
 * compared against instead.
 */
export function analyzeGrouping(pages: PageInfo[]): GroupingWarning[] {
  const warnings: GroupingWarning[] = [];

  const sorted = [...pages].sort((a, b) => a.pageNo - b.pageNo);
  const first = sorted[0];
  if (first && first.hasHeader === false) {
    warnings.push({ kind: "orphan_first_page" });
  }

  // The identity of the paper the current run of pages belongs to — set by
  // the first header page whose subject AND date both resolved, and re-set at
  // a genuine split so any further pages are judged against the paper they'd
  // now be continuing. Only ever holds a fully-resolved identity; a page that
  // resolved neither, or only one, of the two never becomes the reference.
  let reference: { subject: string; date: string } | null = null;

  for (const page of sorted) {
    if (page.hasHeader !== true) continue;

    const resolved = page.subject !== null && page.date !== null;

    // An unresolved subject or date is the ordinary shape of a bad photo —
    // glare, a fold across the header, a subject the alias table hasn't seen
    // yet — not evidence of anything. Flagging it would fire the warning most
    // often exactly when the parse tells us least, which is backwards: this
    // guard exists to keep the warning rare enough that it's still believed
    // on the day it's right, and "unknown" cannot be allowed to read as
    // "disagrees." Being wrong the other way costs one tap in the review
    // screen to split two papers that got grouped as one; that asymmetry is
    // exactly why the comparison below only ever runs when both sides are
    // fully resolved.
    if (reference !== null && resolved) {
      const sameSubject = page.subject === reference.subject;
      const sameDate = page.date === reference.date;
      if (!(sameSubject && sameDate)) {
        warnings.push({ kind: "possible_split", atPageNo: page.pageNo });
      }
    }

    // An unresolved page updates nothing — the last known-good identity is
    // worth more than replacing it with a blank, since a later page that does
    // resolve should still be checked against what the paper actually is.
    if (resolved) {
      reference = { subject: page.subject as string, date: page.date as string };
    }
  }

  return warnings;
}

/**
 * The split action itself: everything from `atPageNo` onward becomes a fresh
 * job's pages, renumbered from 1 so the new job's own header rule (page 1
 * must carry one) applies to it independently. Everything before stays in
 * capture order, untouched.
 */
export function splitPagesAt<T extends { pageNo: number }>(
  pages: T[],
  atPageNo: number,
): { keep: T[]; moved: T[] } {
  const sorted = [...pages].sort((a, b) => a.pageNo - b.pageNo);
  const keep = sorted.filter((p) => p.pageNo < atPageNo);
  const moved = sorted
    .filter((p) => p.pageNo >= atPageNo)
    .map((p, i) => ({ ...p, pageNo: i + 1 }));
  return { keep, moved };
}
