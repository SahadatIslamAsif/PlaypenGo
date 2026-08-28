# Project instructions

**App name: PlaypenGo.** Real-time assessment tracker for a Playpen School (Dhaka) student, their guardian, and their tutor. The school portal only publishes marks at semester end; PlaypenGo keeps a running record and predicts surprise Class Work Markings from syllabus progress.

Repo/package name: `playpengo`. Use "PlaypenGo" (no space, capital P twice) in UI copy, the PWA manifest, and email subject lines/sender name.

Full build specification: **@docs/SPEC.md** — read the relevant section before implementing a feature. Do not re-derive decisions that are already settled there.

---

## Stack — do not substitute

- Next.js App Router + TypeScript + Tailwind
- **Supabase** for auth, Postgres, storage, RLS. Never Firebase.
- **Gemini Flash** via `@google/genai`, always with a structured response schema. Never parse JSON out of a text response.
- Email via Nodemailer + SMTP. Rendered with `react-email` — inline styles only, Tailwind classes do not survive email clients.
- Icons: `lucide-react`. No other icon set.
- Scheduling: external cron (cron-job.org) hitting a bearer-protected route.

No service workers or web push in v1. Email is the only delivery channel.

## Hard rules

- **Guardians are read-only.** No insert, update, or delete policy on any table, and no edit affordance in their UI.
- **Only the student uploads papers.** Tutors get `SELECT` on linked students plus `UPDATE` on `results` — enough to correct a wrong mark beside the student, never to create one. No insert anywhere, no delete, no access to scan jobs.
- **RLS on every table**, storage buckets private, signed URLs only. This holds a minor's grades and photos of their exam scripts.
- Service-role key is used only inside the cron route. Never reaches the client.
- **One email per person per day, maximum.** Everything folds into the 8:00 PM digest. Nothing sends when all sections are empty.
- Nothing from an AI parse is written to the database without passing through a human review screen. Every extracted field stays editable.
- Marks conversion is the app's job — the teacher always writes the raw score:
  - `CWM: round(obtained / total * 15, 1)`
  - `CT:  round(obtained / total * 25, 1)`
  - Charts always plot percentage so CT and CWM sit on one axis.

## Build order

Phases 1–4 (auth, subject tree, routine, manual assessments) ship before any Gemini work. A manual tracker is already useful; a half-built OCR pipeline is not.

## Free-tier limits to design around

- Vercel Hobby functions default to 10s, raisable to 60s with `maxDuration` (check Vercel's current limits page). A single 3-image Gemini call fits in 60s; the nightly digest still gets chunked, never one long loop.
- Gemini free tier is rate-limited per minute — one call per assessment, sequential, never parallel.
- Supabase free storage is 1 GB — compress images client-side before upload.
- `email_log` has a unique constraint on `(recipient, date, type)`. Cron double-firing must be harmless.

---

# Design system

Reference direction: soft pastel dashboard, generous whitespace, white cards floating on a tinted wash, one near-black accent carrying all emphasis. Calm and legible — a 13-year-old and their parent both read this.

**No emoji anywhere.** Not in headings, empty states, buttons, or email templates. Icons only.

## Color

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

## Type

- Display and headings: **Outfit**, 600
- Body, labels, and all numerals: **Inter**, 400/500
- Both via `next/font`. Marks and percentages use `font-variant-numeric: tabular-nums` so columns align.

Scale: greeting 24/600 · card title 17/600 · stat label 20/600 · body 14/400 · caption, axis, date 12/400 muted. Sentence case throughout — no title case, no all-caps.

## Shape and depth

Radii: app shell 28 · card 20 · tint card 16 · button 12 · pill 999.
Shadows are nearly absent: `0 1px 2px rgba(14,26,20,.04)`, elevated `0 10px 30px rgba(14,26,20,.06)`. Separation comes from the wash behind white cards, never from heavy borders.
Spacing on a 4px base. Card padding 20. Grid gap 20.

## Layout

Three breakpoints:

- **≥1024px** — `sidebar 232px | main flex | right rail 320px`, all inside one rounded white shell floating on the wash.
- **640–1023px** — sidebar collapses to a 72px icon rail, right rail drops below main.
- **<640px** — single column, bottom tab bar, no shell. See Mobile below.

Build every screen mobile-first. Two of the three roles reach this app primarily on a phone.

## Components

**Sidebar** — 56px avatar, name 16/600, email 12 muted. Nav rows 44px, icon 18 at stroke 1.5 plus label. Active row is a filled `--ink` pill, white icon and label. Inactive is `--muted`. Log out pinned to the bottom above a hairline.

**Stat card** — tinted fill, circular progress ring on the left (SVG, 4px stroke, track at 12% opacity), small muted date above a large label. Used for the three most recent results.

**Chart card** — white, title top-left, monotone smooth lines, horizontal gridlines only in `--hairline`, no vertical rules, no axis borders. Tooltip is an `--ink` pill, radius 10, white 12/600 text, small pointer.

**Timeline** — 56px time gutter in muted 12. Each entry is a tinted card with a 3px full-height rounded bar in `--accent` on its left edge, a clock icon and time row at 12, title 14/600, description 12 muted. This is the shape the daily class routine renders in.

**Calendar** — 7-column grid, 32px days, weekends muted, selected day a filled `--accent` circle with white text. CT dates get a small accent dot beneath the numeral.

**Buttons** — primary is `--ink` fill, white 14/600 label, 40px tall, radius 12, optional 16px leading icon. Secondary is white with a hairline border. Destructive is reserved for delete only. Icon-only buttons are 44×44, radius 14, white, hairline border.

**Inputs** — 44px, radius 12, hairline border, `--accent` focus ring at 2px. Search is a pill with the magnifier trailing.

## Mobile

The phone is not a shrunken desktop here. The student scans papers on a phone the moment a khata comes back, and the guardian arrives from an email link and may never see a desktop at all.

**Shell dissolves.** No rounded container on mobile — cards sit directly on the wash with a 12px gutter, radius 20. Greeting drops to 20/600, card padding 16, captions 13.

**Bottom tab bar**, max five items, 56px tall plus `env(safe-area-inset-bottom)`. Icons at 20 with a 11px label; active item takes `--accent`, not the black pill (a filled pill is too heavy at this size).

- Student: Home · Subjects · **Scan** · Results · More
- Tutor: Students · Results · More
- Guardian: no tab bar — three views behind a top segmented control

Scan sits centre as a raised `--ink` circle overlapping the bar, **on the student's bar only**. It is the one action that must never take more than one tap to reach. The tutor has no scan affordance anywhere.

**Stack order is not the desktop order.** On a phone, what matters is what happens tomorrow — put it above the fold and push analytics down:

1. Coming up (tomorrow, then day after)
2. Today's periods, horizontally scrollable
3. Latest results — the three stat cards as a snap-scrolling carousel
4. Progress chart, last

**Charts must be rebuilt, not resized.** Twelve weeks × several subjects is unreadable at 375px. On mobile, show one subject at a time behind a horizontally scrolling chip selector, last 6 weeks only. Tooltips are tap-to-pin, never hover. If a chart still feels cramped, fall back to a list of subject rows with a sparkline and the latest mark — a legible list beats an illegible graph.

**Tables become cards.** The tutor roster is one card per student: name, tomorrow's load, unlogged count, trend arrow. The unlogged count is the point of the screen — the tutor's job here is noticing what the student hasn't logged, not logging it himself. No horizontal scrolling of table rows, ever.

**Scan flow, phone-first:**
- Capture straight from the camera (`accept="image/*"` with `capture="environment"`), not a file picker.
- Multi-page is capture → thumbnail strip → *Add page* → *Done*. Pages stay in capture order; that order is what groups them, so the strip carries a *same paper / new paper* toggle.
- A parse in review lives in `scan_jobs`, not React state. Launching the camera can evict the tab; the review screen must be resumable.
- The review screen cannot be side-by-side. Thumbnail strip pinned at the top (tap to open full-screen zoom), fields scrolling beneath, a sticky *Save result* bar at the bottom that stays above the keyboard.
- Mark fields use `inputmode="numeric"`. Low-confidence fields keep their highlight and scroll into view when focused.

**Chapter progress** is an accordion by subject, collapsed by default — fourteen subjects of open lists is unusable. Each chapter row is a full-width three-segment control: 0 / 80 / 100.

**Modals are bottom sheets.** Full-screen only for scan review and image zoom.

**Email deep links** land on a standalone full-screen page with no nav chrome and no login — `/c/<token>` shows one clear confirmation state and nothing else. That page is the guardian's most common entry point; treat it as a real screen, not a redirect.

**Targets and reach:** 48px minimum tap target, 8px minimum gap between adjacent targets, primary actions in the lower half of the screen.

**Weight matters on Dhaka mobile data.** Lazy-load the charting library so it never ships to routes without a chart, compress images client-side before upload, and skeleton-load cards rather than blocking the screen.

**PWA:** manifest with `name: "PlaypenGo"`, `short_name: "PlaypenGo"`, `display: standalone`, `theme-color` matching the wash, apple-touch-icon, and an add-to-home-screen prompt shown to guardians after their first visit.

## Screen mapping

- **Student dashboard** — three stat cards (latest three results as percentage rings) · "Your progress" line chart, percentage by week, one series per subject · "Coming up" list. Right rail: month calendar with CT dates marked, then today's periods as the timeline.
- **Guardian** — identical shell, every action control removed. Reading only.
- **Tutor** — table-first. The student roster replaces the stat cards, sorted by unlogged count. Primary actions are drilling into a student and correcting a logged result.

## Copy

Active voice, sentence case, plain verbs. A control says exactly what it does — "Save result", not "Submit" — and keeps that name through the flow, so "Save result" produces "Result saved".

Errors state what happened and what to do next; they do not apologise or hedge. Empty states are invitations, not decoration: "No results yet. Scan a paper to start tracking." Never name the system's internals — a person tracks assessments, not rows.

## Quality floor

Responsive to mobile, visible keyboard focus rings, `prefers-reduced-motion` respected, all text meeting AA contrast on both themes. Animation is limited to hover states and page-load fades — no scroll-triggered effects.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
