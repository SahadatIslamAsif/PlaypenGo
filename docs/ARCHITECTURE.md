# PlaypenGo — Architecture

This document describes PlaypenGo's technical architecture and the reasoning behind its decisions: the data model, the AI parsing pipelines, the prediction and notification engine, and the design system. It is the public counterpart to a private build spec that also carries one real family's actual class routine, syllabus contents, and session-by-session testing notes — that file stays out of version control. Every worked example below is invented; none of it is a real routine, a real syllabus, or a real name.

**Section numbers below match the private spec's exactly**, because code comments throughout this repo cite them (`§7.3`, `§5.3`, and so on) — that cross-reference has to keep resolving to the same idea in both documents, so this file is organized identically rather than reflowed for its own sake. The one addition with no counterpart in the private spec is §11, the design system, which otherwise lives only in `CLAUDE.md`.

The app itself was originally built for one student, one guardian, and one tutor, sized from the start to also work for a handful of unrelated families using it independently — which is why the constraints throughout (zero budget, free-tier services, a single-digit user count) are treated as real design constraints rather than temporary shortcuts.

---

## 0. Read this first

### The problem

Many schools run two kinds of frequent, low-stakes assessment:

- A **scheduled test** — the date is announced in class, and the syllabus for it is known in advance.
- A **surprise marking** — no date is ever announced, but it is predictable in practice, because teachers tend to hold one once a chapter is finished.

Marks are handed back on the physical paper within a day or two, but many school portals only publish them in bulk, once a semester, shortly before a parent-teacher meeting. For months at a time, nobody outside the classroom has a running record of how a student is actually doing — guardians are blind, and the student has a full timetable's worth of unpredictable assessments to prepare for, with no aggregated view of their own.

### What this app is

A real-time, parallel record of assessments and marks that the school's own system only produces in arrears, plus a prediction engine that turns *syllabus position* into *preparation alerts*, since a surprise marking has no announced date to alert on directly.

### Non-goals for v1

- Semester, mid-term, or final exams (only the two frequent assessment types above)
- Homework or attendance tracking
- Messaging or chat between roles
- Native mobile apps
- Cross-student or section-wide data sharing (explicitly rejected — see §3.1)

---

## 1. Users and roles

Three roles, one Postgres schema, enforced entirely by row-level security rather than by application code:

| Role | Can do |
|---|---|
| **Student** | Owns everything: subjects, chapters, progress, results, routine. The only role that uploads papers. |
| **Guardian** | Read-only on their linked student. Receives a daily digest. Full transparency — no filtering of bad marks. |
| **Tutor** | Reads all linked students. May correct an already-logged result, but never creates or uploads one. Approves guardian links. |

The permission shape follows directly from what each role is *for*, not from a generic notion of admin/user/viewer:

- **Guardians are read-only everywhere** — no insert, update, or delete policy on any table, and no edit affordance in the UI that could imply otherwise. A guardian who could edit a mark would make the record exactly as unreliable as the thing this app replaces.
- **Only the student uploads papers.** The tutor gets `SELECT` on every linked student plus `UPDATE` on `results` alone — enough to correct a wrong mark sitting beside the student, never enough to create or delete one. This is a narrower grant than "tutor can manage results": correcting a mistake and originating a record are different acts, and the schema keeps them different.
- **RLS on every table, storage buckets private, signed URLs only.** This system holds a minor's grades and photos of their exam scripts; there is no table where "authenticated" is a sufficient check on its own.
- **The service-role key exists in exactly one place** — the cron route that sends the nightly digest — and never reaches the client. Everything else authorizes through the same RLS policies the browser client already respects, which means there is one authorization story for the whole app, not a server-side one and a client-side one that can drift apart.

### Linking flow

1. The student signs up and chooses a class level and section.
2. The app generates a short family code (uppercase alphanumeric, an ambiguity-free alphabet with no `O`/`0`/`I`/`1`), valid for a week, single-use.
3. A guardian signs up and enters the code. The link is created with `status = 'pending'`.
4. The tutor approves the link from their dashboard. Only then does the guardian see any data or receive email — a pending link is invisible and silent.
5. A tutor links to a student the same way (a student enters the tutor's code).

No account is ever seeded directly into the database. Every role goes through a real signup page, so the RLS policies are exercised by the same path production traffic uses, not bypassed for convenience.

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js (App Router), TypeScript | |
| Styling | Tailwind CSS + `lucide-react` | |
| Theme | `next-themes`, light/dark toggle | |
| DB / Auth / Storage | Supabase (Postgres + Auth + Storage + RLS) | Never Firebase. |
| AI parsing | Gemini Flash via `@google/genai` | Always structured output with an explicit response schema — never "return ONLY JSON" text parsing, which silently breaks the moment the model adds a stray sentence. |
| Email | Nodemailer over SMTP | Templates via `react-email`, inline styles only — Tailwind classes do not survive email clients. |
| Hosting | Vercel (Hobby) | |
| Scheduling | External cron hitting a bearer-protected route | Vercel Hobby's own cron is once a day, UTC only, and fires anywhere within the hour — an external scheduler hitting the same route is the primary path, with the platform cron kept only as a backup. |

**Zero budget** is a real constraint, not a starting point to graduate out of: every service above has to keep working at a handful of users on its free tier indefinitely.

**Free-tier shapes worth designing around from day one:**
- A managed Postgres free tier can pause a project after roughly a week of inactivity — a daily job that touches the database is what keeps it warm, which is one more reason the nightly cron has to actually run reliably.
- Serverless functions on a free tier default to a short timeout (single digits of seconds), raisable to around a minute. A single multi-image AI call fits comfortably inside that; a job that fans out across many recipients must still be chunked rather than written as one long loop, because the ceiling is a ceiling, not a target.
- Free-tier LLM calls are typically rate-limited per minute. A parsing pipeline that runs one call per document, sequential and never parallel, stays under that by construction rather than by hoping.
- Free object storage is commonly capped in the single-digit gigabytes. Compressing images client-side before upload buys meaningfully more headroom than compressing them after the fact.

---

## 3. Data model

All tables carry `id uuid primary key default gen_random_uuid()` and `created_at timestamptz default now()`.

### 3.1 Design note — read before restructuring the subject tree

Chapter progress is stored **per student**, never per class section. This was considered and deliberately rejected: the app has no relationship with the other students in the same section and cannot assume they will ever use it. Every student's syllabus tree is independent even when two students physically sit in the same room and follow the same printed syllabus.

### 3.2 Tables

```
subjects_catalog          -- static seed, a fixed external curriculum's subject list
  name                text        -- "Additional Mathematics"
  code                text        -- an external syllabus code, nullable where none exists
  level               text        -- one of a small fixed set of curriculum levels
  common_aliases      text[]      -- ['Add Math','Add Maths','A.Math']

profiles                  -- 1:1 with auth.users
  id                  uuid  references auth.users
  role                text        -- 'student' | 'guardian' | 'tutor'
  full_name           text
  email               text
  class_level         int         -- students only
  section             text        -- e.g. 'Willow'
  school              text        -- default 'Example School' — v1 assumes one school
  session_label       text        -- e.g. '2026-2027'
  timezone            text        -- default 'Asia/Dhaka'

family_codes
  code                text unique -- short, single-use
  student_id          uuid
  expires_at          timestamptz
  used_at             timestamptz

guardian_links
  guardian_id         uuid
  student_id          uuid
  status              text        -- 'pending' | 'approved' | 'revoked'
  approved_by         uuid
  unique (guardian_id, student_id)

tutor_links
  tutor_id            uuid
  student_id          uuid
  status              text        -- 'pending' | 'approved' | 'revoked'

student_subjects
  student_id          uuid
  catalog_id          uuid null   -- null if fully custom
  display_name        text        -- as the school actually names it, e.g. 'Env. Mgt'
  teacher_name        text null   -- from the routine
  is_active           bool default true

subject_papers            -- optional child level
  student_subject_id  uuid
  name                text        -- e.g. 'Math D' | 'Add Math' | 'Paper 1'
  sort_order          int

chapters
  student_subject_id  uuid
  paper_id            uuid null
  name                text        -- e.g. '3.1: Levers and Pulleys'
  source              text        -- 'syllabus' | 'manual'
  sort_order          int
  status              text        -- 'not_started' | 'p80' | 'p100' | 'not_taught'
  status_updated_at   timestamptz

subject_aliases           -- grows every time a parse is corrected
  alias_text          text        -- a short form the school actually uses on paper
  catalog_id          uuid null
  student_subject_id  uuid null
  source              text        -- 'routine' | 'paper' | 'manual'
  student_id          uuid null   -- null = global alias

routines
  student_id          uuid
  session_label       text
  image_path          text        -- private object storage
  is_active           bool
  parsed_at           timestamptz

routine_periods
  routine_id          uuid
  day_of_week         int         -- 0=Sunday … 4=Thursday (a Sun–Thu school week)
  period_no           int
  start_time          time
  end_time            time
  raw_text            text        -- exactly what was in the cell
  teacher_raw         text
  student_subject_id  uuid null
  is_academic         bool        -- false for breaks, assembly, games, etc.

assessments
  student_id          uuid
  student_subject_id  uuid
  paper_id            uuid null
  chapter_id          uuid null
  type                text        -- the two assessment kinds from §0
  status              text        -- 'predicted'|'scheduled'|'occurred'|'logged'|'cancelled'
  scheduled_date      date null   -- the scheduled kind only; editable (postponement)
  occurred_date       date null
  created_by          uuid
  window_closed_at    timestamptz null
  window_close_reason text null   -- see §7.3/§7.5's five reasons

results
  assessment_id       uuid unique
  student_id          uuid
  raw_obtained        numeric
  raw_total           numeric
  converted           numeric     -- see §6
  percentage          numeric
  paper_missing       bool        -- the physical paper has not come back yet
  entry_mode          text        -- 'ocr' | 'manual'
  ocr_confidence      jsonb       -- per-field confidence from the parse
  verified_by         uuid        -- who confirmed the review screen
  logged_at           timestamptz

result_images
  result_id           uuid
  storage_path        text
  page_no             int
  raw_parse           jsonb

alerts                    -- one row per occurrence × kind (§7.3) — never one row for a whole window
  student_id          uuid
  assessment_id       uuid
  kind                text        -- 'advance' | 'night_before' | 'confirm' | 'unlogged'
  target_date         date        -- the one occurrence (class day) this row is about
  sent_count          int default 0
  last_sent_at        timestamptz
  unique (assessment_id, target_date, kind)

scan_jobs                 -- an unconfirmed parse; nothing lives only in client state
  student_id          uuid
  status              text        -- 'uploading'|'parsing'|'review'|'confirmed'|'abandoned'|'failed'
  raw_parse           jsonb       -- the full model response
  error               text null
  result_id           uuid null   -- set on confirm
  expires_at          timestamptz -- TTL sweep for abandoned scans

scan_pages
  scan_job_id         uuid
  page_no             int         -- upload order
  storage_path        text
  has_header          bool

confirm_tokens
  token               text unique -- url-safe random, 32+ chars
  alert_id            uuid        -- the occurrence's 'confirm'-kind alerts row (§7.3)
  expires_at          timestamptz
  used_at             timestamptz
  answer              text        -- 'yes' | 'no'

email_log
  recipient_id        uuid
  send_date           date
  email_type          text        -- 'digest_student'|'digest_guardian'|'digest_tutor'
  subject_line        text
  payload             jsonb
  status              text        -- 'sent' | 'failed' | 'skipped_empty'
  unique (recipient_id, send_date, email_type)   -- idempotency guard
```

A surprise-marking window has no single predicted date to store on the assessment row — its occurrence dates live entirely as `alerts.target_date` rows, one per class occurrence the window has actually reached. An occurrence that never got a row of its own (its evening claimed by a sibling occurrence, §7.3) simply isn't represented until it needs to be.

`assessments.window_closed_at` / `window_close_reason` describe the window as a whole rather than any one occurrence, which is also why they live on the assessment and not on `alerts`: closing is a fact about the *window*, and `alerts` has no single row that could hold a whole-window fact. §7.3 has the exact computation behind the close reasons and the distinct-evenings cap; §7.5 has the full close-reason list.

### 3.3 RLS policies

Row-level security is enabled on every table, storage buckets are private, and every read of an image goes through a signed URL rather than a public one.

- **Students:** full CRUD where the row's `student_id` is their own.
- **Guardians:** `SELECT` only, and only where an `approved` row exists linking them to that student. No `INSERT`/`UPDATE`/`DELETE` anywhere in the schema.
- **Tutors:** `SELECT` on every linked student, plus `UPDATE` on `results` only. No `INSERT` anywhere, no `DELETE`, and no access at all to `scan_jobs` / `scan_pages` — scanning is a student-only action, and a tutor who can't insert a result shouldn't be able to see an in-progress scan either.
- The subject catalogue is readable by any authenticated user and writable by nobody through the API — it changes by re-seeding, not by user action.
- The service-role key is used only inside the cron route.

Policy tests are written as real SQL assertions against a live database: a guardian must not be able to read another family's rows, and an unlinked student must not read anything belonging to another student.

---

## 4. Seeders

### 4.1 Subject catalogue

The static catalogue ships as seed data in the repo — an external curriculum's published subject list with its official codes, plus a lower-secondary equivalent for younger classes. It is not scraped at runtime: it changes at most once a year, and a live dependency on an external source for something that rarely changes is a pointless new failure mode.

Aliases are seeded generously, because this is what makes routine and paper parsing actually work — a school's own naming will not match the curriculum's official naming:

```
"Mathematics D"            → ["Maths","Math D","Math-D","Mathematics"]
"Additional Mathematics"   → ["Add Math","Add Maths","A.Math","AddMath"]
"Environmental Management" → ["Env. Management","Env Mgt","EM","Env. Mgmt"]
"Business Studies"         → ["Business","B.St","BS"]
```

The catalogue is the canonical spine; `student_subjects.display_name` preserves whatever the school actually calls the subject on its own paperwork.

### 4.2 Syllabus seeder

Many schools issue one document per class per term listing every subject and its chapters. Uploading it once populates the entire tree for a student — the single biggest reduction in manual setup effort when a student is taking a dozen or more subjects.

Flow: upload the document → the model parses it (§5.2) → an editable review tree → confirm → the tree is written.

**Real messiness a parser like this has to survive**, illustrated with invented examples in the same shape as what actually shows up in these documents:

- Subjects that split into papers: a subject called "Mathematics" splitting into *Math D* and *Add Math*; a language subject splitting into *Paper 1* and *Paper 2*.
- Chapters given as a bare range with no names at all: "Chapters: 1–5" for a subject → generate five placeholder chapters the student can rename later, rather than refusing to import the subject.
- Compound entries that name several chapters at once, e.g. "Chapter 2, 6, 8 – mixed algebra topics" → treat as one chapter and keep the original string verbatim; do not try to split it into three.
- Decimal sub-topic numbering, e.g. "3.1: Levers and Pulleys" → one chapter, exactly as printed.
- Non-Latin script chapters (a second-language subject taught in its own script) → preserved exactly, never transliterated.
- Free-text caveats printed alongside a subject, e.g. "Limited to specific topics taught in class" → ignored; this is a note, not a chapter.

Every import is scoped to a session label and semester, so the next term's upload doesn't overwrite the current term's history.

---

## 5. Gemini pipelines

Three separate prompts, each with an explicit structured-output schema and a per-field confidence score. Nothing from any of them reaches the database without passing through a human review screen first — every extracted field stays editable.

### 5.1 Routine parse

**Input:** one photo of the printed weekly class routine. **Output:** a grid of periods, each matched to a subject and a teacher name.

The model is given the student's already-known subject list and required to map every cell to one of them, or return `null` rather than guess.

Response schema:

```json
{
  "class_level": "example",
  "section": "Willow",
  "class_teacher": "Nasreen Chowdhury",
  "periods": [
    {"day":"SUN","period_no":1,"start":"08:15","end":"08:55",
     "raw_text":"Business Studies","teacher":"Imran",
     "matched_subject":"Business Studies","is_academic":true,"confidence":0.97}
  ]
}
```

**Rules the prompt has to state explicitly**, because a naive read of a printed routine gets every one of these wrong at least once:

1. **A break column can spell a word vertically down the days of the week** — one letter per day. Any single-letter cell, or a column whose cells concatenate into a recognizable word, is a break, not a subject.
2. **Named non-academic periods** — assembly, games, library, and similar — are flagged non-academic the same way a break is.
3. **A teacher's name typically sits below the subject** in each cell; capture it as useful context and a future prediction signal, not as noise to discard.
4. **Normalise teacher name spelling within one routine.** The same teacher can appear with two different spellings on different days of the same printed grid — fuzzy-match names within a single routine and flag near-duplicates for review rather than silently creating two teachers.
5. **A subject that splits into papers is never distinguished by the routine.** Both papers are taught in the same periods by the same teacher; paper selection happens later, when a result is actually logged.
6. Days run Sunday through Thursday. Friday and Saturday are the weekend and never appear.

**Post-parse:** any cell the model can't resolve renders as a dropdown in the review grid; picking one writes the correction into the alias table so the same short form resolves automatically next time, including on a scanned exam paper header.

**Cross-check against the syllabus** if both exist: a routine subject absent from the syllabus is probably non-academic or a misread; a syllabus subject absent from the routine means the parse likely dropped a cell. Surface both as warnings on the review screen rather than silent gaps.

### 5.2 Syllabus PDF parse

**Input:** the term's syllabus document (multi-page). **Output:**

```json
{
  "class_level": "example",
  "session": "2026-2027",
  "semester": "First",
  "subjects": [
    {"name":"Business Studies","papers":[],
     "chapters":["1.1: Introduction to Enterprise","1.2: Business Objectives"]},
    {"name":"Mathematics",
     "papers":[
       {"name":"Math D","chapters":["Chapter 1 – Number Systems"]},
       {"name":"Add Math","chapters":["Chapter 2 – Simultaneous Equations"]}
     ],
     "chapters":[]}
  ]
}
```

Preserve original chapter strings verbatim. Do not normalise, renumber, or translate.

### 5.3 Exam paper parse

**Input:** one to five images of a single assessment, uploaded in page order, sent in one request so the model can see that a later page belongs to an earlier page's header. **Output:** one assessment, never one per page.

Scanning is a student-only action; tutors and guardians never upload one (§3.3).

There are two paper formats:

- **The surprise-marking paper** — an exercise-book page on the school's own letterhead, with a printed header template and ruled lines. Everything below the header is handwritten.
- **The scheduled-test paper** — a printed question paper with its own printed header. The question text itself is typeset, not handwritten.

The surprise-marking header template is fixed, which is what makes header extraction a form-field read rather than open-ended OCR:

```
[SCHOOL logo]          Date: ______
Name: ______  Class: ___  Sec: ______  Subject: ____________
Total marks: ______   Obtained marks: ______
```

Response schema:

```json
{
  "pages": [
    {"page": 1, "has_header": true,  "printed_question_text": false,
     "header_subject_raw": "Env. Management", "header_date_raw": "12/9/26"},
    {"page": 2, "has_header": false, "printed_question_text": false,
     "header_subject_raw": null, "header_date_raw": null}
  ],
  "header": {
    "student_name": "Priyanka Das",
    "class": "8", "section": "Willow",
    "subject_raw": "Env. Management",
    "date_raw": "12/9/26",
    "date": "2026-09-12",
    "total_marks_field": 15,
    "obtained_marks_field": null,
    "obtained_field_struck_through": true
  },
  "mark_candidates": [
    {"page": 1, "value_obtained": 12, "value_total": 15,
     "style": "ellipse", "location": "mid-page right"},
    {"page": 2, "value_obtained": 6, "value_total": null,
     "style": "ellipse", "location": "bottom"}
  ],
  "body_type_hint": "C.W.M",
  "topic_line": null,
  "inferred_chapter": "Chapter 4: Rock Cycle",
  "inferred_from": "Q2 weathering, Q5 sediment layers",
  "confidence": {"subject": 0.96, "marks": 0.92, "chapter": 0.71}
}
```

---

#### Mark resolution — the ellipse ladder

The teacher marks inside an ellipse. The fraction is written diagonally — obtained above the slash, total below — and where it exists, it is the authoritative score. The template's own `Obtained marks` blank is only a fill-in field; teachers frequently ignore it, and students sometimes fill it in and then cross it out.

Resolve in this order, stopping at the first hit:

1. **An ellipse on page 1.** Read it as `obtained / total`. This is the mark. Do not look further.
2. **The `Obtained marks` and `Total marks` blanks**, used as a pair.
3. **A struck-through blank counts as empty**, not as a value. This only ever matters at step 2, since step 1 already won if an ellipse exists.
4. **Nothing found.** Leave both fields empty for a human to fill in. Never guess.

**Only page 1 carries the total.** An ellipse on a later page is a per-section mark, reported for display but never summed and never given weight in the ladder — its denominator may not even exist.

**A mark candidate is a numeral, usually enclosed or slashed.** Ticks, check marks, crosses, question numbers, and a teacher's dated remark are not mark candidates and must be excluded, however numeral-adjacent they look.

**Strike-through detection is scoped to the `Obtained marks` field only.** A marked-up answer body with corrections written above struck words is completely normal, and a general strike-through report over the whole page would void good data along with the bad.

**Unreadable is the same as blank.** A handwritten total that could be read two different ways (a `1` that could be an `l`, for instance) requires a clean, unambiguous integer or it falls through the ladder rather than being guessed.

**Multiple ellipses on page 1 are rare.** Take the first, surface the rest as candidates, and rely on the human editing the field.

#### Type detection

Printed question text on the page → a scheduled test. The school's own letterhead with ruled lines and handwriting only → a surprise marking.

Cross-check against app state: if a scheduled test is already on the calendar for that subject and date, that confirms it — the scheduled-date check is the stronger signal, and it wins over the visual read when the two disagree; flag the disagreement in the review screen rather than silently picking one.

A type marker written on the paper's centre line is corroboration, not the primary test — see the ambiguity note below.

#### Date

Dates are read as day/month/year. Keep the raw string alongside the parsed ISO date so a misparse is visible in the review screen, not hidden behind a normalized value.

**Validate the weekday against the routine.** A parsed date whose weekday has no period for that subject is almost certainly a day/month transposition — flag it. If Environmental Management only ever meets Tuesday and Thursday in the routine, a paper dated on one of those weekdays checks out; one dated on a day the subject never meets does not.

**The header date is the test date. The day it was logged is not.** A paper handed back late still files under the date printed on it, so the chart plots it in the week it actually belongs to and the §7 alert window closes on the correct day. If the date is missing or unreadable, ask a human — never default to today.

#### The centre line is ambiguous by design

A handwritten line across the centre of the page sometimes names a *type* (a written-out abbreviation for the assessment kind) and sometimes names a *topic*.

Test it against the seeded chapter list **with fuzzy matching** — lowercase, strip leading articles, drop anything after a colon, compare token overlap against a threshold. Exact match routinely fails even on a real chapter: a line reading `Lighthouse Keeper's Daughter` should still match a syllabus entry filed as `The Lighthouse Keeper's Daughter: A Novel in Focus (with Ch. 1)`.

Three outcomes:

- Matches a chapter → it is a topic; populate `topic_line` and use it for chapter selection.
- Matches a type marker (`C.W.M`, `C.T`) → it is a type hint.
- Neither → keep it as free-text `topic_line`. Do not force a decision.

#### Chapter

**Chapter is matched, not transcribed.** Pass the student's seeded chapters for that subject and require the model to return one of them or `null`. Many surprise-marking papers never name a chapter — infer it from question content and always show the evidence string (`inferred_from`) in the review modal so the human can sanity-check the inference. Never auto-select a chapter below the confidence threshold; present it as a suggestion with a `No chapter` option always available.

#### Name mismatch

If `student_name` doesn't fuzzy-match the student the result is being filed under, show a warning above the save bar and require an explicit confirm. **Do not block the save.** Use token-subset matching, not whole-string edit distance — a fuller name on the paper (e.g. "Priyanka Rahman Das") against a shorter profile name (e.g. "Priyanka Das") must pass, because the profile's tokens are a subset of the paper's. The mismatch is recorded on the result and surfaces in the tutor and guardian views.

Handwritten name transcription is not guaranteed stable run to run — the same handwriting can transcribe an ambiguous internal letter two different ways off identical input on two different calls. Token-subset matching is not loosened to absorb this: the same looseness that would tolerate a spelling variant would also let a genuinely wrong student's paper slip through unflagged, and catching that is the actual point of the check.

#### Page grouping

Students upload in page order. Group by **upload order, never by header matching** — a later page in a multi-page surprise-marking paper often has no header at all, nothing to match on.

- A page with a header starts a new assessment.
- A headerless page attaches to the most recent header page.
- A scheduled-test paper may print its header on every page. Guard with same subject + same date + consecutive → same paper.
- If the first image is headerless, it is an orphan. Ask; do not attach it to nothing.

That guard is why `pages[]` carries `header_subject_raw`/`header_date_raw` per page, in addition to the one authoritative `header` above: comparing "same subject + same date" across pages needs each page's own read, not the whole call's single header applied to every page it doesn't disagree with by construction. Deliberately narrow — not a second `header` per page, since duplicating all eight fields would create a second candidate for everything the ladder and the review screen already read from the one authoritative header. These two fields are the minimum the guard actually compares.

The thumbnail strip in the review screen carries a **same paper / new paper** toggle. It is the grouping control, not decoration.

#### Confidence

The model's self-reported `confidence` is uncalibrated. Use it only to decide highlighting, never to decide a value.

Where two independent signals exist, derive confidence from their agreement instead: header total vs ellipse denominator; parsed subject vs the routine's subject for that weekday; visual type vs scheduled test already on the calendar. Agreement raises confidence, disagreement lowers it and forces the field into the highlighted state — the weekday check is shared with the Date section's own weekday validation above, so a mismatch highlights subject and date together, not subject alone.

Marks, subject, and date are always visible and always editable regardless of any score.

#### Verification modal

Nothing reaches the database without passing through it. On mobile it is not side-by-side: thumbnail strip pinned at the top (tap for full-screen zoom), fields scrolling beneath, a sticky **Save result** bar above the keyboard. Low-confidence fields keep their highlight and scroll into view when focused. Mark fields use `inputmode="numeric"`.

**Every extracted field stays editable — routine, syllabus, and marks alike.** One `Save result`.

Unconfirmed parses persist in `scan_jobs` / `scan_pages` (§3.2). A review screen abandoned when the camera evicts the tab is resumable; nothing lives only in client state.

#### On confirm

**A scheduled test** attaches to the assessment already scheduled for that exact date — no fuzzy dates. If no exact match exists but the subject has other open scheduled dates, list them as selectable options (a postponement, most likely); never auto-match past the exact date, and never hide the alternative.

**A surprise marking** is by definition unscheduled, so no `assessments` row is waiting for it by default. If one or more open predicted windows exist for that subject, attach to one — a window whose chapter matches the inferred chapter wins, otherwise the oldest open window. Chapter is a tiebreak between windows, never a requirement to attach at all.

Either way, **filing as a new assessment instead is always available** — a match, or a near-miss list, is offered, never forced.

On confirm:

- Attach to the matched (or hand-picked) assessment and set `window_closed_at` / `window_close_reason = 'result_logged'` (§7.5) — unless filed as new.
- Otherwise create an `assessments` row with `status = 'logged'` and `occurred_date` from the header.
- Then write `results`, and move the images from the temporary upload prefix to the result.

Abandoned scan images are swept on a TTL. Free object storage is a limited, shared budget.

#### Duplicates

The same paper can be scanned twice. Match on student + subject + `occurred_date` + raw score; on a hit, offer **attach these images to the existing result** rather than rejecting the upload.

#### Manual entry and attaching a paper later

`+ Manual Entry` — subject, paper, type, chapter, obtained, total, and a `Paper not returned` checkbox. The guardian view shows a soft badge: *Logged manually (no paper attached)*.

Marks are often known in class days before the physical paper comes back. A manually-logged result therefore accepts images afterwards: **Attach paper** runs the same scan flow, leaves confirmed fields alone, fills only what is empty, clears `paper_missing`, and drops the badge.

#### Rate limiting

One assessment at a time, one model call per assessment. Sequential, never parallel. Caching parses by image hash in development means prompt iteration doesn't burn the free tier.

---

## 6. Marks and conversion

**The teacher always writes the raw mark on the paper.** Conversion happens only in the school's own system, at semester end. The app therefore does the conversion itself, in real time — this is a core reason the app exists.

```
percentage = raw_obtained / raw_total * 100

surprise marking: converted = round(raw_obtained / raw_total * 15, 1)
scheduled test:   converted = round(raw_obtained / raw_total * 25, 1)
```

One decimal place, matching the school's own convention. Examples:
- `5/10` on the 15-point scale → **7.5 / 15**
- `15/15` on the 15-point scale → **15.0 / 15** (already on scale; the formula is a no-op, do not special-case it)
- `18/40` on the 25-point scale → **11.3 / 25**

Store `raw_obtained`, `raw_total` and `converted`. Display raw on the result card, converted where the school's scale matters, and **percentage on all charts** so the two assessment types are comparable on one axis.

**`occurred_date` comes from the paper's header, never from when it was logged.** A paper returned four days late still files under the date the test happened, so the chart plots it in the week it belongs to and the §7 alert window closes on the right day. This has to hold on every code path that can write a result, including one that attaches to an assessment that already exists rather than creating a fresh one — a path with no scheduled date of its own to fall back on has nothing else honest to default to, and silently defaulting to "the day this was scanned" is a real bug this architecture has had to fix, not a hypothetical.

**End-of-semester reconciliation view:** a table of the app's logged results beside a column for the school's own published figures, so anything the app missed is visible at the meeting. Low effort, high credibility.

---

## 7. Notification engine

### 7.1 Principle

**One email, per person, per day, maximum.** Everything is folded into a single evening message. If every section is empty, nothing is sent. Violating this gets an app like this muted within weeks.

No notifications during school hours — phones are typically restricted during class and the student cannot act on them anyway.

### 7.2 Scheduling

One job fires once an evening, triggered by an external scheduler against a bearer-protected route. Return 401 on a missing or wrong token — there is no session-based check here, since nothing about this route runs on behalf of a logged-in user. Keep a platform-native cron entry as a backup, and rely on a database-level idempotency guard (a unique constraint on recipient/date/type) to make double-firing harmless, since more than one scheduler can legitimately fire the same route on the same evening.

Chunk the work. A free-tier serverless function has a real, low ceiling on run time; a nightly job across several recipients should not depend on that ceiling being generous.

### 7.3 The alert window

Superseded model: earlier drafts predicted a surprise marking by guessing a single target day and firing two alerts ahead of it. That single-guess model is gone — a chapter that stayed unmarked past the guessed day had nothing left to fall back on. What follows replaces it entirely.

Each open assessment gets a **window of class occurrences to watch**, sized by what's actually known about it:

- **A scheduled test** — the date is already known, so its window is exactly one occurrence: that date.
- **A surprise marking** — nothing is known but the trigger. Once a chapter reaches near-complete or complete progress with no result yet, open a window on the **next 4 class occurrences of that subject**, read straight off the routine — four occurrences, not four calendar days and not a fixed number of weeks. A subject's occurrences fall only on the weekdays it actually meets, whatever the surrounding calendar does.

For every occurrence still open in a window — the scheduled test's one, or however many of the surprise marking's four remain unmarked — fire the same two-evening pattern ahead of it: an **advance** alert two evenings out, a **night-before** alert the evening right before. Both are calendar days, weekend included — the routine only decides which day the class itself falls on, never which evenings the student is reachable.

**Cap sends to distinct evenings, not to occurrences.** Two occurrences on back-to-back class days push one occurrence's night-before onto the very same evening as the next occurrence's advance — unavoidable for a subject that meets every school day. A four-occurrence window on a daily subject should cost at most the number of evenings it actually spans, never up to eight separate emails. Exactly how that's computed is below, alongside the other pieces of window state.

**`alerts` is one row per occurrence × kind — never one row for a whole window.** A four-occurrence window is four `target_date`s, each of which can carry up to three `alerts` rows (`advance`, `night_before`, `confirm`) as it's reached; `unique (assessment_id, target_date, kind)` is the entire key (§3.2). There is no separate "window" row. The window is just the set of `alerts` rows sharing one `assessment_id`, and its terminal state lives on the assessment itself — `assessments.window_closed_at` / `window_close_reason` — because closing is a fact about the window as a whole, not about any single occurrence.

The five pieces of state a future implementer would otherwise have to re-derive from prose:

1. **The distinct-evenings cap**, worked out precisely. Before sending an occurrence's `advance` or `night_before` alert tonight:
   - Read every evening already used for this assessment: the distinct dates of `last_sent_at` across its `advance`/`night_before` rows.
   - If tonight's date is already in that set, skip the send outright — no row gets written for it. The occurrence is still tracked on its own terms: its `confirm` row is created independently once its `target_date` passes, whether or not its advance/night-before ever got an independent send.
   - Otherwise, this send claims tonight's evening: upsert the `(assessment_id, target_date, kind)` row with `last_sent_at = now()`.
   - This is exactly why a daily subject costs at most one send per evening across the whole window: occurrence 1's night-before and occurrence 2's advance can compute to the same evening, and whichever is processed first claims it — the second finds the evening already used and never creates a row.

2. **Exhaustion, computed from the routine, not from counting rows.** Re-derive the window's four occurrence dates the same way the window was opened. Don't infer "how many occurrences have passed" from however many `alerts` rows happen to exist — a skipped occurrence (its evening claimed by a sibling) may never have gotten a row of its own, and undercounting would leave the window open past its four occurrences. Once today is past the fourth occurrence's date and the assessment is still unmarked, the window closes — this is a fact about dates only, and says nothing on its own about *which* of two close reasons that is. Item 5 below is that distinction.

3. **`two_no_in_a_row`, computed over answered occurrences only.** Take every `confirm`-kind `alerts` row for the assessment, ordered by `target_date`, and look up each one's `confirm_tokens.answer` where one was actually recorded. Build the sequence of *answered* occurrences only, in that order — an occurrence whose confirm token expired unused is skipped entirely, neither breaking nor extending anything. The window closes the moment the last two entries in that sequence are both `no`. A `yes` anywhere resets the count, so this is specifically two `no`s back-to-back — never two over the window's whole life, and never a single `no`.

4. **A confirm question is "asked" only once it has been delivered — never at the moment its `alerts` row exists.** The row (and its `confirm_tokens` token) has to be written *before* the nightly run knows whether tonight's digest email will actually reach the student — the email needs the token to link to. So the row's mere presence must never be read as "already asked": `last_sent_at` stays null on write, and is stamped only once that evening's digest email to the student is confirmed sent. A failed send (bad SMTP credentials, a bounced provider, anything) must leave the row exactly as it found it, undelivered, so the next run's `alerts` exclusion check re-offers the same occurrence with its already-minted token rather than orphaning it. Nothing needs re-minting — the token was always valid, it just never reached anyone.

5. **Exhaustion means asked-and-unanswered, never never-asked.** Item 2's date arithmetic ("today is past the fourth occurrence's date") is true in two situations that must not share a close reason. The first is genuine: the engine watched this window night to night, asked about each occurrence as its date arrived, and the fourth passed with still no result — `window_close_reason = 'window_exhausted'`, doing the job an old flat multi-week expiry used to do. The second is a gap in the engine's own operation, not in the student's response: a paused database project, a broken scheduler, any stretch where the nightly job simply didn't run. Either can mean the very first time the engine looks at a window is already after every one of its occurrences — the date arithmetic says exhausted, but nothing was ever asked. Recording that as `window_exhausted` would tell whoever reads it later that the student was asked four times and stayed silent, when the honest story is that no running instance of the app ever reached this window. Close it instead with `window_close_reason = 'never_reached'`. The two are told apart by whether at least one `confirm`-kind `alerts` row exists for the assessment at all — not whether every occurrence got one, since a shorter gap partway through a window's life is still genuine engagement, just interrupted; only a window with *zero* confirm rows, of any occurrence, has never been reached by a running engine.

Closing a window in full — every condition, not just what's derived above — is §7.5.

### 7.4 Digest composition

Sections, in order. **`Tomorrow` and `Day after` are never truncated** — during a busy week there can legitimately be several scheduled tests in a day, and hiding them defeats the product.

1. **Tomorrow** — every scheduled test and predicted surprise marking. No cap.
2. **Day after** — same. No cap.
3. **Rest of the week** — up to 5, then `+N more`.
4. **Logged since yesterday** — results with raw and converted marks.
5. **Did this happen?** — Yes/No links for predicted surprise markings whose class day has passed (§7.6).
6. **Unlogged papers** — assessments confirmed as having happened with no result after 2 days.
7. **Weekly only — week in review** — per-subject averages, best and weakest chapters, syllabus coverage.

**Layout switch:** when 3+ assessments fall within the next 3 days, render a compact day-by-day table instead of prose blocks, so a busy week is scannable rather than a wall of text.

**Adaptive subject line:** naming what's actually inside, e.g. "Tomorrow: Business Studies test + Env. Management marking likely" — useful even unopened. Generic subject lines get ignored.

**Three recipients, three templates, same job:**
- **Student** — action-focused: what to revise, what to log.
- **Guardian** — full transparency: same assessments, plus marks and trend.
- **Tutor** — one table across all linked students: who has what tomorrow, who has unlogged papers, who is trending down against their own average. A weekly roll-up adds a per-student summary.

### 7.5 Alert lifecycle

- Every occurrence in a window fires the two-evening pattern from §7.3 (`advance`, then `night_before`); the cap on sends is **distinct evenings actually used** — computed exactly as in §7.3, not a flat count and not one pair per occurrence.
- Close the window — writing `assessments.window_closed_at` / `window_close_reason` (§3.2) — on any of:
  - `result_logged` — the result is logged. Judge this by the result's `occurred_date`, not by when it was scanned: a late-uploaded paper closes the window that was watching for it;
  - `two_no_in_a_row` — two `no` answers in a row, computed as in §7.3: not two over the window's lifetime, and not a single `no`. A `yes` anywhere between two `no`s resets the count; only back-to-back `no`s close it;
  - `window_exhausted` — all of a window's occurrences have passed with the chapter still unmarked, computed from the routine as in §7.3 — not from counting `alerts` rows — **and** the engine actually asked along the way: at least one `confirm`-kind `alerts` row exists for the assessment. This is "we asked four times and got no result," never "nobody ran the cron" — see `never_reached` below for that case;
  - `never_reached` — the same date arithmetic as `window_exhausted`, but with zero `confirm`-kind `alerts` rows ever written for the assessment: the engine's first contact with this window was already after every occurrence had passed, because the engine itself had a gap. The window still has to close — a stale prediction is not worth reviving — but the reason recorded must not claim the student was asked and stayed silent when no one was ever asked at all;
  - `ct_cancelled` — the scheduled test is cancelled (a one-occurrence window has no "exhausted" state of its own — cancellation is what closes it short of a logged result).
- A chapter at 100% with no result must not nag past its window — the 4-occurrence cap is what keeps the app trustworthy, the same job an old flat expiry used to do.
- Postponing a scheduled test's date shifts its one-occurrence window and emails the guardian a one-line update.

### 7.6 One-tap confirmation

Yes/No links point at `/c/<token>` — single-use, 7-day expiry, **no login required**.

- **Yes** → sets `assessments.status = 'occurred'`, creates a pending-result placeholder that surfaces on the dashboard and in section 6 of the digest. The window closes the normal way once that result is logged (§7.5) — a confirmed "yes" doesn't need its own close reason.
- **No** → does *not* close the window by itself. It advances to the next occurrence still open in the window (§7.3) — the same window, not a freshly re-guessed one, since the window already holds all 4 occurrences up front. Only when a `No` lands right after another `No`, with no `Yes` in between, does the window close (§7.5's `two_no_in_a_row`).

This absorbs false positives from public holidays, which is why holiday calendars are deliberately **not** implemented: an unexpected day off produces one wrong alert and one `No` tap, which the window shrugs off and moves past — cheaper than maintaining a holiday table.

It also quietly accumulates the dataset needed for a future per-subject/per-teacher lag model (something like *"this subject's markings usually come one class after chapter completion"*). Not in v1, but the data is captured from day one.

---

## 8. Screens

### Student
- **Dashboard** — Today / Tomorrow strip from the routine; "Coming up" list; pending-result nudges; a prominent scan action.
- **Subjects** — cards per subject → papers → chapters, each with `0% / 80% / 100%` toggles and a `Not taught` option (teachers shrink the syllabus). `+ Add chapter` for topics carried over from a previous term.
- **Assign / edit a scheduled test's date** on any chapter, with postpone.
- **Scan** — camera capture (1–5 pages, in order) → parse → verification modal → save. Student-only. Resumable from `scan_jobs` if the tab is evicted.
- **Results** — history, filterable by subject; raw + converted; percentage trend chart.
- **Routine** — current image, editable grid, re-upload.
- **Settings** — theme, family code, notification prefs.

### Guardian
Read-only mirror: student's upcoming assessments, results as they are logged, per-subject trends, syllabus coverage. No edit affordances anywhere in the UI.

### Tutor
The tutor does not log papers. The dashboard's job is **noticing what the student hasn't logged**, and correcting what was logged wrong.

- All linked students in one table, with tomorrow's load and an **unlogged count** per student — the primary signal on this screen.
- Pending guardian link approvals.
- Per-student drill-down: weak chapters, unlogged papers, trend against the student's own average.
- Correct a logged result in place (`UPDATE` on `results` only, §3.3).
- Semester reconciliation view (§6).

### Design constraints
- Must be equally usable on a desktop browser and a phone browser. The student scans on a phone; the guardian usually arrives from an email link on a phone and may never see a desktop.
- Light/dark toggle, simple typography, low visual clutter.
- PWA manifest + icons so it is installable. **No service worker push in v1** — email is the delivery channel.
- Compress images client-side before upload (free storage tiers are small; mobile data is not free).
- Offline-tolerant writes for progress taps.

---

## 9. Build order

**Phase 1 — Foundation.** Next.js + Tailwind + theme. Supabase project, full schema, RLS policies **with tests**. Signup/login for all three roles. Family-code linking and tutor approval.

**Phase 2 — The tree.** Subject catalogue seed. Syllabus PDF upload → parse → review → commit. Subject/paper/chapter UI with progress toggles and `Not taught`.

**Phase 3 — Routine.** Photo upload → parse → editable grid → commit. Alias capture on correction. Syllabus cross-check warnings.

**Phase 4 — Assessments.** Scheduled-test date assign/edit/postpone. Manual result entry with conversion. Results list and charts.

**Phase 5 — Scan.** `scan_jobs` / `scan_pages`. Student camera capture in page order, multi-image parse in one call, the ellipse ladder (§5.3), verification modal, attach-paper-later, duplicate detection. No batch queue — one assessment at a time.

**Phase 6 — Notifications.** `alerts` / `confirm_tokens` / `email_log`, the window engine (§7.3's occurrence computation, distinct-evenings cap, and the close reasons computed there), a cancellation trigger and §7.6's anon-callable confirmation RPC, `/c/<token>`, three email templates over SMTP, and the nightly run behind the bearer-protected cron route.

**Phase 7 — Tutor dashboard and cross-cutting polish.** The roster and per-student drill-down (§8), a semester reconciliation view, the PWA manifest and installability, and route-level error/empty-state handling throughout — every screen that can throw or render blank has a specific, on-brand fallback instead of a generic crash page.

Ship Phases 1–4 before touching Gemini. A working manual tracker is genuinely useful; a half-built OCR pipeline is not.

---

## 10. Assumptions and open items

Flagged rather than silently decided:

1. **A subject that splits into two papers taught in the same periods** (e.g. a standard and an additional/advanced version of the same subject) is modelled as two papers under one subject, not two subjects — the routine never distinguishes them, so paper selection has to happen at result-logging time instead.
2. **A subject offered in two levels with different teachers and separate syllabus entries** is modelled as two entirely separate subjects, not two papers of one — the routine and syllabus both already treat them as unrelated.
3. **Larger exams (semester, mid-term, final) are out of scope for v1.** If added later, they need their own type and a countdown, not a reuse of the scheduled-test type.
4. **The scheduled-test conversion scale is assumed fixed**, mirroring the surprise-marking conversion at a different total. Confirm against a real sample before relying on it.
5. **Prediction is rule-based in v1** (chapter completion → a window of the next 4 class occurrences, §7.3). A learned per-subject lag model is deliberately deferred, but §7.6 captures the training data from day one.
6. **The scheduled-test paper's header format is treated as unvalidated** until a real sample has actually been seen — §5.3 is written and confirmed against the surprise-marking template specifically. Get a real sample before hardening header extraction for the other format, rather than guessing at the layout.
7. **Handwritten name transcription is not guaranteed stable run to run** — the same handwriting can transcribe an ambiguous internal letter two different ways on two different calls. §5.3's name-mismatch check is not loosened to absorb this: the same looseness that would tolerate a spelling variant would also let a genuinely wrong student's paper slip through unflagged, and catching that is the actual point of the check. Treated as an accepted characteristic of OCR-based name matching, not a bug to fix by weakening it.
8. **A link-prefetching mail client can spend a confirm token before a person sees it.** §7.6's "one tap" is implemented as the answer travelling in the query string — `/c/<token>?a=yes` — and landing on that URL records it. That is what makes the tap *one* tap; a page that landed on a question and asked for a second tap would cost the same interactions as opening the app, and the whole point of §7.6 is to be cheap enough that nobody resents answering. The exposure is that some clients follow links in mail for automated scanning, which would burn the single-use token and record an answer nobody gave. Not designed around, because every fix costs the second tap. If it turns out to bite in practice, the cheapest mitigation that keeps one tap is to have the RPC ignore requests carrying a known scanner user-agent, not to add a confirmation step.
9. **A reconciliation view's "what the school's portal says" column is deliberately not persisted.** The portal has no API to read that figure from, and it only ever exists as whatever the tutor reads off their own screen at the meeting. Storing it durably would mean either a new tutor-writable column (a new write surface beyond the tutor's one existing write, correcting a result) or a guess at the portal's figure format (percentage? letter grade? raw score out of some paper-specific total the app never saw?) with no real example to build against. Left as in-memory, typed-in-during-the-meeting state, gone on refresh, until there's a real answer to the format question.

---

## 11. Design system

Reference direction: soft pastel dashboard, generous whitespace, white cards floating on a tinted wash, one near-black accent carrying all emphasis. Calm and legible — a teenager and their parent both read this.

**No emoji anywhere.** Not in headings, empty states, buttons, or email templates. Icons only.

### Color

```
--wash          #EDF8F1 → #DCF0E4    page background, 160deg linear gradient
--shell         #FFFFFF              main app container
--surface       #FFFFFF              cards
--surface-sunk  #F5F8F6              recessed content column
--ink           #0E1A14              headings, active pill, tooltips
--body          #3B4A42              body text
--muted         #8A9A92              captions, axis labels, inactive nav
--hairline      #E6EFE9              borders, gridlines
--accent        #1B7A50              rings, links, selected dates, left bars
```

Tint fills for stat cards, in rotation: `#DCF0E2` mint, `#E6F1D9` sage, `#D6EDEA` teal.

Chart series, in order: `#1B7A50`, `#54BE8A`, `#9BDCB8`. Area fill under a line: `rgba(84,190,138,.22)` → transparent, 180deg.

Dark mode: `--wash #0B1310`, `--shell #111C17`, `--surface #16241D`, `--ink #E9F3ED`, `--body #C3D4CA`, `--muted #8CA398`, `--hairline #22352C`, `--accent #5FD79A`. The active nav pill inverts — accent fill, `#0B1310` text.

The near-black pill is the signature. Keep everything around it quiet; do not add a second competing accent.

### Type

- Display and headings: **Outfit**, 600
- Body, labels, and all numerals: **Inter**, 400/500
- Both via the framework's font loader. Marks and percentages use tabular numerals so columns align.

Scale: greeting 24/600 · card title 17/600 · stat label 20/600 · body 14/400 · caption, axis, date 12/400 muted. Sentence case throughout — no title case, no all-caps.

### Shape and depth

Radii: app shell 28 · card 20 · tint card 16 · button 12 · pill 999.
Shadows are nearly absent: a 1–2px near-black shadow at very low opacity, slightly heavier on elevated elements. Separation comes from the wash behind white cards, never from heavy borders.
Spacing on a 4px base. Card padding 20. Grid gap 20.

### Layout

Three breakpoints:

- **≥1024px** — a fixed sidebar, flexible main column, and a right rail, all inside one rounded white shell floating on the wash.
- **640–1023px** — sidebar collapses to an icon rail, right rail drops below main.
- **<640px** — single column, bottom tab bar, no shell. See Mobile below.

Build every screen mobile-first. Two of the three roles reach this app primarily on a phone.

### Components

**Sidebar** — avatar, name, email. 44px nav rows, icon plus label. Active row is a filled `--ink` pill, white icon and label. Inactive is `--muted`. Log out pinned to the bottom above a hairline.

**Stat card** — tinted fill, circular progress ring on the left (SVG, 4px stroke, track at 12% opacity), small muted date above a large label. Used for the three most recent results.

**Chart card** — white, title top-left, monotone smooth lines, horizontal gridlines only in `--hairline`, no vertical rules, no axis borders. Tooltip is an `--ink` pill, radius 10, white 12/600 text, small pointer.

**Timeline** — time gutter in muted 12. Each entry is a tinted card with a 3px full-height rounded bar in `--accent` on its left edge, a clock icon and time row at 12, title 14/600, description 12 muted. This is the shape the daily class routine renders in.

**Calendar** — 7-column grid, 32px days, weekends muted, selected day a filled `--accent` circle with white text. Marked dates get a small accent dot beneath the numeral.

**Buttons** — primary is `--ink` fill, white 14/600 label, 40px tall, radius 12, optional 16px leading icon. Secondary is white with a hairline border. Destructive is reserved for delete only. Icon-only buttons are 44×44, radius 14, white, hairline border.

**Inputs** — 44px, radius 12, hairline border, `--accent` focus ring at 2px. Search is a pill with the magnifier trailing.

### Mobile

The phone is not a shrunken desktop here. The student scans papers on a phone the moment a paper comes back, and the guardian arrives from an email link and may never see a desktop at all.

**Shell dissolves.** No rounded container on mobile — cards sit directly on the wash with a 12px gutter, radius 20. Greeting drops to 20/600, card padding 16, captions 13.

**Bottom tab bar**, max five items, 56px tall plus the device's safe-area inset. Icons at 20 with an 11px label; active item takes `--accent`, not the black pill (a filled pill is too heavy at this size).

- Student: Home · Subjects · **Scan** · Results · More
- Tutor: Students · Results · More
- Guardian: no tab bar — three views behind a top segmented control

Scan sits centre as a raised `--ink` circle overlapping the bar, **on the student's bar only**. It is the one action that must never take more than one tap to reach. The tutor has no scan affordance anywhere.

**Stack order is not the desktop order.** On a phone, what matters is what happens tomorrow — put it above the fold and push analytics down:

1. Coming up (tomorrow, then day after)
2. Today's periods, horizontally scrollable
3. Latest results — the three stat cards as a snap-scrolling carousel
4. Progress chart, last

**Charts must be rebuilt, not resized.** Many weeks across many subjects is unreadable at phone width. On mobile, show one subject at a time behind a horizontally scrolling chip selector, a short recent window only. Tooltips are tap-to-pin, never hover. If a chart still feels cramped, fall back to a list of subject rows with a sparkline and the latest mark — a legible list beats an illegible graph.

**Tables become cards.** The tutor roster is one card per student: name, tomorrow's load, unlogged count, trend arrow. The unlogged count is the point of the screen — the tutor's job here is noticing what the student hasn't logged, not logging it himself. No horizontal scrolling of table rows, ever.

**Scan flow, phone-first:**
- Capture straight from the camera, not a file picker.
- Multi-page is capture → thumbnail strip → *Add page* → *Done*. Pages stay in capture order; that order is what groups them, so the strip carries a *same paper / new paper* toggle.
- A parse in review lives in `scan_jobs`, not React state. Launching the camera can evict the tab; the review screen must be resumable.
- The review screen cannot be side-by-side. Thumbnail strip pinned at the top (tap to open full-screen zoom), fields scrolling beneath, a sticky *Save result* bar at the bottom that stays above the keyboard.
- Mark fields use `inputmode="numeric"`. Low-confidence fields keep their highlight and scroll into view when focused.

**Chapter progress** is an accordion by subject, collapsed by default — a dozen or more subjects of open lists is unusable. Each chapter row is a full-width three-segment control: 0 / 80 / 100.

**Modals are bottom sheets.** Full-screen only for scan review and image zoom.

**Email deep links** land on a standalone full-screen page with no nav chrome and no login — `/c/<token>` shows one clear confirmation state and nothing else. That page is the guardian's most common entry point; treat it as a real screen, not a redirect.

**Targets and reach:** 48px minimum tap target, 8px minimum gap between adjacent targets, primary actions in the lower half of the screen.

**Weight matters on the mobile data this is built around.** Lazy-load the charting library so it never ships to routes without a chart, compress images client-side before upload, and skeleton-load cards rather than blocking the screen.

**PWA:** manifest with a `standalone` display mode, a `theme-color` matching the wash, an apple-touch-icon, and an add-to-home-screen prompt shown to guardians after their first visit.

### Screen mapping

- **Student dashboard** — three stat cards (latest three results as percentage rings) · "Your progress" line chart, percentage by week, one series per subject · "Coming up" list. Right rail: month calendar with test dates marked, then today's periods as the timeline.
- **Guardian** — identical shell, every action control removed. Reading only.
- **Tutor** — table-first. The student roster replaces the stat cards, sorted by unlogged count. Primary actions are drilling into a student and correcting a logged result.

### Copy

Active voice, sentence case, plain verbs. A control says exactly what it does — "Save result", not "Submit" — and keeps that name through the flow, so "Save result" produces "Result saved".

Errors state what happened and what to do next; they do not apologise or hedge. Empty states are invitations, not decoration: "No results yet. Scan a paper to start tracking." Never name the system's internals — a person tracks assessments, not rows.

### Quality floor

Responsive to mobile, visible keyboard focus rings, `prefers-reduced-motion` respected, all text meeting AA contrast on both themes. Animation is limited to hover states and page-load fades — no scroll-triggered effects.
