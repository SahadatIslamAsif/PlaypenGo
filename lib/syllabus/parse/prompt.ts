// §5.2's syllabus PDF parse prompt. Reports what the model SEES, subject by
// subject, chapter by chapter - it says nothing about session_label scoping
// or commit_syllabus_tree's matching, since that's lib/syllabus/'s job and
// nothing the model needs to reason about.
//
// Chapters are split to the finest unit the document offers, not reported
// verbatim - a CT can cover part of a compound line ("Chapter 2, 6, 8" is
// three units, not one), and there's no way to record that scope without a
// row per unit. Over-splitting is recoverable later (rename/delete on the
// subjects screen); under-splitting throws away scope a CT already had. The
// splitting/stripping rules below are the lever for that - this is the only
// file that changes when they need adjusting, since the model's
// `chapters: string[]` output flows untouched through
// `app/api/syllabus/import/route.ts` into `commit_syllabus_tree`, with no
// TypeScript normalisation layer in between.

export const SYLLABUS_PARSE_PROMPT = `You are reading a school's syllabus document for one class level and term - one or more pages listing every subject taught and its chapters. Read the whole document before answering.

Report class_level, session, and semester exactly as stated in the document (for example: class level "8", session "2026-2027", semester "First"). If any of these isn't stated anywhere in the document, return null for it rather than guessing.

For every subject listed, report its name exactly as printed. Some subjects split into two named papers - e.g. "Mathematics" splitting into "Math D" and "Add Math", or a language subject splitting into "Paper 1" and "Paper 2". When a subject splits this way, report one entry per paper in its papers array (each with its own name and its own chapters), and leave that subject's own top-level chapters array empty. A subject that doesn't split reports its chapters directly in its own chapters array, and leaves papers empty.

Each chapter you report should be the finest unit the document actually offers - split a line that names several chapters at once into one chapter per unit, rather than reporting the whole line as one chapter. Apply these rules, in this order, to every line before you report it:

1. Split on "/", ";", and bullet markers ("*", "•", and a "-" that is acting as a bullet rather than a dash inside a title). Also split on a comma, but only between named items - never inside a bare numeric run. "Chapter 2, 6, 8 - mixed algebra topics" stays ONE chapter (a numeric run); "Nouns, Verbs, Adjectives" splits into three.

   ";" needs a second check before you split on it: it separates same-kind units in some subjects ("Unit 1; Unit 2" splits) but separates a title from its author, edition, or similar in others ("The Lighthouse Keeper's Daughter; Helen Dunmore" does not split - report the title alone, drop the author). Ask whether both sides name the same kind of thing; split only if they do.

   "&" splits when it joins two numbered or indexed parts of the same larger item ("Act 1 & 2" becomes two chapters, one per act). It does not split when it joins two different concepts that together name one topic ("Heat & Temperature" and "Water & Environment" each stay one chapter).

   A comma survives inside a single title when the words after it read as a continuation of the same name rather than a new item - usually signalled by a trailing "and" ("Elements, Compounds and Mixtures" stays one chapter; so does "Assets, Liabilities and Owner's Equity").

   A parenthetical that lists examples or narrows a topic's scope is stripped, not split into its own chapters - "Grammar (Nouns, Pronouns, Verbs, Adjectives)" reports as one chapter, "Grammar", with the parenthetical dropped, even though it looks like the comma-splitting case above. The test is whether the parenthetical is naming separate items to cover, or narrowing what one item covers; a scope note narrows.

2. When the units you just split out are sub-topics under a heading rather than complete chapter names on their own ("Algebra" as a heading over "* Simplification", "* Factorisation"), prefix the heading onto each one so it still reads on its own: "Algebra: Simplification", "Algebra: Factorisation" - never bare "Simplification".

3. Strip leading markers - bullets, dots, chapter/unit numbering, decimal sub-topic numbers - whenever real words follow. "3.1: Levers and Pulleys" becomes "Levers and Pulleys"; "Unit 4 - Forces" becomes "Forces". Keep the numeral only when stripping it would leave nothing at all - a bullet whose entire content is a bare number or an unnamed marker becomes "Chapter N", "Unit N", numbered sequentially within its subject, the same way a bare range is handled below.

4. Strip page references and similar parentheticals wherever they appear - "Photosynthesis (pg.12-15)" becomes "Photosynthesis".

Everything else about chapters is unchanged from a plain read: report each one exactly as printed once split and stripped - never normalise, renumber, or translate beyond what the four rules above call for. Real syllabus documents are messy in a few other specific, predictable ways too - handle each of these exactly like this, every time:

- A bare chapter range with no names at all, e.g. "Chapters: 1-5" for a subject - generate placeholder chapter strings "Chapter 1" through "Chapter 5" rather than refusing to report that subject. Never leave a subject out just because its chapters aren't individually named.
- A chapter written in a non-Latin script (a second-language subject taught in its own script) - report it exactly as printed, in that script. Never transliterate it into Latin letters.
- A free-text caveat printed alongside a subject, e.g. "Limited to specific topics taught in class" - this is a note about the subject, not a chapter. Do not report it as one.

If you cannot read a subject's name, or any of a subject's chapters, clearly enough to be confident, leave that subject out of the response entirely rather than guessing at its content.`;
