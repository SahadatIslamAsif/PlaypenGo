-- 0025 — the notification engine's three tables (ARCHITECTURE.md §3.2, §3.3, §7; Phase 6)
--
-- §3.2 has described `alerts`, `confirm_tokens` and `email_log` since v1.0 of
-- the spec and the database has never had any of them. 0020 already closed the
-- half of that gap it could reach on its own — `window_closed_at` /
-- `window_close_reason` on `assessments`, plus the two triggers that maintain
-- them — deliberately, so that "Phase 6 only has to open them". This is the
-- other half: the rows the engine writes as a window runs.
--
-- The whole model in four sentences, because the table shapes below only make
-- sense against it (§7.3):
--
--   * A window is not a row. It is the set of `alerts` rows sharing one
--     `assessment_id`. There is no window table and there must not be one —
--     its only genuinely window-wide fact, the terminal state, already lives
--     on `assessments` where 0020 put it.
--   * An occurrence is a `target_date`: one class day the window is watching.
--     A CT window has exactly one; a CWM window has four, read off the routine.
--   * `unique (assessment_id, target_date, kind)` is the entire key. §3.2 is
--     explicit — "one row per occurrence × kind, never one row for a whole
--     window".
--   * Rows appear as occurrences are *reached*, not up front. §7.3: an
--     occurrence whose evening was claimed by a sibling "simply isn't
--     represented until it needs to be". That is why nothing here can be used
--     to count how far a window has got — §7.3 requires `window_exhausted` to
--     be re-derived from the routine instead, and 0026 does exactly that.
--
-- ---------------------------------------------------------------------------
-- Who writes these
--
-- The cron route, under the service-role key, and nothing else. That is not a
-- convention here, it is CLAUDE.md's hard rule ("Service-role key is used only
-- inside the cron route"), and it decides every policy below: these tables get
-- SELECT policies for the people entitled to *read* what the engine decided,
-- and no INSERT/UPDATE/DELETE policy anywhere. A student cannot mark their own
-- CWM as alerted; a tutor cannot fabricate a digest entry.
--
-- The one exception is §7.6's Yes/No tap, which arrives with **no login at
-- all** and therefore has no `auth.uid()` to police. It cannot use the
-- service-role key either — same hard rule, and a route that could would put
-- that key one URL-parsing bug away from the client. 0026 answers it with an
-- anon-callable SECURITY DEFINER RPC instead: the token is the capability, the
-- same shape 0004 gave `redeem_link_code`. Hence `confirm_tokens` below has
-- RLS enabled and no policies whatsoever — not even SELECT.

-- ------------------------------------------------------------------- alerts ---

create table public.alerts (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.profiles (id) on delete cascade,
  assessment_id uuid not null,

  -- §3.2's four kinds. The first two are §7.3's two-evening pattern; 'confirm'
  -- is §7.6's "Did this happen?" row, created once an occurrence's target_date
  -- has passed; 'unlogged' is §7.4 section 6, an assessment confirmed as having
  -- happened with no result after two days.
  kind text not null check (kind in ('advance', 'night_before', 'confirm', 'unlogged')),

  -- §3.2: "the one occurrence (class day) this row is about". Never the day the
  -- email went out — that is `last_sent_at`, and for an 'advance' row the two
  -- differ by two days by construction.
  target_date date not null,

  -- `sent_count` exists because a row can legitimately be re-sent: 'unlogged'
  -- repeats nightly until the paper is logged. The two-evening kinds increment
  -- it to 1 and stop, since their evening is claimed exactly once (below).
  sent_count   int not null default 0 check (sent_count >= 0),
  last_sent_at timestamptz,

  created_at timestamptz not null default now(),

  -- §3.2's key, verbatim. This is also the upsert target for every send: the
  -- engine writes `on conflict (assessment_id, target_date, kind) do update`,
  -- so a cron double-fire within one evening cannot produce a second row.
  unique (assessment_id, target_date, kind),

  -- The composite-FK anti-drift idiom 0005/0013/0017/0021 use throughout: an
  -- alert can never name another student's assessment, whatever a policy says.
  unique (id, student_id),
  foreign key (assessment_id, student_id)
    references public.assessments (id, student_id) on delete cascade,

  -- Lets `confirm_tokens` pin its FK to a 'confirm' row specifically. §3.2
  -- defines confirm_tokens.alert_id as "the occurrence's 'confirm'-kind alerts
  -- row", and a plain FK to `id` cannot say the second half of that.
  unique (id, kind)
);

-- §7.3's distinct-evenings cap reads exactly this shape:
--   select distinct last_sent_at::date from alerts
--    where assessment_id = X and kind in ('advance','night_before')
--      and last_sent_at is not null
create index alerts_assessment_kind_idx on public.alerts (assessment_id, kind);

-- §7.3's two_no_in_a_row walks the 'confirm' rows of one assessment in
-- target_date order; the digest's own sections scan a student's rows by date.
create index alerts_student_target_idx on public.alerts (student_id, target_date);

-- ----------------------------------------------------------- confirm_tokens ---
--
-- §7.6: "Yes/No links point at /c/<token> — single-use, 7-day expiry, no login
-- required."

create table public.confirm_tokens (
  id       uuid primary key default gen_random_uuid(),
  -- §3.2: "url-safe random, 32+ chars". The length check is a floor on the
  -- entropy of the app's only unauthenticated entry point, enforced where it
  -- cannot be forgotten by a caller.
  token    text not null unique check (length(token) >= 32),

  alert_id uuid not null,
  -- Not a free column: its only permitted value is 'confirm', and it exists so
  -- the composite FK below can require that the alert it points at is a
  -- 'confirm'-kind row. An 'advance' alert has no yes/no question to answer.
  alert_kind text not null default 'confirm' check (alert_kind = 'confirm'),

  expires_at timestamptz not null default now() + interval '7 days',
  used_at    timestamptz,
  answer     text check (answer in ('yes', 'no')),

  created_at timestamptz not null default now(),

  -- An answer without a use is a row nobody can explain, and a use without an
  -- answer is a half-spent token. Both or neither — the same pairing rule 0020
  -- put on window_closed_at / window_close_reason, for the same reason.
  check ((used_at is null) = (answer is null)),

  -- One question per occurrence. §7.3 gives an expired token no second life —
  -- "an occurrence whose confirm token expired unused is skipped entirely" —
  -- so there is no case in which an occurrence is legitimately asked twice, and
  -- two answers for one occurrence would make two_no_in_a_row's ordering
  -- ambiguous. Also the index §7.3's join needs, from the alert side.
  unique (alert_id),

  foreign key (alert_id, alert_kind)
    references public.alerts (id, kind) on delete cascade
);

-- The /c/<token> lookup, and the only query this table has on its hot path.
-- `token` is already unique, so this index exists purely for the partial form:
-- the RPC filters on live tokens, and a spent one need not be scanned.
create index confirm_tokens_live_idx
  on public.confirm_tokens (token)
  where used_at is null;

-- ---------------------------------------------------------------- email_log ---
--
-- §7.2: "rely on email_log's unique constraint to make double-firing harmless."
-- CLAUDE.md states the same thing as a hard rule. cron-job.org and the
-- vercel.json backup can both fire, and Vercel Hobby's own cron "fires anywhere
-- within the hour" (§2) — two sends of one digest is precisely the failure that
-- §7.1 says "gets the app muted in week two".

create table public.email_log (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,

  -- The *local* date in the recipient's timezone (§3.2 defaults Asia/Dhaka),
  -- computed by the caller, never `current_date`. The job runs at 14:00 UTC,
  -- which is already the next day in some zones and the same day in Dhaka; a
  -- server-side default would silently key the guard to the wrong day.
  send_date    date not null,

  email_type   text not null
               check (email_type in ('digest_student', 'digest_guardian', 'digest_tutor')),

  -- §7.4's adaptive subject line, kept so a delivery complaint can be answered
  -- with what was actually sent rather than what the template would render now.
  subject_line text,
  -- The composed sections. Also the audit trail behind "the app said Physics CT
  -- was tomorrow" at a parent meeting.
  payload      jsonb,

  -- §7.1: "If every section is empty, nothing is sent." A 'skipped_empty' row is
  -- how the engine records having looked and found nothing — without it, an
  -- empty evening is indistinguishable from a cron that never fired.
  status text not null check (status in ('sent', 'failed', 'skipped_empty')),

  created_at timestamptz not null default now(),

  -- §3.2's idempotency guard, verbatim.
  unique (recipient_id, send_date, email_type)
);

-- "What happened on tonight's run?" — the operational read. The unique
-- constraint above already serves the per-recipient guard.
create index email_log_date_idx on public.email_log (send_date, status);

-- ---------------------------------------------------------------------- RLS ---
--
-- 0006's rule: a table enables RLS in the migration that creates it, and 0009's
-- suite fails the build if one is forgotten.

alter table public.alerts         enable row level security;
alter table public.confirm_tokens enable row level security;
alter table public.email_log      enable row level security;

-- What the engine decided is readable by everyone entitled to the student's
-- data — §1's "full transparency — no filtering of bad marks" covers the
-- prediction as much as the mark. §7.6's Yes tap "creates a pending-result
-- placeholder that surfaces on the dashboard", and this is the row that
-- placeholder is read from.
create policy alerts_select on public.alerts
  for select to authenticated
  using (public.can_read_student(student_id));

-- No INSERT, UPDATE or DELETE policy on any of these three. The absence is the
-- rule, stated the strongest way RLS can state it: with RLS on and no policy
-- matching, every write is refused rather than merely filtered. The engine
-- reaches them as service_role, which bypasses RLS entirely (and needs the
-- explicit grants below, per 0008's and 0024's note that it does *not* bypass
-- the GRANT system).

-- confirm_tokens gets no policy at all, SELECT included. Reading a live token
-- is equivalent to being able to answer it, so there is no authenticated role
-- that should be able to list them — the guardian who received one already has
-- the only copy that matters, in their inbox.

-- A person may see that they were written to, and what was in it. Scoped to the
-- recipient themselves rather than can_read_student(): a guardian's digest is
-- addressed to the guardian, and the student has no standing to read their
-- parent's mail.
create policy email_log_select_own on public.email_log
  for select to authenticated
  using (recipient_id = (select auth.uid()));

revoke all on public.alerts, public.confirm_tokens, public.email_log
  from authenticated, anon;

grant select on public.alerts    to authenticated;
grant select on public.email_log to authenticated;
-- confirm_tokens: no grant to either role. 0026's RPC is SECURITY DEFINER and
-- reaches the table as its owner.

-- ------------------------------------------------------- service_role grants ---
--
-- 0024's lesson, applied at table-creation time instead of in a migration
-- later: service_role bypasses RLS but not GRANT, and the CLI's role bootstrap
-- hands it TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on new tables — not the four
-- verbs anything actually does. Exactly what the cron route needs, nothing
-- wider.
--
--   alerts         — upsert a row per send, read them back for the caps.
--   confirm_tokens — mint one per 'confirm' alert; read answers for
--                    two_no_in_a_row. Never updated by the engine: the answer
--                    is written by 0026's RPC, as the token's holder.
--   email_log      — claim, then mark sent or failed.
--   assessments    — open a window (insert a predicted CWM) and close one
--                    (§7.5's window_closed_at / window_close_reason).
--   the read side  — everything the digest is composed from.

grant select, insert, update on public.alerts         to service_role;
grant select, insert         on public.confirm_tokens to service_role;
grant select, insert, update on public.email_log      to service_role;
grant select, insert, update on public.assessments    to service_role;

-- Opening a CWM window means inserting the `predicted` assessment *and* linking
-- it to the chapter whose completion triggered it. That link is not
-- bookkeeping: §5.3's on-confirm attach picks between open windows by "a window
-- whose chapter matches the inferred chapter wins", and a window with no
-- chapter link can never win that comparison. 0017 made `assessment_chapters`
-- the only place that link lives — `assessments.chapter_id` was dropped in the
-- same migration.
grant select, insert on public.assessment_chapters to service_role;

grant select on public.profiles            to service_role;
grant select on public.guardian_links      to service_role;
grant select on public.tutor_links         to service_role;
grant select on public.student_subjects    to service_role;
grant select on public.subject_papers      to service_role;
grant select on public.chapters            to service_role;
grant select on public.routines            to service_role;
grant select on public.routine_periods     to service_role;
grant select on public.results             to service_role;
