// The only place RawParse's wire shape (schema.ts, snake_case, §5.3's JSON
// exactly) gets translated into what the resolution layer (lib/scans/*.ts,
// camelCase) already expects. Each function's return type is annotated
// against the resolution layer's own exported type, so a rename on either
// side is a compile error here rather than a silent mismatch at runtime.

import type { ChapterCandidate } from "@/lib/scans/centre-line";
import type { HeaderMarks, MarkCandidate } from "@/lib/scans/ladder";
import type { PageInfo } from "@/lib/scans/grouping";
import { normalise, resolveSubject, type SubjectCandidate } from "@/lib/routines/resolve";
import type { RawParse } from "./schema";

export function toMarkCandidates(raw: RawParse): MarkCandidate[] {
  return raw.mark_candidates.map((c) => ({
    page: c.page,
    valueObtained: c.value_obtained,
    valueTotal: c.value_total,
    style: c.style,
    location: c.location,
  }));
}

export function toHeaderMarks(raw: RawParse): HeaderMarks {
  return {
    totalMarksField: raw.header.total_marks_field,
    obtainedMarksField: raw.header.obtained_marks_field,
    obtainedFieldStruckThrough: raw.header.obtained_field_struck_through,
  };
}

// ---------------------------------------------------------------------------
// toPageInfo — resolving each page's own header, not the call's one header
//
// grouping.ts's PageInfo carries subject/date PER PAGE because its CT guard
// (§5.3: "same subject + same date + consecutive -> same paper") needs to
// compare one header page against another - and that comparison is only
// meaningful if each page's identity was actually read off THAT page, not
// borrowed from the call's one authoritative `header` (which schema.ts's
// RawPage extension exists to avoid). `header_subject_raw`/`header_date_raw`
// are per page for exactly this reason: this mapper resolves each one
// independently, through the same `resolveSubject` the routine parser uses
// and a local DD/MM/YY parser, so a page that genuinely differs from the rest
// of the batch shows up as a genuine difference here - the guard can now
// DETECT a mixed batch, not just suppress a false positive on a repeated
// header.
export function toPageInfo(raw: RawParse, subjectCandidates: SubjectCandidate[]): PageInfo[] {
  return raw.pages.map((p) => ({
    pageNo: p.page,
    hasHeader: p.has_header,
    subject: p.header_subject_raw
      ? resolveSubject(p.header_subject_raw, subjectCandidates).subjectId
      : null,
    date: parseDdMmYy(p.header_date_raw),
  }));
}

/**
 * DD/MM/YY -> ISO 8601, the same convention §5.3 uses for the authoritative
 * header's date_raw/date pair - computed here rather than asked of the model
 * a second time, since `header_date_raw` is deliberately raw-text-only (see
 * schema.ts's comment on why the per-page extension stays narrow). Two-digit
 * years read as 20YY; there's no Playpen paper old enough to need
 * disambiguating against 19YY. Anything that isn't a clean DD/MM/YY, or names
 * a calendar date that doesn't exist (31/04/26), returns null - "unreadable
 * is the same as blank" (§5.3) applies here exactly as it does to the marks.
 */
function parseDdMmYy(raw: string | null): string | null {
  if (!raw) return null;

  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(raw.trim());
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = 2000 + Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// The centre line, reunited
//
// §5.3 talks about ONE "centre line" with three possible outcomes (chapter /
// type marker / free topic), but the wire schema splits it into two nullable
// fields: `body_type_hint` (the model's own CT/CWM read, which may be
// informed by a marker on the centre line) and `topic_line` (the centre
// line's text when it wasn't a marker). matchCentreLine (centre-line.ts)
// takes one string and does its own marker/chapter/topic classification, so
// whichever of the two actually holds text is "the centre line" as far as
// that function is concerned - topic_line first, since a populated topic_line
// means the centre line was genuinely free text; body_type_hint is what's
// left when it wasn't.
export function toCentreLineText(raw: RawParse): string {
  return raw.topic_line ?? raw.body_type_hint ?? "";
}

// ---------------------------------------------------------------------------
// inferred_chapter -> a seeded chapter's id
//
// The schema constrains inferred_chapter to the seeded chapter names' exact
// text (buildPaperParseSchema's enum), so this should always be a literal
// match. Falling through to normalise() equality is a safety net for enum
// support being a request rather than a guarantee (schema.ts's own caveat) -
// never a second matching strategy on top of the model's inference. A name
// that matches nothing in the list (enum honoured or not) resolves to null,
// same as no inference at all - §5.3 never auto-selects below a threshold,
// and a chapter this function can't place is exactly that case.
export function resolveInferredChapterId(
  raw: RawParse,
  seededChapters: ChapterCandidate[],
): string | null {
  if (!raw.inferred_chapter) return null;

  const exact = seededChapters.find((c) => c.name === raw.inferred_chapter);
  if (exact) return exact.id;

  const normalised = normalise(raw.inferred_chapter);
  const fuzzy = seededChapters.find((c) => normalise(c.name) === normalised);
  return fuzzy?.id ?? null;
}
