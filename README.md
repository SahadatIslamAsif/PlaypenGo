# PlaypenGo

> A real-time assessment tracker for a school student, their guardian, and their tutor — scans marked exam papers, predicts surprise class tests from syllabus progress, and sends one plain-language digest every evening.

![version](https://img.shields.io/badge/version-1.0.0-blue)
![license](https://img.shields.io/badge/license-MIT-green)
[![next.js](https://img.shields.io/badge/Next.js-App%20Router-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![typescript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![tailwind](https://img.shields.io/badge/Tailwind-CSS-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
![gemini](https://img.shields.io/badge/Gemini-Flash-4285F4?logo=googlegemini&logoColor=white)

---

## Why & What

- **The problem:** the school portal publishes marks once, at semester end. A guardian finds out in December how October went — long after anything could have been done about it. Class Work Markings are unannounced, so nobody knows a test is coming until it has already happened.
- **What PlaypenGo does:** keeps a running record of every mark from the day it is given, and predicts when the next surprise marking is likely by watching syllabus progress against the class routine.
- **How it stays honest:** nothing an AI extracts reaches the database without passing through a human review screen. Every field stays editable. The app converts raw scores to the school's scales so a teacher only ever writes the mark they actually gave.
- **Who it is for:** one student, their guardian, and their tutor — three roles with genuinely different permissions, not one account shared three ways.

> Building on this? `README.md` holds the working rules for the codebase, and `docs/ARCHITECTURE.md` is the full architecture reference with the reasoning behind each decision.

---

## Tech Stack

| Layer         | Technology                                            |
|---------------|-------------------------------------------------------|
| Framework     | Next.js (App Router), TypeScript                       |
| Styling       | Tailwind CSS, CSS custom properties, `next/font`       |
| Database      | Supabase Postgres with row level security on every table |
| Auth          | Supabase Auth                                          |
| Storage       | Supabase Storage — private buckets, signed URLs only    |
| AI            | Gemini Flash via `@google/genai`, structured output only |
| Email         | Nodemailer over SMTP, templates rendered with `react-email` |
| Icons         | `lucide-react`                                         |
| Scheduling    | External cron hitting a bearer-protected route          |
| Testing       | Vitest (unit), pgTAP (database policies and functions)  |
| Hosting       | Vercel                                                 |

---

## Features

**Three roles, three permission sets**
- **Student** — owns everything. The only role that uploads papers.
- **Guardian** — read-only everywhere. No insert, update or delete policy exists for them on any table, so the UI has no edit affordance because the database would refuse it anyway.
- **Tutor** — reads every linked student and may correct a mark that is already logged. Correcting a wrong mark beside the student is a different act from creating one, and the policies say so.

**Subject tree and routine**
- Subjects, papers and chapters seeded from the semester syllabus
- Class routine captured from a photo of the printed grid, with per-cell correction
- Subject name resolution by exact match, learned aliases, then fuzzy match — the same resolver used for a routine cell and a scanned paper header

**Scan a marked paper**
- Camera capture on a phone, up to five pages in order, compressed client-side before upload
- One Gemini call per paper, all pages in a single request so the model can see that page three belongs to page one's header
- Deterministic resolution afterwards in application code, not by the model
- A review screen where every field is editable and low-confidence fields are highlighted
- Duplicate detection, and an attach-paper-later flow for a mark logged before the khata came back

**Predict surprise markings**
- A chapter reaching completion opens a window on the subject's next scheduled class occurrences
- Each evening the digest asks whether the expected work happened
- A scan confirmed during an open window attaches to it automatically
- Windows close on a logged result, two consecutive no answers, or exhaustion

**One email per person per day**
- Everything folds into a single evening digest — nothing sends when every section is empty
- Guardian, student and tutor each get a different composition
- Confirmation links open a standalone page with no login and no navigation, because that is the guardian's most common entry point
- A unique constraint on `(recipient, date, type)` makes a double-firing cron harmless

**Tutor dashboard**
- Roster sorted by unlogged papers — noticing what has not been recorded is the point
- Per-student drill-down and an end-of-semester reconciliation view

**Quality**
- Mobile-first throughout; two of the three roles reach this app primarily on a phone
- Progressive web app with an add-to-home-screen prompt
- Light and dark themes, both meeting AA contrast
- Error boundaries, loading skeletons, and empty states that distinguish "nothing happened" from "nothing was logged"

---

## How it works

### The scan pipeline

The model reports what it sees. Application code decides what it means.

```
Phone camera
  → compress client-side (long edge ~2000px, EXIF applied)
  → upload to the private scans/ bucket
  → scan_jobs row, status 'uploading' → 'parsing'
       ↓
  Gemini Flash, one call, all pages in order
  Structured response schema — never JSON parsed out of prose
       ↓
  lib/scans/ resolves the parse deterministically
    ladder.ts       the mark: a page-1 ellipse wins outright, else
                    the header blanks, else nothing — never a guess
    grouping.ts     page grouping by upload order, never by header
    centre-line.ts  chapter matching, fuzzy against seeded chapters
    match.ts        attach target, name check, duplicate detection
    confidence.ts   agreement between independent signals, not the
                    model's own uncalibrated score
       ↓
  Human review screen — every field editable, nothing pre-committed
       ↓
  Confirm: one database transaction, then copy scans/ → scripts/,
  then delete the originals last
```

The teacher writes the mark inside a hand-drawn ellipse, as a diagonal fraction. That single observation drives the whole resolution order: the "Obtained marks" blank on the khata template is a form field the teacher often ignores, so the ellipse is authoritative whenever it exists.

### The prediction engine

```
Chapter marked complete
       ↓
Open a window on the subject's next 4 scheduled class occurrences
(derived from the routine, not from the calendar)
       ↓
For each occurrence that passes with no result:
    evening digest asks "did this happen?"
    a token is minted, and only stamped as asked once the email is
    genuinely delivered
       ↓
Window closes when one of these is true:
    result_logged     a result was recorded, scanned or manual
    two_no_in_a_row   two consecutive no answers
    ct_cancelled      a scheduled test was cancelled
    window_exhausted  all occurrences passed, having been asked
    never_reached     occurrences elapsed without anything ever asked
```

The last two are deliberately distinct. Exhaustion means the question was put and went unanswered. If the nightly job never ran — a paused project, a long gap — the window was never reached, and calling that exhaustion would hide an outage behind a normal-looking outcome.

### Marks conversion

The teacher always writes the raw score. Converting is the app's job.

```
CWM:  round(obtained / total * 15, 1)
CT:   round(obtained / total * 25, 1)
```

Charts always plot percentage, so both scales sit on one axis.

`occurred_date` always comes from the paper's header, never from when it was logged. A khata returned four days late files under the day the test happened — otherwise it lands in the wrong week on the chart and the digest reports it as today's news.

---

## Project structure

```
playpengo/
│
├── app/
│   ├── (app)/                    # authenticated shell — sidebar, rail, bottom tabs
│   │   ├── page.tsx              # student dashboard
│   │   ├── subjects/             # subject tree, papers, chapter progress
│   │   ├── routine/              # class routine grid and photo capture
│   │   ├── results/              # results list, charts, manual entry
│   │   ├── scan/                 # capture flow
│   │   │   └── [jobId]/review/   # verification screen
│   │   ├── tutor/                # roster, drill-down, reconciliation
│   │   ├── settings/
│   │   ├── error.tsx             # on-brand error boundary
│   │   └── loading.tsx
│   ├── login/                    # unauthenticated — no role choice
│   ├── signup/                   # student, guardian, tutor — one form each
│   │   ├── student/
│   │   ├── guardian/
│   │   └── tutor/
│   ├── api/
│   │   ├── scan-jobs/[id]/parse/ # the Gemini call, maxDuration 60
│   │   └── cron/                 # nightly digest, bearer-protected
│   ├── c/[token]/                # no-login confirmation page from an email
│   ├── globals.css               # design tokens
│   ├── not-found.tsx
│   └── global-error.tsx
│
├── components/
│   ├── shell/                    # sidebar, bottom tabs, nav items
│   ├── charts/                   # line chart, progress ring, sparkline
│   └── ui/                       # card, button, field, input, select, sheet, skeleton
│
├── lib/
│   ├── scans/                    # the resolution layer — pure, unit-tested
│   │   ├── ladder.ts             # the ellipse ladder
│   │   ├── grouping.ts           # page grouping by upload order
│   │   ├── centre-line.ts        # chapter and type-marker matching
│   │   ├── match.ts              # attach, name, duplicate
│   │   ├── confidence.ts         # agreement-derived highlighting
│   │   ├── storage.ts            # bucket path builders
│   │   ├── actions.ts            # scan job writes, confirm transaction
│   │   └── parse/                # Gemini boundary
│   │       ├── schema.ts         # response schema, drift-guarded
│   │       ├── prompt.ts         # the editable prompt constant
│   │       ├── client.ts         # the one call
│   │       ├── adapt.ts          # wire shape → resolution layer types
│   │       └── cache.ts          # dev-only, keyed by image hash
│   ├── notifications/
│   │   ├── window.ts             # window planning and close reasons
│   │   └── engine.tsx            # nightly run, digest composition
│   ├── email/
│   │   ├── send.ts               # Nodemailer transport
│   │   └── templates.tsx         # student, guardian, tutor digests
│   ├── routines/                 # subject resolution, schedule helpers
│   ├── subjects/                 # subject tree writes
│   ├── tutor/roster.ts           # roster sort, unlogged-count-first
│   ├── assessments/marks.ts      # the conversion above
│   ├── images/compress.ts        # client-side compression
│   ├── linking/actions.ts        # guardian and tutor link approval
│   ├── auth/actions.ts           # login
│   └── supabase/                 # server and browser clients, generated types
│
├── supabase/
│   ├── migrations/               # every schema change, in order
│   ├── tests/                    # pgTAP — policies, triggers, functions
│   ├── seed.sql                  # local fixtures only, never production
│   └── config.toml
│
├── seed/
│   └── subjects.json             # the Cambridge catalogue seed (§4.1)
│
├── scripts/
│   ├── parse-paper.ts            # run the parser against local images
│   ├── check-paper-fixtures.ts   # per-field accuracy against goldens
│   ├── seed-subjects-catalog.ts
│   ├── seed-tutor-allowlist.ts   # allowlist one deployment's tutor email
│   └── generate-icons.tsx
│
├── fixtures/papers/              # hand-written goldens; images gitignored
├── docs/ARCHITECTURE.md          # full architecture reference
└── README.md                     # working rules for the codebase
```

---

## Data model

| Table | Holds |
|-------|-------|
| `profiles` | One row per account, with its role |
| `guardian_links`, `tutor_links` | Approved relationships between accounts |
| `link_codes`, `link_code_attempts` | Time-limited codes for joining a student |
| `subjects_catalog`, `student_subjects`, `subject_papers` | The subject tree |
| `chapters`, `subject_aliases` | Syllabus chapters and learned name variants |
| `routines`, `routine_periods` | The weekly class grid |
| `assessments`, `assessment_chapters` | Every test, predicted or logged, and its chapters |
| `results`, `result_images` | Marks, conversions, and the paper behind each one |
| `scan_jobs`, `scan_pages` | An unconfirmed parse — never React state alone |
| `alerts`, `confirm_tokens`, `email_log` | What was asked, and what was sent |

Three private storage buckets: `routines`, `scans` (pending), `scripts` (confirmed evidence).

---

## Security

This holds a minor's grades and photographs of their exam scripts. The model is restrictive by default.

- **Row level security on every table**, enforced by a pgTAP assertion that fails the build if a new table ships without it
- **Guardians have no write policy anywhere** — the read-only rule is expressed as the absence of a policy, not as a predicate that excludes them
- **Tutors hold exactly one table-level write**: `UPDATE` on `results`. No insert anywhere, no delete
- **Scan jobs and pending pages are student-only.** A tutor or guardian has no policy on them at all
- **Storage buckets are private**, accessed through signed URLs. Pending scans and confirmed scripts are separate buckets because their access rules genuinely differ
- **The service-role key is used only inside the cron route** and never reaches the client
- **Nothing from an AI parse reaches the database** without passing through a human review screen
- **Confirmation tokens are single-use**, and reading one is treated as equivalent to answering it
- Passwords, sessions and email confirmation are handled by Supabase Auth

---

## Prerequisites

- Node.js (version per `package.json`)
- Docker Desktop — the local Supabase stack needs it
- Supabase CLI
- A Gemini API key from Google AI Studio (free tier)
- An SMTP account from a transactional provider

---

## Local setup

**1. Clone and install**

```bash
git clone https://github.com/SahadatIslamAsif/playpengo.git
cd playpengo
npm install
```

**2. Environment**

```bash
cp .env.local.example .env.local
```

| Variable | What it is |
|----------|------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL. Locally, the CLI prints it on start |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses every policy. Server-side only — never prefix with `NEXT_PUBLIC_` |
| `GEMINI_API_KEY` | From Google AI Studio |
| `GEMINI_MODEL` | A current Flash model id. These change; verify it has a free tier row |
| `SMTP_HOST`, `SMTP_PORT` | Provider relay. Port 587 upgrades to TLS; 465 is implicit TLS |
| `SMTP_USER`, `SMTP_PASSWORD` | The provider's SMTP credentials, not an API key |
| `SMTP_FROM` | Must match an address verified with the provider |
| `APP_URL` | Public origin the digest builds confirmation links against. Never `localhost` |
| `CRON_SECRET` | Bearer token the nightly route requires |

**3. Database**

```bash
supabase start
npm run db:reset      # applies every migration, then seed.sql
npm run db:types      # regenerates lib/supabase/database.types.ts
```

**4. Run**

```bash
npm run dev
```

To reach it from a phone on the same network, bind to all interfaces and set `APP_URL` to your machine's LAN address.

---

## Deployment

1. Create a hosted Supabase project, then `supabase link --project-ref <ref>` and `supabase db push`. Do not run `seed.sql` — those are test fixtures.
2. In the Supabase dashboard, set Authentication → Site URL and Redirect URLs to the deployed URL. Account confirmation emails point there.
3. Deploy to Vercel and add every variable above. Set `APP_URL` to the deployed URL and redeploy — Vercel resolves environment variables at build time.
4. Point an external cron service at the nightly route with an `Authorization: Bearer` header, scheduled for 8:00 PM local time.

---

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit suite |
| `npm run db:reset` | Rebuild the local database from migrations and seed |
| `npm run db:test` | pgTAP suite — policies, triggers, functions |
| `npm run db:types` | Regenerate TypeScript types from the live schema |
| `npm run db:seed-catalog` | Seed the shared subjects catalogue |
| `npm run parse:check-fixtures` | Per-field parse accuracy against hand-written goldens |

---

## Testing

Two suites, testing different things.

**Vitest** covers the resolution layer — the ellipse ladder, page grouping, chapter and name matching, confidence derivation, and the window engine's close reasons. These are pure functions with no database and no network, so every rule in the specification has a case with the real sample values behind it.

**pgTAP** covers what the policies actually do. Every role is asserted verb by verb against every table, and both denial shapes are distinguished: an insert refused by a `WITH CHECK` raises, while an update or delete filtered by a `USING` clause is a silent success over zero rows and has to be read back rather than trusted.

**The fixture harness** runs the parser against real photographed papers and reports per-field accuracy, so a prompt change shows which field regressed rather than a single pass or fail. Golden files are written by hand from the physical paper — never generated from the parser's own output, since a golden derived from the thing it tests proves nothing. The images are gitignored; only the goldens are committed.

---

## Free-tier constraints

The app is designed to run entirely on free tiers for one student and their family.

- **Supabase** — 500 MB database, 1 GB storage. At roughly 200 KB per compressed page, storage is the binding limit long before rows are. A free project also pauses after about a week of inactivity, which would silence the nightly job over a long holiday.
- **Gemini** — rate-limited per minute. One scan is one call, and scans are sequential, never parallel.
- **Vercel Hobby** — functions default to a short timeout, raisable via `maxDuration`. The parse route sets it explicitly; the nightly job is chunked rather than run as one long loop.
- **SMTP** — a few hundred emails a day on most free plans. At one email per person per day, that is far more headroom than a family needs.

---

## Known limitations

- No real printed class-test paper has been parsed yet. Header extraction is built against the confirmed handwritten template; a printed test is detected and dropped into the review screen with empty editable fields rather than guessed at.
- Handwritten name transcription varies between runs on identical handwriting, so the name-mismatch warning can fire on a correct paper. It stays a warning and never blocks a save, because the same check is what catches a genuinely wrong student's paper.
- Prediction is rule-based. A learned per-subject lag model is deliberately deferred, though the training data is captured from day one.
- Sending from a shared provider domain without SPF, DKIM and DMARC on an owned domain lands in spam more often.
- Designed around one student, with headroom for a handful. Beyond that, image storage forces a decision first.

---

## Author

**Md Sahadat Islam**<br>
Student — American International University-Bangladesh (AIUB)<br>
Student ID: 22-49395-3<br>
GitHub: [@SahadatIslamAsif](https://github.com/SahadatIslamAsif)

---

## License

MIT © 2026 Md Sahadat Islam — see [LICENSE](LICENSE) for full text.

---

## Screenshots

### Student

**Dashboard**
![Student dashboard](screenshots/student_dashboard.png)

**Subjects and chapter progress**
![Subjects](screenshots/subjects.png)

**Class routine**
![Routine](screenshots/routine.png)

---

### Scanning a paper

**Capture**
![Scan capture](screenshots/scan_capture.png)

**Review screen**
![Scan review](screenshots/scan_review.png)

**Result saved**
![Result saved](screenshots/result_saved.png)

---

### Results

**Results list**
![Results](screenshots/results.png)

**Progress chart**
![Progress chart](screenshots/progress_chart.png)

---

### Tutor

**Roster**
![Tutor roster](screenshots/tutor_roster.png)

**Reconciliation**
![Reconciliation](screenshots/reconciliation.png)

---

### Guardian

**Read-only dashboard**
![Guardian view](screenshots/guardian_view.png)

---

### Email

**Evening digest**
![Evening digest](screenshots/digest_email.png)

**Confirmation page**
![Confirmation page](screenshots/confirm_page.png)
