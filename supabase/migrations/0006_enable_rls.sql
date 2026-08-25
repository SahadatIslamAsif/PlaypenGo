-- 0006 — enable RLS, fail closed (SPEC.md §3.3)
--
-- This migration grants nothing. It turns RLS on for all eleven tables that
-- exist as of 0005 and strips `anon` of every table privilege. With RLS on and
-- no policy present, Postgres denies every row to every non-bypassing role, so
-- the schema is closed here and reopened deliberately in 0007 and 0008.
--
-- SCOPE — this covers the eleven tables created in 0002 and 0005 only:
--
--   profiles              tutor_allowlist       link_codes
--   link_code_attempts    guardian_links        tutor_links
--   subjects_catalog      student_subjects      subject_papers
--   chapters              subject_aliases
--
-- DEFERRED, and deliberately not stubbed here:
--
--   * `assessments`, `results`, `result_images` (§3.2) do not exist yet — they
--     land in Phase 4. §3.3 gives tutors INSERT/UPDATE on exactly those three
--     tables, so `can_log_for()` from 0003 has no caller until then. It is left
--     in place rather than dropped: it is correct, tested by 0009's fixture, and
--     the Phase 4 migration is where it starts being used.
--   * `routines`, `routine_periods`, `alerts`, `confirm_tokens`, `email_log`
--     (§3.2) likewise do not exist yet.
--   * Storage bucket policies. §3.3 requires private buckets with signed-URL
--     access, and `storage_owner()` in 0003 exists to support them, but no
--     bucket is created before the routine upload of Phase 3. The bucket and its
--     policies must ship in the same migration — a bucket that exists for even
--     one deploy without policies is a public archive of a child's exam scripts.
--
-- Every table added after this migration must enable RLS in the same migration
-- that creates it. That rule is asserted by a test in 0009, which fails if any
-- table in `public` is left with RLS off, so this cannot be forgotten silently.

-- ------------------------------------------------------------------ 0002 ---

alter table public.profiles            enable row level security;
alter table public.tutor_allowlist     enable row level security;
alter table public.link_codes          enable row level security;
alter table public.link_code_attempts  enable row level security;
alter table public.guardian_links      enable row level security;
alter table public.tutor_links         enable row level security;

-- ------------------------------------------------------------------ 0005 ---

alter table public.subjects_catalog    enable row level security;
alter table public.student_subjects    enable row level security;
alter table public.subject_papers      enable row level security;
alter table public.chapters            enable row level security;
alter table public.subject_aliases     enable row level security;

-- FORCE is deliberately not used. It would subject the table owner to RLS too,
-- and handle_new_user(), issue_link_code() and redeem_link_code() are SECURITY
-- DEFINER functions that run as the owner and must reach rows no policy exposes
-- (a signup writing the very profile row the policies are about to key on).

-- --------------------------------------------------------------- privileges ---
--
-- RLS filters rows; GRANT decides whether the statement runs at all. Both are
-- needed: Supabase's default privileges hand `anon` and `authenticated` full
-- DML on new tables in `public`, so without this block an unauthenticated
-- request reaches the policy layer and is denied only by RLS. Defence in depth —
-- take the privilege away as well.
--
-- Nothing in Phase 1 is reachable without a session. §7.6's `/c/<token>`
-- confirmation page is genuinely anonymous, but it is Phase 6 and is served by
-- the cron route's service-role client, never by `anon` over PostgREST.

revoke all on all tables in schema public from anon;

alter default privileges in schema public revoke all on tables from anon;
