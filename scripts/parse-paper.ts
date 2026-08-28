// Runs §5.3's Gemini parse against 1-5 local images and prints the raw
// RawParse JSON to stdout. Nothing is saved anywhere by this script - see
// fixtures/papers/README.md for why golden .expected.json files are hand-
// written, never generated from a parser's own output.
//
//   npx tsx --env-file=.env.local scripts/parse-paper.ts <img> [img...]
//
// Add --force-live to bypass the dev cache and make a real call even if a
// cached result exists for these exact images and the current prompt.
//
// Add --chapters=<name>,<name>,... to pass real seeded chapter names for
// inferred_chapter's enum, the same way a real caller would (the subject's
// seeded chapters, from the student's tree). Omitted, this stays [] - which
// is not "no chapter was inferred", it's "no chapters were ever offered";
// inferred_chapter can only be null in that case and that null is a script
// artifact, not a finding about the parse.

import { parsePaper } from "@/lib/scans/parse/client";

function parseChaptersArg(args: string[]): string[] {
  const prefix = "--chapters=";
  const arg = args.find((a) => a.startsWith(prefix));
  if (!arg) return [];
  return arg
    .slice(prefix.length)
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

async function main() {
  const args = process.argv.slice(2);
  const forceLive = args.includes("--force-live");
  const seededChapterNames = parseChaptersArg(args);
  const imagePaths = args.filter((a) => a !== "--force-live" && !a.startsWith("--chapters="));

  if (imagePaths.length === 0) {
    console.error(
      "Usage: npx tsx --env-file=.env.local scripts/parse-paper.ts <img> [img...] [--force-live] [--chapters=<name>,<name>,...]",
    );
    process.exit(1);
  }

  const result = await parsePaper(imagePaths, { forceLive, seededChapterNames });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
