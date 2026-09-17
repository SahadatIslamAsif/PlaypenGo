// §5.2's syllabus PDF parse: the wire shape, verbatim. Field names are
// snake_case exactly as the spec's own JSON block writes them
// (ARCHITECTURE.md §5.2, "Syllabus PDF parse" response schema) - this file
// does not rename anything for JS convention, same posture as
// lib/scans/parse/schema.ts.
//
// One call, one document, no per-call parameterization - unlike the paper
// parse's seededChapterNames, nothing here varies call to call, so the
// schema is a plain constant rather than a builder function.

export type RawSyllabusPaper = {
  name: string;
  chapters: string[];
};

export type RawSyllabusSubject = {
  name: string;
  // A subject either splits into papers (chapters left empty) or reports
  // chapters directly (papers left empty) - §5.2's own example does both in
  // one document, one subject each way. commit_syllabus_tree processes
  // both arrays unconditionally, so nothing here enforces the split.
  papers: RawSyllabusPaper[];
  chapters: string[];
};

export type RawSyllabus = {
  // Informational only - session_label for commit_syllabus_tree comes from
  // the student's own profile (ARCHITECTURE.md §3.2), never from parsed
  // text, since it scopes what a re-import can and can't touch (0029).
  class_level: string | null;
  session: string | null;
  semester: string | null;
  subjects: RawSyllabusSubject[];
};

// ---------------------------------------------------------------------------
// Compile-time drift assertion - same guarantee as
// lib/scans/parse/schema.ts's REQUIRED_TOP_LEVEL_KEYS.

const REQUIRED_TOP_LEVEL_KEYS = [
  "class_level",
  "session",
  "semester",
  "subjects",
] as const satisfies readonly (keyof RawSyllabus)[];

type MissingFromRequiredList = Exclude<keyof RawSyllabus, (typeof REQUIRED_TOP_LEVEL_KEYS)[number]>;

type AssertNoKeyIsMissing = MissingFromRequiredList extends never
  ? true
  : ["RawSyllabus key missing from REQUIRED_TOP_LEVEL_KEYS:", MissingFromRequiredList];

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the point of
// this line is that it fails to compile, not that anything reads it.
const _assertNoKeyIsMissing: AssertNoKeyIsMissing = true;

// ---------------------------------------------------------------------------
// The schema object itself - a minimal, local JSON-Schema-shaped type, same
// as lib/scans/parse/schema.ts and for the same reason: this file defines
// the schema's CONTENT; client.ts verifies the exact wire format against
// the installed @google/genai SDK.

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

const STRING = (opts: { nullable?: boolean; description?: string } = {}): GeminiSchema => ({
  type: "STRING",
  ...opts,
});

const rawSyllabusPaperSchema: GeminiSchema = {
  type: "OBJECT",
  properties: {
    name: STRING({ description: 'The paper name exactly as printed, e.g. "Math D" or "Paper 1".' }),
    chapters: { type: "ARRAY", items: STRING() },
  },
  required: ["name", "chapters"],
};

const rawSyllabusSubjectSchema: GeminiSchema = {
  type: "OBJECT",
  properties: {
    name: STRING({ description: "The subject name exactly as printed in the document." }),
    papers: { type: "ARRAY", items: rawSyllabusPaperSchema },
    chapters: { type: "ARRAY", items: STRING() },
  },
  required: ["name", "papers", "chapters"],
};

export const SYLLABUS_PARSE_SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    class_level: STRING({ nullable: true }),
    session: STRING({ nullable: true }),
    semester: STRING({ nullable: true }),
    subjects: { type: "ARRAY", items: rawSyllabusSubjectSchema },
  },
  required: [...REQUIRED_TOP_LEVEL_KEYS],
};
