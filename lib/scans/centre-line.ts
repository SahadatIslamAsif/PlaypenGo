// §5.3's centre-line test: "The centre line under the header is ambiguous by
// design." In the Env. Management sample it reads `C.W.M` — a type marker. In
// the English Literature sample it reads `Zoo in my Luggage` — a topic, and
// exact matching fails on it: the seeded chapter is `A Zoo in My Luggage: A
// Novel in Advance (with Chap 1)`, not the same string at all.
//
// The spec's own recipe: "lowercase, strip leading articles, drop anything
// after a colon, compare token overlap against a threshold." Runs entirely
// off `normalise()` from routines/resolve.ts, so a Bengali chapter title
// tokenizes the same way a routine cell does — one normalisation rule in the
// project, not two.

import { normalise } from "@/lib/routines/resolve";

const LEADING_ARTICLES = ["a", "an", "the"];

const TYPE_MARKERS: Record<string, "CT" | "CWM"> = {
  cwm: "CWM",
  ct: "CT",
};

/** Token overlap as "how much of the shorter side is covered by the longer" —
 * the shape a truncated centre line has against a full chapter title. */
const MATCH_THRESHOLD = 0.6;

function stripLeadingArticle(tokens: string[]): string[] {
  if (tokens.length > 1 && LEADING_ARTICLES.includes(tokens[0])) {
    return tokens.slice(1);
  }
  return tokens;
}

function tokenize(text: string): string[] {
  const beforeColon = text.split(":")[0] ?? "";
  const tokens = normalise(beforeColon).split(" ").filter(Boolean);
  return stripLeadingArticle(tokens);
}

function overlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const shared = a.filter((t) => setB.has(t)).length;
  return shared / Math.min(a.length, b.length);
}

export type ChapterCandidate = { id: string; name: string };

export type CentreLineResult =
  | { kind: "chapter"; chapterId: string; score: number }
  | { kind: "type"; type: "CT" | "CWM" }
  | { kind: "topic"; text: string };

/**
 * §5.3's three outcomes, tried in the spec's own order: a chapter match wins
 * first — "test it against the seeded chapter list first" — a type marker is
 * checked only once no chapter clears the threshold, and anything else is
 * kept as free text rather than forced into a decision.
 */
export function matchCentreLine(
  text: string,
  chapters: ChapterCandidate[],
  threshold = MATCH_THRESHOLD,
): CentreLineResult {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "topic", text: trimmed };

  const lineTokens = tokenize(trimmed);

  let best: { chapterId: string; score: number } | null = null;
  for (const chapter of chapters) {
    const score = overlapScore(lineTokens, tokenize(chapter.name));
    if (score >= threshold && (!best || score > best.score)) {
      best = { chapterId: chapter.id, score };
    }
  }
  if (best) return { kind: "chapter", chapterId: best.chapterId, score: best.score };

  const markerKey = normalise(trimmed).replace(/\s+/g, "");
  const marker = TYPE_MARKERS[markerKey];
  if (marker) return { kind: "type", type: marker };

  return { kind: "topic", text: trimmed };
}
