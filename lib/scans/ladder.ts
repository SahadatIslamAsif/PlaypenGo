// §5.3's mark resolution — "the ellipse ladder." The teacher's circled or
// slashed fraction on page 1 is authoritative whenever it exists; the header's
// `Obtained marks` / `Total marks` blanks are a fallback the teacher often
// ignores. Resolve in order, stop at the first hit:
//
//   1. An ellipse on page 1 — read as obtained/total, and nothing after this
//      step is consulted even if the header disagrees.
//   2. The header blanks, as a pair.
//   3. A struck-through blank counts as empty, not as a value — this only
//      ever matters at step 2, since step 1 already won if an ellipse exists.
//   4. Nothing found — leave both fields empty. Never guess.
//
// "Only page 1 carries the total." A page-2 ellipse (the Env. Management
// sample's `6`, with no denominator at all) is real data for the review
// screen to display, but it never enters this ladder and is never summed.
//
// "Unreadable is the same as blank." Handwritten totals are ambiguous — `15`
// can read as `L5` — so anything that is not a clean non-negative integer is
// treated as absent rather than guessed at.

export type MarkCandidate = {
  page: number;
  valueObtained: number | null;
  valueTotal: number | null;
  style: string;
  location: string;
};

export type HeaderMarks = {
  totalMarksField: number | null;
  obtainedMarksField: number | null;
  obtainedFieldStruckThrough: boolean;
};

export type LadderResult = {
  obtained: number | null;
  total: number | null;
  source: "ellipse" | "header" | "none";
};

/** A clean non-negative integer, or null for anything ambiguous — the `L5`
 * case, a negative, a fraction, or a value that never arrived as a number. */
function cleanMark(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

// The parse schema constrains style to exactly "ellipse" | "boxed" |
// "underlined" | "plain" (lib/scans/parse/schema.ts), but an enum on the
// wire is a request to the model, not a guarantee — belt and braces: the
// ladder folds a handful of synonyms the model could still emit ("circle",
// "circled", "oval") onto "ellipse" rather than trusting the enum alone.
// Silently skipping a real page-1 mark because of a word choice is a wrong
// answer with no error; normalising here is cheap insurance against that.
const ELLIPSE_STYLE_ALIASES = new Set(["ellipse", "circle", "circled", "oval"]);

function isEllipseStyle(style: string): boolean {
  return ELLIPSE_STYLE_ALIASES.has(style.trim().toLowerCase());
}

/** Every ellipse-style candidate on page 1, in the order the parse reported
 * them. Rule 4: "Multiple ellipses on page 1 are rare. Take the first,
 * surface the rest as candidates" — this is what the ladder consumes the
 * first of, and what the review screen shows the rest of. */
export function page1Ellipses(candidates: MarkCandidate[]): MarkCandidate[] {
  return candidates.filter((c) => c.page === 1 && isEllipseStyle(c.style));
}

/** Candidates on any page after the first — reported for display, never
 * weighed by the ladder and never summed into a total. */
export function laterPageCandidates(candidates: MarkCandidate[]): MarkCandidate[] {
  return candidates.filter((c) => c.page > 1);
}

export function resolveMarks(
  candidates: MarkCandidate[],
  header: HeaderMarks,
): LadderResult {
  const [firstEllipse] = page1Ellipses(candidates);
  if (firstEllipse) {
    return {
      obtained: cleanMark(firstEllipse.valueObtained),
      total: cleanMark(firstEllipse.valueTotal),
      source: "ellipse",
    };
  }

  const obtained = header.obtainedFieldStruckThrough
    ? null
    : cleanMark(header.obtainedMarksField);
  const total = cleanMark(header.totalMarksField);

  if (obtained !== null && total !== null) {
    return { obtained, total, source: "header" };
  }

  return { obtained: null, total: null, source: "none" };
}
