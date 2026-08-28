// Runs §5.3's parser against every hand-authored fixture in
// fixtures/papers/*.expected.json and reports, per field, whether the
// parse matches the golden a human read directly off the physical paper.
// See fixtures/papers/README.md for the fixture format and for why a
// golden is never generated from the parser's own output.
//
//   npx tsx --env-file=.env.local scripts/check-paper-fixtures.ts
//
// Add --force-live to bypass the dev cache for every fixture in this run
// (e.g. after a prompt or schema change, to confirm the new prompt is what
// actually produced the numbers being reported, not a stale cache entry).
//
// Three fields are deliberately never scored - see the SKIPPED_FIELDS
// block below for why each one is excluded rather than just "currently
// failing."

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parsePaper } from "@/lib/scans/parse/client";
import type { RawHeader, RawMarkCandidate, RawPage, RawParse } from "@/lib/scans/parse/schema";
import { namesMatch } from "@/lib/scans/match";

const FIXTURES_DIR = path.join(process.cwd(), "fixtures", "papers");

type PaperFixture = {
  /** Filenames in fixtures/papers/, in upload order - same convention as parsePaper's own imagePaths. */
  images: string[];
  /** Exactly what was passed as seededChapterNames when this golden was authored - reproducibility, not part of the expected output. */
  seededChapterNames?: string[];
  /** Hand-written ground truth, read off the physical paper - shaped like RawParse, but never derived from a parser run. */
  expected: RawParse;
};

type FieldStatus = "pass" | "fail" | "skip";

type FieldResult = {
  path: string;
  status: FieldStatus;
  expected?: unknown;
  actual?: unknown;
  reason?: string;
};

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function scored(path: string, actual: unknown, expected: unknown): FieldResult {
  return { path, status: deepEqual(actual, expected) ? "pass" : "fail", expected, actual };
}

function skipped(path: string, reason: string): FieldResult {
  return { path, status: "skip", reason };
}

// ---------------------------------------------------------------------------
// Fields that are never scored, and why - each is a property of the field
// itself, not a temporary gap in the harness:
//
//   * inferred_chapter / inferred_from - both fixtures were run with a
//     single-member seededChapterNames, so the model had exactly one option
//     to return; a "pass" here would only confirm the enum had one entry,
//     not that inference works. Comes back once a real syllabus is seeded
//     and the enum has enough members to actually get wrong. inferred_from
//     is excluded for a second, permanent reason too: it is prose evidence
//     for a human to sanity-check (§5.3), never a value with one correct
//     wording - there is no golden string worth writing for it.
//   * confidence.* - "the model's self-reported confidence is uncalibrated
//     ... use it only to decide highlighting, never to decide a value"
//     (§5.3). Scoring it against a golden would treat it as exactly the
//     kind of value the spec says it isn't.
// ---------------------------------------------------------------------------

function compareHeader(actual: RawHeader, expected: RawHeader): FieldResult[] {
  const nameResult: FieldResult =
    actual.student_name === null || expected.student_name === null
      ? scored("header.student_name", actual.student_name, expected.student_name)
      : {
          path: "header.student_name",
          status: namesMatch(actual.student_name, expected.student_name) ? "pass" : "fail",
          expected: expected.student_name,
          actual: actual.student_name,
          reason: "compared via namesMatch (token-subset), not string equality - see lib/scans/match.ts",
        };

  return [
    nameResult,
    scored("header.class", actual.class, expected.class),
    scored("header.section", actual.section, expected.section),
    scored("header.subject_raw", actual.subject_raw, expected.subject_raw),
    scored("header.date_raw", actual.date_raw, expected.date_raw),
    scored("header.date", actual.date, expected.date),
    scored("header.total_marks_field", actual.total_marks_field, expected.total_marks_field),
    scored("header.obtained_marks_field", actual.obtained_marks_field, expected.obtained_marks_field),
    // Deliberately not special-cased even though it is expected to fail on
    // the Env. Management fixture - the golden records what is actually on
    // the paper (a struck-through blank), and the parse currently reads
    // that blank as empty rather than struck. That mismatch is real
    // parser behaviour worth tracking, not a fixture bug to paper over.
    scored(
      "header.obtained_field_struck_through",
      actual.obtained_field_struck_through,
      expected.obtained_field_struck_through,
    ),
  ];
}

function comparePages(actual: RawPage[], expected: RawPage[]): FieldResult[] {
  const results: FieldResult[] = [scored("pages.length", actual.length, expected.length)];
  const count = Math.max(actual.length, expected.length);
  for (let i = 0; i < count; i++) {
    const a = actual[i];
    const e = expected[i];
    if (!a || !e) {
      results.push({ path: `pages[${i}]`, status: "fail", actual: a ?? null, expected: e ?? null });
      continue;
    }
    results.push(
      scored(`pages[${i}].page`, a.page, e.page),
      scored(`pages[${i}].has_header`, a.has_header, e.has_header),
      scored(`pages[${i}].printed_question_text`, a.printed_question_text, e.printed_question_text),
      scored(`pages[${i}].header_subject_raw`, a.header_subject_raw, e.header_subject_raw),
      scored(`pages[${i}].header_date_raw`, a.header_date_raw, e.header_date_raw),
    );
  }
  return results;
}

function compareMarkCandidates(actual: RawMarkCandidate[], expected: RawMarkCandidate[]): FieldResult[] {
  const results: FieldResult[] = [
    scored("mark_candidates.length", actual.length, expected.length),
  ];
  const count = Math.max(actual.length, expected.length);
  for (let i = 0; i < count; i++) {
    const a = actual[i];
    const e = expected[i];
    if (!a || !e) {
      results.push({
        path: `mark_candidates[${i}]`,
        status: "fail",
        actual: a ?? null,
        expected: e ?? null,
      });
      continue;
    }
    results.push(
      scored(`mark_candidates[${i}].page`, a.page, e.page),
      scored(`mark_candidates[${i}].value_obtained`, a.value_obtained, e.value_obtained),
      scored(`mark_candidates[${i}].value_total`, a.value_total, e.value_total),
      scored(`mark_candidates[${i}].style`, a.style, e.style),
      scored(`mark_candidates[${i}].location`, a.location, e.location),
    );
  }
  return results;
}

function compareParse(actual: RawParse, expected: RawParse): FieldResult[] {
  return [
    ...comparePages(actual.pages, expected.pages),
    ...compareHeader(actual.header, expected.header),
    ...compareMarkCandidates(actual.mark_candidates, expected.mark_candidates),
    scored("body_type_hint", actual.body_type_hint, expected.body_type_hint),
    scored("topic_line", actual.topic_line, expected.topic_line),
    skipped("inferred_chapter", "single-member enum in both current fixtures - see SKIPPED_FIELDS comment"),
    skipped("inferred_from", "free-form evidence text, never an exact-match value - see SKIPPED_FIELDS comment"),
    skipped("confidence.subject", "uncalibrated per §5.3 - never scored as a value"),
    skipped("confidence.marks", "uncalibrated per §5.3 - never scored as a value"),
    skipped("confidence.chapter", "uncalibrated per §5.3 - never scored as a value"),
  ];
}

async function loadFixture(fileName: string): Promise<PaperFixture> {
  const raw = await readFile(path.join(FIXTURES_DIR, fileName), "utf8");
  return JSON.parse(raw) as PaperFixture;
}

async function main() {
  const forceLive = process.argv.includes("--force-live");

  let entries: string[];
  try {
    entries = await readdir(FIXTURES_DIR);
  } catch {
    console.error(`No fixtures/papers directory at ${FIXTURES_DIR} - see fixtures/papers/README.md.`);
    process.exit(1);
  }

  const goldenFiles = entries.filter((f) => f.endsWith(".expected.json")).sort();
  if (goldenFiles.length === 0) {
    console.error("No *.expected.json goldens found in fixtures/papers/.");
    process.exit(1);
  }

  let totalPass = 0;
  let totalFail = 0;
  let totalSkip = 0;

  for (const goldenFile of goldenFiles) {
    const fixtureName = goldenFile.replace(/\.expected\.json$/, "");
    const fixture = await loadFixture(goldenFile);
    const imagePaths = fixture.images.map((name) => path.join(FIXTURES_DIR, name));

    const actual = await parsePaper(imagePaths, {
      seededChapterNames: fixture.seededChapterNames,
      forceLive,
    });

    const results = compareParse(actual, fixture.expected);
    const pass = results.filter((r) => r.status === "pass").length;
    const fail = results.filter((r) => r.status === "fail");
    const skip = results.filter((r) => r.status === "skip").length;
    totalPass += pass;
    totalFail += fail.length;
    totalSkip += skip;

    console.log(`\n${fixtureName}: ${pass} pass, ${fail.length} fail, ${skip} skip`);
    for (const f of fail) {
      console.log(`  FAIL ${f.path}`);
      console.log(`       expected: ${JSON.stringify(f.expected)}`);
      console.log(`       actual:   ${JSON.stringify(f.actual)}`);
    }
  }

  console.log(`\nTotal: ${totalPass} pass, ${totalFail} fail, ${totalSkip} skip`);
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
