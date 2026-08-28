// Three of §5.3's matching rules, none of them a database query — each takes
// the candidates the caller already loaded and picks among them.

import { normalise } from "@/lib/routines/resolve";

// ------------------------------------------------------------ name mismatch ---
//
// "Use token-subset matching, not whole-string edit distance — `Rakib
// Hasan Chowdhury` against a profile reading `Rakib Chowdhury` must pass."
// Subset in either direction: a profile can carry a fuller name than the
// paper does, or the other way around, and it should still pass.

function nameTokens(name: string): Set<string> {
  return new Set(normalise(name).split(" ").filter(Boolean));
}

/** True if every token of the smaller name appears in the larger one. */
export function namesMatch(parsedName: string, profileName: string): boolean {
  const parsed = nameTokens(parsedName);
  const profile = nameTokens(profileName);
  if (parsed.size === 0 || profile.size === 0) return false;

  const [smaller, larger] = parsed.size <= profile.size ? [parsed, profile] : [profile, parsed];
  for (const token of smaller) {
    if (!larger.has(token)) return false;
  }
  return true;
}

// -------------------------------------------------------------- CT attach ---
//
// "No fuzzy date matching... If no CT matches the exact date but an open
// scheduled CT exists for that subject, list it in the modal as a selectable
// option... never auto-match, never hide." The caller filters candidates to
// the parsed subject before calling this — matching is on date alone here.

export type CTCandidate = { id: string; scheduledDate: string };

export type CTAttachResult = {
  /** Set only on an exact date match — the one case that auto-attaches. */
  matchId: string | null;
  /** Every other open CT for the subject, offered as a selectable option —
   * covers the postponed-CT case without guessing at it. */
  options: CTCandidate[];
};

export function findCTAttachment(
  candidates: CTCandidate[],
  occurredDate: string,
): CTAttachResult {
  const exact = candidates.find((c) => c.scheduledDate === occurredDate);
  if (exact) {
    return { matchId: exact.id, options: [] };
  }
  return { matchId: null, options: candidates };
}

// ------------------------------------------------------------- CWM attach ---
//
// "Chapter is a preference for picking between windows, never a requirement
// for attaching." A chapter match wins when one exists; otherwise the oldest
// open window is offered, and either way the modal shows which window was
// matched, with "file as a new assessment" always available.

export type CWMWindowCandidate = { id: string; chapterIds: string[]; createdAt: string };

export type CWMAttachResult = {
  matchId: string | null;
  matchedBy: "chapter" | "oldest" | null;
};

export function findCWMAttachment(
  windows: CWMWindowCandidate[],
  inferredChapterId: string | null,
): CWMAttachResult {
  if (windows.length === 0) return { matchId: null, matchedBy: null };

  if (inferredChapterId) {
    const byChapter = windows.find((w) => w.chapterIds.includes(inferredChapterId));
    if (byChapter) return { matchId: byChapter.id, matchedBy: "chapter" };
  }

  const oldest = [...windows].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  return { matchId: oldest.id, matchedBy: "oldest" };
}

// ------------------------------------------------------------- duplicates ---
//
// "The same paper can be scanned twice. Match on student + subject +
// occurred_date + raw score; on a hit, offer attach these images to the
// existing result rather than rejecting the upload." Student is implicit —
// the caller only ever loads its own student's results.

export type ExistingResult = {
  id: string;
  studentSubjectId: string;
  occurredDate: string;
  rawObtained: number;
  rawTotal: number;
};

export function findDuplicateResult(
  existing: ExistingResult[],
  candidate: {
    studentSubjectId: string;
    occurredDate: string;
    rawObtained: number;
    rawTotal: number;
  },
): ExistingResult | null {
  return (
    existing.find(
      (r) =>
        r.studentSubjectId === candidate.studentSubjectId &&
        r.occurredDate === candidate.occurredDate &&
        r.rawObtained === candidate.rawObtained &&
        r.rawTotal === candidate.rawTotal,
    ) ?? null
  );
}
