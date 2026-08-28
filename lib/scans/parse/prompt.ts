// §5.3's exam-paper parse prompt. States only what the model SEES - the two
// paper formats, the ellipse, what is and isn't a mark candidate, date
// format, and the page-1-only total. It says nothing about the ellipse
// ladder's resolution order, page grouping, or attach rules: those are
// lib/scans/'s job, and describing them here would just invite the model to
// pre-empt a decision that belongs downstream. Report every observation it
// makes; decide nothing beyond that.
//
// This is the thing you'll edit repeatedly, which is why it's a plain
// exported string constant and not inlined into the call site.

export const PAPER_PARSE_PROMPT = `You are reading a scanned school assessment paper, submitted as 1-5 images of ONE paper, in page order. Every page belongs to the same assessment - do not treat this as more than one paper.

There are two paper formats. Identify which one you're looking at:

- CWM: a khata (exercise book) page on Playpen School letterhead, with ruled lines. Everything on it is handwritten. It has a fixed printed header template:

    [PLAYPEN logo]        Date: ______
    Name: ______  Class: ___  Sec: ______  Subject: ____________
    Total marks: ______   Obtained marks: ______

  Read the header as form fields, not open-ended text.

- CT: a printed question paper with its own printed header. The question text itself is typeset, not handwritten. Set printed_question_text true for any page whose question text is typeset.

Only page 1 (or whichever page carries the header) has header fields - report student_name, class, section, subject_raw, date_raw, date, total_marks_field, and obtained_marks_field from it. Dates are written DD/MM/YY; report the raw text as date_raw and your best ISO 8601 reading as date. If a header field is smudged, crossed out illegibly, or simply not there, return null for it rather than guessing - never invent a value.

Separately, for EVERY page that has its own header (a CT question paper sometimes prints its header on more than one page), report that page's own subject and date exactly as written on it: header_subject_raw and header_date_raw (same DD/MM/YY convention, raw text only - no separate ISO field for these two). This is per page, independent of the one authoritative header above. A page with no header of its own reports null for both.

obtained_field_struck_through: true only if the "Obtained marks" blank specifically has a line drawn through it. This is scoped to that one field alone - do not report strike-through anywhere else on the page. Corrections, crossed-out working, or struck words elsewhere in the body are normal and not something you need to flag.

The mark: teachers often circle or oval ("ellipse") the score directly on the page, written as a diagonal fraction - the obtained mark above the slash, the total below. Report every such mark as a mark_candidate: page number, value_obtained, value_total (or null if there's no visible denominator), style, and location (a short phrase like "mid-page right" or "bottom margin"). style must be exactly one of these four words:

- "ellipse" - the mark is circled or ovaled. A diagonal-slash fraction written INSIDE an oval is still "ellipse" - the slash is how the fraction itself is written, not a different style of mark. Only call it something else if there is no enclosing oval/circle at all.
- "boxed" - enclosed in a square or rectangle instead of an oval.
- "underlined" - a line drawn under the numeral, no enclosure.
- "plain" - a bare numeral, no enclosure and no underline.

Only page 1 can carry a full mark (obtained and total together). A mark on a later page is a per-section score and very often has no visible total at all - report it exactly as you see it, with value_total null if there isn't one. Do not add section marks together or invent a total for them.

A mark candidate is a numeral that represents a score - typically circled, ovaled, or written as a fraction. Ticks, check marks, crosses, question numbers, and a teacher's dated remark (e.g. "Well done! 17/8/26") are NOT mark candidates. Do not report them.

The centre line under the header (if there is text there) may read as a topic ("A Zoo in My Luggage"), a type marker ("C.W.M" or "C.T"), or nothing distinctive. Report your best read of the overall paper type (CT or CWM) as body_type_hint, and if the centre line has free text that is not itself a type marker, report it verbatim as topic_line. If there's nothing there, both can be null.

For each of the fields above, report only what you observe. If you cannot read something clearly, return null for it - never guess, and never fill in a plausible-looking value.

Finally, report a confidence score from 0 to 1 for subject, marks, and chapter - your own rough sense of how sure you are, not a value anyone should trust as calibrated.`;

/**
 * The thin appender §5.3 asks for: "Pass the student's seeded chapters for
 * that subject and require the model to return one of them or null." Kept
 * separate from the constant above so the base prompt stays editable as one
 * piece of text; only this function's own few lines change when the seeded
 * list changes shape.
 */
export function buildPaperParsePrompt(seededChapterNames: string[]): string {
  if (seededChapterNames.length === 0) {
    return `${PAPER_PARSE_PROMPT}

No chapters have been seeded for this subject yet. Set inferred_chapter to null and leave inferred_from null too.`;
  }

  const list = seededChapterNames.map((name) => `- ${name}`).join("\n");

  return `${PAPER_PARSE_PROMPT}

This paper's subject has the following seeded chapters. If the questions on the paper let you infer which chapter this assessment covers, set inferred_chapter to ONE of the exact strings below - copy it verbatim, do not paraphrase or shorten it. If you cannot confidently place it in one of these, set inferred_chapter to null. Either way, if you set inferred_chapter, also set inferred_from to a short phrase naming the specific evidence (e.g. "Q3 sedimentary rock, Q7 rock cycle") so a person can check your reasoning; leave inferred_from null when inferred_chapter is null.

Seeded chapters:
${list}`;
}
