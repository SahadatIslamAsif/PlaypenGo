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
//
// Two more are scored but reported under "known limitation" rather than as
// an ordinary FAIL - see the KNOWN_LIMITATIONS block below. They still
// count toward the fail total and the exit code; the separate heading is
// only so a run's OUTPUT makes it obvious at a glance which failures are
// new (worth investigating) versus already-understood and tracked
// elsewhere (docs/SPEC.md §10, item 8).

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { loadLocalImages, parsePaper } from "@/lib/scans/parse/client";
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
  /** Set only for a scored field whose failure mode is already understood
   * and tracked - see the KNOWN_LIMITATIONS block. Absent for an ordinary
   * value comparison. */
  category?: "known_limitation";
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
// Fields that are scored - a mismatch is real and counts toward the exit
// code - but reported as a "known limitation" rather than an ordinary FAIL,
// because the failure mode itself is already understood, not something a
// mismatch here is telling us anything new about:
//
//   * header.student_name - namesMatch (lib/scans/match.ts) is token-subset
//     per §5.3 ("Use token-subset matching, not whole-string edit
//     distance"), which is correct for its real job: catching a genuinely
//     different name on a paper. It does not, and structurally cannot,
//     tolerate a spelling VARIANT within a token - "Hassan" and "Hasan"
//     are two different tokens, not a subset relationship, so a run that
//     transcribes the same handwriting differently each time will fail
//     here even though it found the right student. Loosening namesMatch
//     itself would weaken the real §5.3 warning this same function drives
//     for guardians/tutors reviewing a scan - not done. Tracked as
//     docs/SPEC.md §10 item 8.
//   * header.obtained_field_struck_through - the model currently reads a
//     struck-through "Obtained marks" digit as an empty blank rather than
//     as struck, on every run against the Env. Management fixture so far.
//     A prompt-iteration item once there are more papers to check against,
//     not a fixture bug - the golden records what is actually on the
//     paper, and is never edited to match the parse.
// ---------------------------------------------------------------------------

function knownLimitation(
  path: string,
  actual: unknown,
  expected: unknown,
  reason: string,
): FieldResult {
  return { ...scored(path, actual, expected), category: "known_limitation", reason };
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
          // knownLimitation() isn't used here on purpose - it compares via
          // scored()'s plain deepEqual, which is exactly the string-equality
          // bug this field must NOT have. namesMatch (token-subset) is the
          // actual comparison; category/reason are added by hand instead.
          path: "header.student_name",
          status: namesMatch(actual.student_name, expected.student_name) ? "pass" : "fail",
          expected: expected.student_name,
          actual: actual.student_name,
          category: "known_limitation",
          reason:
            "compared via namesMatch (token-subset, lib/scans/match.ts), not string equality - but a spelling variant within one token (e.g. Hassan/Hasan) still fails, since that's a different token, not a subset. See KNOWN_LIMITATIONS above.",
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
    knownLimitation(
      "header.obtained_field_struck_through",
      actual.obtained_field_struck_through,
      expected.obtained_field_struck_through,
      "the model currently reads a struck-through 'Obtained marks' digit as an empty blank rather than as struck. Golden records what's actually on the paper - never edited to match the parse. See KNOWN_LIMITATIONS above.",
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
  let totalNewFail = 0;
  let totalKnownFail = 0;
  let totalSkip = 0;

  for (const goldenFile of goldenFiles) {
    const fixtureName = goldenFile.replace(/\.expected\.json$/, "");
    const fixture = await loadFixture(goldenFile);
    const imagePaths = fixture.images.map((name) => path.join(FIXTURES_DIR, name));
    const images = await loadLocalImages(imagePaths);

    const actual = await parsePaper(images, {
      seededChapterNames: fixture.seededChapterNames,
      forceLive,
    });

    const results = compareParse(actual, fixture.expected);
    const pass = results.filter((r) => r.status === "pass").length;
    const fail = results.filter((r) => r.status === "fail");
    const skip = results.filter((r) => r.status === "skip").length;
    // Known-limitation fields still count toward pass/fail/exit code - the
    // split below is purely which heading a fail prints under, so a run's
    // NEW failures (worth investigating) aren't buried under ones already
    // tracked in KNOWN_LIMITATIONS / docs/SPEC.md §10 item 8.
    const newFail = fail.filter((f) => f.category !== "known_limitation");
    const knownFail = fail.filter((f) => f.category === "known_limitation");
    totalPass += pass;
    totalFail += fail.length;
    totalNewFail += newFail.length;
    totalKnownFail += knownFail.length;
    totalSkip += skip;

    console.log(
      `\n${fixtureName}: ${pass} pass, ${fail.length} fail (${newFail.length} new, ${knownFail.length} known limitation), ${skip} skip`,
    );
    for (const f of newFail) {
      console.log(`  FAIL ${f.path}`);
      console.log(`       expected: ${JSON.stringify(f.expected)}`);
      console.log(`       actual:   ${JSON.stringify(f.actual)}`);
    }
    for (const f of knownFail) {
      console.log(`  KNOWN LIMITATION ${f.path}`);
      console.log(`       ${f.reason}`);
      console.log(`       expected: ${JSON.stringify(f.expected)}`);
      console.log(`       actual:   ${JSON.stringify(f.actual)}`);
    }
  }

  console.log(
    `\nTotal: ${totalPass} pass, ${totalFail} fail (${totalNewFail} new, ${totalKnownFail} known limitation), ${totalSkip} skip`,
  );
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
