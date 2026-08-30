// §5.3's exam-paper parse: the wire shape, verbatim. Field names are
// snake_case exactly as the spec's own JSON block writes them (ARCHITECTURE.md §5.3,
// "Response schema") - this file does not rename anything for JS convention.
// `lib/scans/parse/adapt.ts` is the only place that translates these into the
// camelCase types the resolution layer (`lib/scans/*.ts`) already expects.
//
// Two additions beyond the spec's literal block, both narrow and both
// mirrored in docs/ARCHITECTURE.md §5.3 so the JSON there stays the thing the next
// session can actually read off:
//
//   * `inferred_chapter` is constrained to an enum of the student's seeded
//     chapter names for the matched subject, built per call by
//     `buildPaperParseSchema()`. §5.3: "Pass the student's seeded chapters for
//     that subject and require the model to return one of them or null."
//     Free-form inference would hand `matchCentreLine` a near-miss it wasn't
//     built to bridge - that function resolves the *centre line*, where the
//     student wrote a real chapter title, not a model's paraphrase of one.
//   * `pages[]` carries `header_subject_raw`/`header_date_raw` - not a full
//     second `RawHeader` per page, just the two fields
//     `lib/scans/grouping.ts`'s CT repeated-header guard actually compares.
//     §5.3 originally gave the whole call exactly one `header`, which meant
//     the guard could only ever apply that one header to every page and so
//     could suppress a false split but never detect a genuinely mixed batch.
//     Duplicating all eight header fields per page would have created a
//     second candidate for everything the ladder and the review screen
//     already read from the one authoritative `header` below; these two
//     fields are the minimum that makes the guard able to compare pages
//     against each other rather than against itself.

export type RawPage = {
  page: number;
  has_header: boolean;
  printed_question_text: boolean;
  // Extends §5.3's literal block by exactly what grouping.ts's CT
  // repeated-header guard consumes and nothing else - not a second
  // `RawHeader` per page. Duplicating all eight header fields per page would
  // create a second candidate for every field the ladder and the review
  // screen already read from the one authoritative `header` below; subject
  // and date are the only two fields analyzeGrouping actually compares. Null
  // on any page without a header of its own.
  header_subject_raw: string | null;
  header_date_raw: string | null;
};

export type RawHeader = {
  // Every header field is nullable: "unreadable is the same as blank" (§5.3)
  // applies to the whole form-field read, not just the marks. A struck or
  // smudged cell returns null rather than a guess.
  student_name: string | null;
  class: string | null;
  section: string | null;
  subject_raw: string | null;
  date_raw: string | null;
  date: string | null;
  total_marks_field: number | null;
  obtained_marks_field: number | null;
  // Not nullable - "struck through" is a yes/no observation about one field,
  // defaulting to false when there is nothing to strike through in the first
  // place (no obtained_marks_field at all, or an ellipse made the field
  // moot). Scoped to this one field only - §5.3: "A general strike-through
  // report would void good data." There is deliberately no
  // total_marks_field_struck_through or a body-wide strike flag anywhere in
  // this schema.
  obtained_field_struck_through: boolean;
};

export type RawMarkCandidate = {
  page: number;
  // A mark candidate is a numeral - "Ticks, check marks, crosses, question
  // numbers, and the teacher's dated remark... are not mark candidates and
  // must be excluded" (§5.3). If there's no numeral, it isn't a candidate at
  // all, so value_obtained itself is never null; only its denominator can be.
  value_obtained: number;
  // "Only page 1 carries the total." A later-page ellipse (the Env.
  // Management sample's page-2 `6`) can report a bare numerator.
  value_total: number | null;
  // Constrained by buildPaperParseSchema's enum to exactly one of "ellipse" |
  // "boxed" | "underlined" | "plain" - not free text. "ellipse" is the value
  // the ladder (lib/scans/ladder.ts) acts on; the ladder also tolerates
  // "circle"/"circled"/"oval" as synonyms (belt and braces against an enum
  // the model ignores), but the schema itself should never let those through.
  style: string;
  location: string;
};

export type RawConfidence = {
  subject: number;
  marks: number;
  chapter: number;
};

export type RawParse = {
  pages: RawPage[];
  header: RawHeader;
  mark_candidates: RawMarkCandidate[];
  // "Printed question text on the page -> CT. Playpen letterhead... -> CWM."
  // The model's own type read, informed by (but not limited to) a type
  // marker on the centre line. Distinct from topic_line - see the note on
  // centreLineText in adapt.ts for how the two get reunited into "the centre
  // line" §5.3 actually talks about.
  body_type_hint: string | null;
  // The centre line's text when it names neither a chapter nor a type marker
  // - §5.3's third outcome, "keep it as free-text topic_line... do not force
  // a decision."
  topic_line: string | null;
  // One of the seeded chapter names for the matched subject, verbatim, or
  // null. Constrained by the schema's enum (see buildPaperParseSchema),
  // re-checked at runtime in adapt.ts because enum support is a request, not
  // a guarantee.
  inferred_chapter: string | null;
  // The evidence string a human reads to sanity-check inferred_chapter -
  // "always show the evidence string in the review modal." Null exactly when
  // inferred_chapter is null; there is nothing to justify.
  inferred_from: string | null;
  confidence: RawConfidence;
};

// ---------------------------------------------------------------------------
// Compile-time drift assertion
//
// If a key is ever added to (or removed from) RawParse without updating this
// list, the assignment below fails to typecheck - Exclude<> resolves to a
// tuple naming the missing key(s) instead of `never`, and that tuple cannot
// be assigned to a `true`-typed variable. This is the "schema drift is a
// compile error" guarantee from the brief: it holds for the top-level shape
// tracked here. It does not, and cannot, catch a field that changed type
// without changing its key - RawHeader/RawMarkCandidate/RawConfidence rely on
// ordinary structural typing for that instead.

const REQUIRED_TOP_LEVEL_KEYS = [
  "pages",
  "header",
  "mark_candidates",
  "body_type_hint",
  "topic_line",
  "inferred_chapter",
  "inferred_from",
  "confidence",
] as const satisfies readonly (keyof RawParse)[];

type MissingFromRequiredList = Exclude<keyof RawParse, (typeof REQUIRED_TOP_LEVEL_KEYS)[number]>;

type AssertNoKeyIsMissing = MissingFromRequiredList extends never
  ? true
  : ["RawParse key missing from REQUIRED_TOP_LEVEL_KEYS:", MissingFromRequiredList];

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the point of
// this line is that it fails to compile, not that anything reads it.
const _assertNoKeyIsMissing: AssertNoKeyIsMissing = true;

// ---------------------------------------------------------------------------
// The schema object itself
//
// A minimal, local JSON-Schema-shaped type - not imported from @google/genai,
// which is not installed until Part 2. This file defines the schema's
// CONTENT (which fields exist, which are required, which are enum-
// constrained); Part 2 verifies the exact wire format (property names like
// `type`/`nullable`/`enum`, and the SDK's own Type/Schema types) against the
// installed package before this is ever passed to a real call, per CLAUDE.md
// "Verify the exact current model ID at build time - IDs churn" and the same
// caution applied to the SDK's own surface.

type GeminiSchemaType = "OBJECT" | "ARRAY" | "STRING" | "NUMBER" | "INTEGER" | "BOOLEAN";

export type GeminiSchema = {
  type: GeminiSchemaType;
  description?: string;
  nullable?: boolean;
  enum?: string[];
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  items?: GeminiSchema;
};

const STRING = (opts: { nullable?: boolean; enum?: string[]; description?: string } = {}): GeminiSchema => ({
  type: "STRING",
  ...opts,
});

const NUMBER = (opts: { nullable?: boolean; description?: string } = {}): GeminiSchema => ({
  type: "NUMBER",
  ...opts,
});

const BOOLEAN = (opts: { description?: string } = {}): GeminiSchema => ({
  type: "BOOLEAN",
  ...opts,
});

const rawPageSchema: GeminiSchema = {
  type: "OBJECT",
  properties: {
    page: NUMBER({ description: "1-indexed, matching upload order." }),
    has_header: BOOLEAN(),
    printed_question_text: BOOLEAN({
      description: "True if this page shows typeset question text (a CT). False for handwriting-only ruled lines (a CWM khata).",
    }),
    header_subject_raw: STRING({
      nullable: true,
      description: "This page's own subject field, as written on it. Null on a page with no header.",
    }),
    header_date_raw: STRING({
      nullable: true,
      description: "This page's own date field, DD/MM/YY as written on it. Null on a page with no header.",
    }),
  },
  required: ["page", "has_header", "printed_question_text", "header_subject_raw", "header_date_raw"],
};

const rawHeaderSchema: GeminiSchema = {
  type: "OBJECT",
  properties: {
    student_name: STRING({ nullable: true }),
    class: STRING({ nullable: true }),
    section: STRING({ nullable: true }),
    subject_raw: STRING({ nullable: true }),
    date_raw: STRING({ nullable: true, description: "As printed/written, DD/MM/YY." }),
    date: STRING({ nullable: true, description: "ISO 8601, derived from date_raw." }),
    total_marks_field: NUMBER({ nullable: true }),
    obtained_marks_field: NUMBER({ nullable: true }),
    obtained_field_struck_through: BOOLEAN(),
  },
  required: [
    "student_name",
    "class",
    "section",
    "subject_raw",
    "date_raw",
    "date",
    "total_marks_field",
    "obtained_marks_field",
    "obtained_field_struck_through",
  ],
};

const rawMarkCandidateSchema: GeminiSchema = {
  type: "OBJECT",
  properties: {
    page: NUMBER(),
    value_obtained: NUMBER(),
    value_total: NUMBER({ nullable: true }),
    style: STRING({
      enum: ["ellipse", "boxed", "underlined", "plain"],
      description:
        '"ellipse" for any circled or ovaled mark - a diagonal-slash fraction written inside an oval is still "ellipse", the slash is how the fraction is written, not a different style. "boxed" for a square/rectangle enclosure, "underlined" for a line under the numeral with no enclosure, "plain" for a bare numeral with neither. Exactly one of these four - this exact string is load-bearing downstream.',
    }),
    location: STRING(),
  },
  required: ["page", "value_obtained", "value_total", "style", "location"],
};

const rawConfidenceSchema: GeminiSchema = {
  type: "OBJECT",
  properties: {
    subject: NUMBER(),
    marks: NUMBER(),
    chapter: NUMBER(),
  },
  required: ["subject", "marks", "chapter"],
};

/**
 * `seededChapterNames` scopes `inferred_chapter`'s enum to one subject's
 * chapters - the caller has already resolved which subject this paper is for
 * (from the routine, or from `subject_raw` once matched) before requesting a
 * parse. An empty list means no seeded chapters exist yet for that subject;
 * the field is still nullable, so the model can still return null.
 */
export function buildPaperParseSchema(seededChapterNames: string[]): GeminiSchema {
  return {
    type: "OBJECT",
    properties: {
      pages: { type: "ARRAY", items: rawPageSchema },
      header: rawHeaderSchema,
      mark_candidates: { type: "ARRAY", items: rawMarkCandidateSchema },
      body_type_hint: STRING({ nullable: true }),
      topic_line: STRING({ nullable: true }),
      inferred_chapter: STRING({
        nullable: true,
        enum: seededChapterNames.length > 0 ? seededChapterNames : undefined,
        description: "One of the seeded chapter names, verbatim, or null. Never a paraphrase.",
      }),
      inferred_from: STRING({ nullable: true }),
      confidence: rawConfidenceSchema,
    },
    required: [...REQUIRED_TOP_LEVEL_KEYS],
  };
}
