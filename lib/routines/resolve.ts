// Cell text -> a subject, and the §5.1 rules that decide when a cell is not a
// subject at all.
//
// This module is the reason Phase 3 is worth building before Phase 5. Every
// rule below is one §5.1 states for the routine parse, but none of them are
// really about the model: they are about what a Playpen routine cell means. A
// human typing 'Phy' and Gemini reading 'Phy' off a photograph must resolve to
// the same subject, so the resolution lives here, once, and the parse becomes
// nothing more than another way to fill the same grid.
//
// Nothing here reaches the network or the database. The caller passes the
// candidates it already loaded for the page.

export type SubjectCandidate = {
  id: string;
  display_name: string;
  /** Student-scoped corrections, global aliases and catalogue common_aliases,
   *  already merged by the caller. */
  aliases: string[];
};

export type MatchKind = "exact" | "alias" | "fuzzy" | "none";

export type Resolution = {
  subjectId: string | null;
  kind: MatchKind;
  /** True when the text names a break or a non-academic period (§5.1 rules 1-2). */
  isNonAcademic: boolean;
};

// §5.1 rule 2. A named period that is not a lesson. 'Break' is here as well as
// in the column heuristic below, because a routine that spells it out in one
// cell is more common than the vertical form.
export const NON_ACADEMIC = [
  "break",
  "games",
  "e.c.a.",
  "eca",
  "assembly",
  "library",
  "prayer",
  "lunch",
  "tiffin",
  "sports",
  "club",
];

/**
 * Lowercase, strip punctuation and collapse whitespace. `Env. Mgt` and
 * `env mgt` are the same cell written twice; `E.C.A.` and `ECA` likewise.
 *
 * Dots are deleted rather than spaced, which is what makes the abbreviation
 * pair work — `E.C.A.` has to reach `eca`, not `e c a`. The other separators
 * become spaces, because `Math-D` and `Math D` are the same subject.
 *
 * `\p{M}` is in the keep set alongside letters and digits: Bangla vowel signs
 * are combining marks, and dropping them turns বাংলা into বল. §4.2 requires
 * Bengali to survive verbatim, and it has to survive matching too.
 */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[\-_/\\]/g, " ")
    .replace(/[^\p{L}\p{M}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isNonAcademicText(text: string): boolean {
  const n = normalise(text);
  if (!n) return false;
  return NON_ACADEMIC.some((word) => n === normalise(word));
}

/**
 * §5.1 rule 1: "The break column spells a word vertically." In the real sample
 * the 10:55-11:25 column holds B, R, E, A, K on Sunday through Thursday.
 *
 * Two signals, either sufficient: every filled cell is a single letter, or the
 * column concatenates to a non-academic word. A single-letter cell on its own
 * is not enough — a column of one letter and four subjects is a misread, not a
 * break.
 */
export function isBreakColumn(cells: string[]): boolean {
  const filled = cells.map((c) => c.trim()).filter(Boolean);
  if (filled.length === 0) return false;

  if (filled.every((c) => c.length === 1)) return true;

  // Every cell spells it out — the ordinary way a routine writes a break when
  // it isn't doing the vertical trick.
  if (filled.every((c) => isNonAcademicText(c))) return true;

  const joined = normalise(filled.join(""));
  return NON_ACADEMIC.some((word) => joined === normalise(word));
}

/**
 * Resolve one cell. Match order runs from most to least certain, and stops at
 * the first hit:
 *
 *   1. the subject's own display_name
 *   2. an alias — a student's past correction, a global alias, or a catalogue
 *      common_alias. §5.1's whole point in growing subject_aliases.
 *   3. punctuation-insensitive display_name
 *   4. punctuation-insensitive alias
 *   5. a unique prefix — 'Chem' for 'Chemistry'. Only when exactly one
 *      candidate starts with the text, so an ambiguous stem stays unresolved
 *      and reaches the human instead of being guessed.
 *
 * Anything else returns null, which §5.1 says renders as a dropdown.
 */
export function resolveSubject(
  rawText: string,
  candidates: SubjectCandidate[],
): Resolution {
  const raw = rawText.trim();
  if (!raw) return { subjectId: null, kind: "none", isNonAcademic: false };

  if (isNonAcademicText(raw)) {
    return { subjectId: null, kind: "none", isNonAcademic: true };
  }

  const lower = raw.toLowerCase();

  const exact = candidates.find((c) => c.display_name.toLowerCase() === lower);
  if (exact) return { subjectId: exact.id, kind: "exact", isNonAcademic: false };

  const aliased = candidates.find((c) =>
    c.aliases.some((a) => a.toLowerCase() === lower),
  );
  if (aliased) return { subjectId: aliased.id, kind: "alias", isNonAcademic: false };

  const n = normalise(raw);
  if (!n) return { subjectId: null, kind: "none", isNonAcademic: false };

  const loose = candidates.find((c) => normalise(c.display_name) === n);
  if (loose) return { subjectId: loose.id, kind: "fuzzy", isNonAcademic: false };

  const looseAlias = candidates.find((c) =>
    c.aliases.some((a) => normalise(a) === n),
  );
  if (looseAlias) {
    return { subjectId: looseAlias.id, kind: "fuzzy", isNonAcademic: false };
  }

  // A stem is only worth trusting when it points at exactly one subject.
  // 'Bengali' across Bengali I and Bengali II must stay a question for the human.
  if (n.length >= 3) {
    const prefixed = candidates.filter(
      (c) =>
        normalise(c.display_name).startsWith(n) ||
        c.aliases.some((a) => normalise(a).startsWith(n)),
    );
    if (prefixed.length === 1) {
      return { subjectId: prefixed[0].id, kind: "fuzzy", isNonAcademic: false };
    }
  }

  return { subjectId: null, kind: "none", isNonAcademic: false };
}

export type TeacherGroup = {
  /** The spelling used most often in this routine; ties break alphabetically. */
  canonical: string;
  variants: string[];
};

/**
 * §5.1 rule 4: "The sample has Shafiul on Sun/Mon and Shafiur on Tuesday for
 * the same Physics teacher. Fuzzy-match names within one routine and flag
 * near-duplicates for review rather than creating two teachers."
 *
 * Flag, never merge. Two teachers really can be called Rakin and Rakib, and
 * silently collapsing them would corrupt the prediction signal §5.1 rule 3
 * wants this field for. Only groups with more than one variant are returned —
 * those are the ones worth a warning.
 */
export function groupTeacherNames(names: string[]): TeacherGroup[] {
  const counts = new Map<string, number>();
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed) counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }

  const distinct = [...counts.keys()].sort();
  const groups: string[][] = [];

  for (const name of distinct) {
    const group = groups.find((g) => g.some((other) => isNearName(other, name)));
    if (group) group.push(name);
    else groups.push([name]);
  }

  return groups
    .filter((g) => g.length > 1)
    .map((variants) => ({
      canonical: [...variants].sort(
        (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b),
      )[0],
      variants: [...variants].sort(),
    }));
}

/**
 * Near enough to be worth asking about. Deliberately tight: same length or one
 * apart, sharing a prefix, and at most one edit. Bengali and Bangla teacher
 * names are short, and a loose threshold here produces warnings nobody reads.
 */
function isNearName(a: string, b: string): boolean {
  const x = normalise(a);
  const y = normalise(b);
  if (!x || !y || x === y) return false;
  if (Math.abs(x.length - y.length) > 1) return false;
  if (Math.min(x.length, y.length) < 4) return false;
  if (x[0] !== y[0]) return false;
  return editDistanceWithin(x, y, 1);
}

/** Levenshtein, short-circuited at `max`. Names are short; nothing clever needed. */
function editDistanceWithin(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    if (Math.min(...current) > max) return false;
    previous = current;
  }

  return previous[b.length] <= max;
}
