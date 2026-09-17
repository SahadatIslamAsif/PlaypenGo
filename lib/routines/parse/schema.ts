// §5.1's routine parse: the wire shape, verbatim. Field names are snake_case
// exactly as the spec's own JSON block writes them (ARCHITECTURE.md §5.1,
// "Response schema") - this file does not rename anything for JS convention.
// `lib/routines/parse/adapt.ts` is the only place that translates these into
// the RoutineGrid shape the editor (lib/routines/grid.ts) already expects.
//
// One addition beyond the spec's literal block, mirrored in ARCHITECTURE.md
// §5.1 the same way lib/scans/parse/schema.ts documents its own two:
//
//   * `matched_subject` is constrained to an enum of the student's own
//     student_subjects.display_name values, built per call by
//     buildRoutineParseSchema() - "The model is given the student's
//     already-known subject list and required to map every cell to one of
//     them, or return null rather than guess." It is deliberately NOT the
//     thing adapt.ts trusts first: lib/routines/resolve.ts is where cell
//     resolution actually lives ("A human typing 'Phy' and Gemini reading
//     'Phy' off a photograph must resolve to the same subject, so the
//     resolution lives here, once"), so adapt.ts runs raw_text through
//     resolveSubject() the same way a typed cell would be, and falls back to
//     matched_subject only when that comes up empty - the model's visual
//     read catching something a plain string match couldn't. This is the
//     same posture lib/scans/parse/adapt.ts already takes toward its own
//     header_subject_raw, resolved through the identical resolveSubject()
//     rather than trusted as a second, competing match.

export type RawRoutinePeriod = {
  // §5.1 rule 6: Sunday through Thursday only. Friday and Saturday never
  // appear on a Playpen routine and are not valid values here.
  day: "SUN" | "MON" | "TUE" | "WED" | "THU";
  period_no: number;
  // "HH:MM", 24-hour. A routine's own bell schedule is usually printed once,
  // not per day - the prompt asks the model to apply one period's time to
  // every day's cell for that period_no, which is also how grid.ts stores it
  // (times live on the column, not the cell).
  start: string;
  end: string;
  // Exactly what's written in the cell, verbatim - never expanded,
  // corrected, or normalised. This is the string subject_aliases grows from
  // (§5.1's post-parse rule), so a "corrected" raw_text would poison that
  // dictionary with a value nobody actually wrote. "" for a cell the routine
  // genuinely leaves blank.
  raw_text: string;
  // §5.1 rule 3: "typically sits below the subject... capture it as useful
  // context." Verbatim, not deduplicated - lib/routines/resolve.ts's
  // groupTeacherNames() is what flags near-duplicate spellings for review
  // (rule 4); the model's job here is transcription, not normalisation.
  teacher: string | null;
  // One of the student's own subject display_name values, verbatim, or null.
  // Constrained by the schema's enum (see buildRoutineParseSchema),
  // re-checked at runtime in adapt.ts because enum support is a request, not
  // a guarantee - the same caveat schema.ts's scan-pipeline sibling states
  // for inferred_chapter.
  matched_subject: string | null;
  // §5.1 rules 1-2: false for a break (including the vertical-word trick,
  // which only the model can see across all five day-cells of a column) or
  // a named non-academic period (assembly, games, library, ...).
  is_academic: boolean;
  // The model's own rough sense of confidence, uncalibrated - not consumed
  // by adapt.ts for any resolution decision, same posture §5.3 takes toward
  // its own per-field confidence ("uncalibrated... use it only to decide
  // highlighting, never to decide a value").
  confidence: number;
};

export type RawRoutineParse = {
  class_level: string | null;
  section: string | null;
  class_teacher: string | null;
  periods: RawRoutinePeriod[];
};

// ---------------------------------------------------------------------------
// Compile-time drift assertion - same mechanism as lib/scans/parse/schema.ts.

const REQUIRED_TOP_LEVEL_KEYS = [
  "class_level",
  "section",
  "class_teacher",
  "periods",
] as const satisfies readonly (keyof RawRoutineParse)[];

type MissingFromRequiredList = Exclude<
  keyof RawRoutineParse,
  (typeof REQUIRED_TOP_LEVEL_KEYS)[number]
>;

type AssertNoKeyIsMissing = MissingFromRequiredList extends never
  ? true
  : ["RawRoutineParse key missing from REQUIRED_TOP_LEVEL_KEYS:", MissingFromRequiredList];

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the point of
// this line is that it fails to compile, not that anything reads it.
const _assertNoKeyIsMissing: AssertNoKeyIsMissing = true;

// ---------------------------------------------------------------------------
// The schema object itself - a minimal, local JSON-Schema-shaped type, kept
// free of @google/genai for the same reason lib/scans/parse/schema.ts states:
// this file defines the schema's CONTENT, lib/routines/parse/client.ts
// verifies the exact wire format against the installed SDK.

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

function buildPeriodSchema(subjectNames: string[]): GeminiSchema {
  return {
    type: "OBJECT",
    properties: {
      day: STRING({ enum: ["SUN", "MON", "TUE", "WED", "THU"] }),
      period_no: NUMBER({ description: "1-indexed, top to bottom as printed." }),
      start: STRING({ description: '24-hour "HH:MM".' }),
      end: STRING({ description: '24-hour "HH:MM".' }),
      raw_text: STRING({
        description: "Exactly what is written in the cell. Empty string for a genuinely blank cell.",
      }),
      teacher: STRING({ nullable: true }),
      matched_subject: STRING({
        nullable: true,
        enum: subjectNames.length > 0 ? subjectNames : undefined,
        description: "One of the given subject names, verbatim, or null. Never a paraphrase, never a guess.",
      }),
      is_academic: BOOLEAN(),
      confidence: NUMBER(),
    },
    required: [
      "day",
      "period_no",
      "start",
      "end",
      "raw_text",
      "teacher",
      "matched_subject",
      "is_academic",
      "confidence",
    ],
  };
}

/**
 * `subjectNames` scopes `matched_subject`'s enum to this student's own
 * student_subjects.display_name values. An empty list means the student has
 * no subjects seeded yet; the field is still nullable, so the model can
 * still return null for every cell.
 */
export function buildRoutineParseSchema(subjectNames: string[]): GeminiSchema {
  return {
    type: "OBJECT",
    properties: {
      class_level: STRING({ nullable: true }),
      section: STRING({ nullable: true }),
      class_teacher: STRING({ nullable: true }),
      periods: { type: "ARRAY", items: buildPeriodSchema(subjectNames) },
    },
    required: [...REQUIRED_TOP_LEVEL_KEYS],
  };
}
