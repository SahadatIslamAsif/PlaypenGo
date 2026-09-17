// §5.1's routine parse prompt. States only what the model SEES and the six
// rules ARCHITECTURE.md §5.1 spells out explicitly, because "a naive read of
// a printed routine gets every one of these wrong at least once." It says
// nothing about how a cell's text becomes a subject id, how near-duplicate
// teacher spellings get flagged, or how the syllabus cross-check works -
// those are lib/routines/resolve.ts, lib/routines/resolve.ts's
// groupTeacherNames(), and lib/routines/crosscheck.ts respectively, already
// built in Phase 3 and reused as-is by adapt.ts. Report every cell exactly as
// written; decide nothing beyond that.

export const ROUTINE_PARSE_PROMPT = `You are reading a photo of a printed weekly class routine (timetable) from a school in Bangladesh. The week runs Sunday through Thursday - Friday and Saturday are the weekend and never appear on this routine, whatever else the photo shows.

The grid has one row per period and one column per day. Read every period, top to bottom, and every day, left to right. For EVERY cell in the grid - every period number crossed with every day the routine shows - report one entry in periods[], including a cell that is genuinely blank (raw_text "").

For each cell report:
- day: SUN, MON, TUE, WED, or THU.
- period_no: the period's number, 1-indexed top to bottom, as printed on the routine (not the array index).
- start / end: that period's start and end time, 24-hour "HH:MM". A routine usually prints its bell schedule once, not once per day - if you can only see the times for a period once (e.g. printed beside period 1, or in a header row), apply that same start/end to every day's entry for that period_no.
- raw_text: exactly what identifies the SUBJECT in this cell - the literal short form the school uses ("Env Mgt", "B.St", "Add Math"), not the subject's full name and not a corrected spelling. If a cell has a subject line and a teacher's name below it (rule 3), raw_text is the subject line ONLY - never append, prefix, or merge the teacher's name into it. This exact string is used to grow the app's own dictionary of short forms, so transcribe it verbatim and keep it free of anything that isn't the subject label, never "clean it up" the other direction either.
- teacher: a teacher's name, if one is written in the cell (rule 3 below), reported ONLY here - never duplicated into raw_text. Transcribe exactly as spelled on that cell - if the same teacher's name is spelled two different ways on two different days, report each spelling exactly as written on its own day rather than picking one. Null if no name is present.
- is_academic: true for an ordinary lesson period, false for a break or a named non-academic period (rules 1-2 below).
- matched_subject: your best match of this cell to one of the subject names listed below, copied verbatim - or null if you cannot confidently place it, if the cell is a break/non-academic period, or if no subject list was given. Never invent a subject name that isn't in the list, and never guess.
- confidence: your own rough sense, 0 to 1, of how sure you are about this cell as a whole.

Six things about how a Playpen-style routine is actually laid out, each of which a naive read gets wrong at least once:

1. A break is very often spelled vertically, one letter per day, down a single column - for example B, R, E, A, K reading Sunday through Thursday in the same period column. If a whole column's cells are each a single letter, or the cells concatenate into a recognizable word reading down the days, that whole column is a break: set is_academic false and raw_text to exactly the single letter or word printed in that cell, not the word you inferred the column spells. Look at the whole photo before deciding any one cell, since this pattern is only visible across the full column, not from a single cell in isolation. A break also almost always sits at the same period, at the same time, on every day it appears - if a column's start/end time is identical across the days and its cells don't look like an ordinary subject (short, non-alphabetic, or inconsistent with the rest of that day's subjects), treat that as a supporting clue toward reading it as a break, alongside the letter/word pattern rather than instead of it.

2. A named non-academic period - assembly, games, library, prayer, tiffin/lunch, E.C.A., a club - is also is_academic: false, the same as a break. teacher and matched_subject are null for these.

3. A teacher's name typically sits below the subject name within the same cell. Capture it in teacher; it is useful context, not noise to discard.

4. Do not try to normalise or deduplicate teacher name spellings yourself, even if you notice the same teacher apparently spelled two ways across different days. Report each cell's teacher exactly as written on that cell. Flagging near-duplicates is handled downstream, from your verbatim transcriptions.

5. A subject that splits into two papers (for example a subject with both a standard and an additional/advanced version) is never distinguished on the routine itself - both papers are taught in the same periods by the same teacher. Match the cell to the one subject; do not try to guess which paper.

6. The week is Sunday through Thursday only, five columns. Never report a Friday or Saturday entry.

If you cannot read a cell's text clearly at all, report your best-effort raw_text anyway (never leave it empty unless the cell truly is blank) and set matched_subject to null and confidence low, rather than inventing a plausible-looking subject.`;

/**
 * The thin appender §5.1's own schema note asks for: "The model is given the
 * student's already-known subject list and required to map every cell to one
 * of them, or return null rather than guess." Kept separate from the base
 * prompt for the same reason lib/scans/parse/prompt.ts splits its own
 * chapter appendix out - only this function's few lines change when the
 * subject list changes shape.
 */
export function buildRoutineParsePrompt(subjectNames: string[]): string {
  if (subjectNames.length === 0) {
    return `${ROUTINE_PARSE_PROMPT}

No subjects have been seeded for this student yet. Set matched_subject to null for every cell.`;
  }

  const list = subjectNames.map((name) => `- ${name}`).join("\n");

  return `${ROUTINE_PARSE_PROMPT}

This student's known subjects are:
${list}

For every academic cell, set matched_subject to one of these exact strings, copied verbatim, or null if you cannot confidently place it. Never paraphrase or shorten a name from this list, and never return a subject name that isn't in it.`;
}
