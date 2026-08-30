-- 0025 — the notification engine's tables (ARCHITECTURE.md §3.2, §3.3, §7; 0025 migration)
--
-- These three tables are unusual in this schema: they are the first that no
-- signed-in role may write at all. Everything else a student owns, they own on
-- every verb. Here the engine is the only author, and the only thing standing
-- between a student and their own prediction record is the absence of a policy
-- plus a withheld GRANT.
--
-- So the assertions divide into four groups:
--
--   * The blackout is structural, not incidental. No write policy exists on any
--     of the three, `authenticated` holds no write privilege, and
--     `confirm_tokens` has no policy of any kind — reading a live token is
--     equivalent to being able to answer it, so SELECT is withheld too.
--   * The read side is scoped to two different predicates on purpose.
--     `alerts` is can_read_student() (§1's "full transparency" covers the
--     prediction as much as the mark); `email_log` is the recipient alone,
--     because a guardian's digest is the guardian's mail and the student has no
--     standing in it. A single predicate for both would be wrong in one
--     direction or the other.
--   * §3.2's two keys actually bite: `unique (assessment_id, target_date,
--     kind)` is what makes a cron double-fire produce one row, and
--     `unique (recipient_id, send_date, email_type)` is what makes it send one
--     email. §7.1 puts the cost of getting this wrong plainly — the app gets
--     "muted in week two".
--   * The pairing and shape constraints hold: a spent token has an answer and
--     an answered token is spent, a token is long enough to be worth the
--     entropy claim, and a token can only ever hang off a 'confirm' alert.
--
-- Run against a local stack:
--
--     supabase db reset
--     supabase test db

begin;

set search_path = public, extensions, tests;

select plan(34);

-- ------------------------------------------------------------- test names ---

create or replace function tests.uid(p_who text)
returns uuid
language sql
immutable
as $fn$
  select case p_who
    when 'tutor'       then '00000000-0000-4000-a000-000000000001'
    when 'student_a'   then '00000000-0000-4000-a000-000000000002'
    when 'guardian_a'  then '00000000-0000-4000-a000-000000000003'
    when 'student_b'   then '00000000-0000-4000-a000-000000000004'
    when 'guardian_c'  then '00000000-0000-4000-a000-000000000006'
    when 'physics_a'   then '00000000-0000-4000-b000-000000000001'
    when 'physics_b'   then '00000000-0000-4000-b000-000000000003'
    -- fixtures created below
    when 'cwm_a'       then '00000000-0000-4000-9000-000000000001'
    when 'cwm_b'       then '00000000-0000-4000-9000-000000000002'
    when 'alert_a1'    then '00000000-0000-4000-9000-000000000011'
    when 'alert_a_adv' then '00000000-0000-4000-9000-000000000012'
  end::uuid;
$fn$;

grant execute on function tests.uid(text) to authenticated, anon;

-- ===========================================================================
-- 1. The blackout is structural
-- ===========================================================================

select is(
  (select count(*) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('alerts', 'confirm_tokens', 'email_log')
      and c.relrowsecurity),
  3::bigint,
  'RLS is enabled on all three engine tables'
);

-- The strongest form the rule can take: with RLS on and no policy matching, a
-- write is refused outright rather than filtered to zero rows.
select is_empty(
  $$ select tablename || '.' || policyname
       from pg_policies
      where schemaname = 'public'
        and tablename in ('alerts', 'confirm_tokens', 'email_log')
        and cmd <> 'SELECT' $$,
  'no INSERT, UPDATE or DELETE policy exists on any engine table'
);

select is_empty(
  $$ select policyname from pg_policies
      where schemaname = 'public' and tablename = 'confirm_tokens' $$,
  'confirm_tokens has no policy at all - not even SELECT'
);

-- Belt and braces, and the one that actually stops a determined client: even if
-- a policy were added by mistake, `authenticated` holds no write privilege.
select is_empty(
  $$ select table_name || '.' || privilege_type
       from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name in ('alerts', 'confirm_tokens', 'email_log')
        and grantee = 'authenticated'
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE') $$,
  'authenticated holds no write privilege on any engine table'
);

select is_empty(
  $$ select table_name from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'confirm_tokens'
        and grantee in ('authenticated', 'anon') $$,
  'and no privilege of any kind on confirm_tokens'
);

-- The engine's own access. 0024 learned this the hard way: service_role
-- bypasses RLS but not GRANT, so a missing grant here is a cron that fails at
-- 20:00 with a permission error and no digest.
select is(
  (select count(distinct table_name) from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('alerts', 'confirm_tokens', 'email_log')
      and grantee = 'service_role' and privilege_type = 'INSERT'),
  3::bigint,
  'service_role can insert into all three - the engine is the only author'
);

-- ===========================================================================
-- 2. The two read predicates are different on purpose
-- ===========================================================================

select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'alerts'
      and cmd = 'SELECT' and coalesce(qual, '') like '%can_read_student%'),
  1::bigint,
  'alerts SELECT is can_read_student - the guardian and tutor see the prediction'
);

select is_empty(
  $$ select policyname from pg_policies
      where schemaname = 'public' and tablename = 'email_log'
        and coalesce(qual, '') ~ '(can_read_student|is_tutor_of|is_guardian_of)' $$,
  'email_log SELECT is NOT can_read_student - a digest is the recipient''s own mail'
);

-- ===========================================================================
-- 3. Fixtures — two unrelated CWM windows, one per family
-- ===========================================================================

insert into public.assessments
  (id, student_id, student_subject_id, type, status, created_by)
values
  (tests.uid('cwm_a'), tests.uid('student_a'), tests.uid('physics_a'),
   'CWM', 'predicted', tests.uid('student_a')),
  (tests.uid('cwm_b'), tests.uid('student_b'), tests.uid('physics_b'),
   'CWM', 'predicted', tests.uid('student_b'));

insert into public.alerts
  (id, student_id, assessment_id, kind, target_date, sent_count, last_sent_at)
values
  (tests.uid('alert_a1'), tests.uid('student_a'), tests.uid('cwm_a'),
   'confirm', date '2026-09-01', 1, now()),
  (tests.uid('alert_a_adv'), tests.uid('student_a'), tests.uid('cwm_a'),
   'advance', date '2026-09-01', 1, now()),
  (gen_random_uuid(), tests.uid('student_b'), tests.uid('cwm_b'),
   'confirm', date '2026-09-01', 1, now());

-- ===========================================================================
-- 4. §3.2's keys, and the constraints around them
-- ===========================================================================

-- The idempotency guard §7.2 leans on: "rely on email_log's unique constraint
-- to make double-firing harmless" - the same argument applies one level down,
-- to the alert rows a second firing would otherwise duplicate.
select throws_ok(
  $$ insert into public.alerts (student_id, assessment_id, kind, target_date)
     values ('00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-9000-000000000001', 'confirm', date '2026-09-01') $$,
  '23505', NULL,
  'a second alert for the same occurrence x kind is rejected - §3.2''s key'
);

-- ...but the same occurrence in a different kind is exactly what §7.3's
-- two-evening pattern needs, and must still be allowed.
select lives_ok(
  $$ insert into public.alerts (student_id, assessment_id, kind, target_date)
     values ('00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-9000-000000000001', 'night_before', date '2026-09-01') $$,
  'a different kind on the same occurrence is fine - advance and night_before coexist'
);

select throws_ok(
  $$ insert into public.alerts (student_id, assessment_id, kind, target_date)
     values ('00000000-0000-4000-a000-000000000004',
             '00000000-0000-4000-9000-000000000001', 'confirm', date '2026-09-02') $$,
  '23503', NULL,
  'an alert cannot name another student''s assessment - the composite FK'
);

select throws_ok(
  $$ insert into public.alerts (student_id, assessment_id, kind, target_date)
     values ('00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-9000-000000000001', 'reminder', date '2026-09-02') $$,
  '23514', NULL,
  'kind is limited to §3.2''s four values'
);

-- ------------------------------------------------------------ confirm_tokens ---

select lives_ok(
  $$ insert into public.confirm_tokens (token, alert_id)
     values ('abcdefghijklmnopqrstuvwxyz0123456789',
             '00000000-0000-4000-9000-000000000011') $$,
  'a token hangs off a confirm-kind alert'
);

select throws_ok(
  $$ insert into public.confirm_tokens (token, alert_id)
     values ('zyxwvutsrqponmlkjihgfedcba9876543210',
             '00000000-0000-4000-9000-000000000012') $$,
  '23503', NULL,
  'but never off an advance-kind one - §3.2''s "the occurrence''s confirm-kind row"'
);

select throws_ok(
  $$ insert into public.confirm_tokens (token, alert_id)
     values ('tooshort', '00000000-0000-4000-9000-000000000011') $$,
  '23514', NULL,
  'a token under 32 chars is rejected - the entropy floor on the one unauthenticated entry point'
);

select throws_ok(
  $$ insert into public.confirm_tokens (token, alert_id, used_at)
     values ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
             '00000000-0000-4000-9000-000000000011', now()) $$,
  '23514', NULL,
  'a token cannot be spent without an answer'
);

select throws_ok(
  $$ insert into public.confirm_tokens (token, alert_id, answer)
     values ('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
             '00000000-0000-4000-9000-000000000011', 'yes') $$,
  '23514', NULL,
  'nor answered without being spent - both or neither'
);

select throws_ok(
  $$ insert into public.confirm_tokens (token, alert_id, used_at, answer)
     values ('cccccccccccccccccccccccccccccccccccc',
             '00000000-0000-4000-9000-000000000011', now(), 'maybe') $$,
  '23514', NULL,
  'and the answer is yes or no - §7.6 offers exactly two taps'
);

-- --------------------------------------------------------------- email_log ---

insert into public.email_log (recipient_id, send_date, email_type, subject_line, status)
values
  (tests.uid('student_a'), date '2026-08-29', 'digest_student',
   'Tomorrow: Physics CWM likely', 'sent'),
  (tests.uid('guardian_a'), date '2026-08-29', 'digest_guardian',
   'Tomorrow: Physics CWM likely', 'sent');

select throws_ok(
  $$ insert into public.email_log (recipient_id, send_date, email_type, status)
     values ('00000000-0000-4000-a000-000000000002', date '2026-08-29',
             'digest_student', 'sent') $$,
  '23505', NULL,
  '§7.2''s idempotency guard: one person, one day, one type - a double-fire is harmless'
);

-- §7.1: "If every section is empty, nothing is sent." The row still gets
-- written, so an empty evening is distinguishable from a cron that never fired.
select lives_ok(
  $$ insert into public.email_log (recipient_id, send_date, email_type, status)
     values ('00000000-0000-4000-a000-000000000002', date '2026-08-30',
             'digest_student', 'skipped_empty') $$,
  'skipped_empty is a recordable outcome, not an absence of a row'
);

select throws_ok(
  $$ insert into public.email_log (recipient_id, send_date, email_type, status)
     values ('00000000-0000-4000-a000-000000000002', date '2026-08-31',
             'digest_student', 'bounced') $$,
  '23514', NULL,
  'status is limited to §3.2''s three values'
);

-- ===========================================================================
-- 5. Who reads what
-- ===========================================================================

select tests.login_as(tests.uid('student_a'));

select is(
  (select count(*) from public.alerts),
  3::bigint,
  'the student sees their own three alerts and nobody else''s'
);

select tests.login_as(tests.uid('guardian_a'));

select is(
  (select count(*) from public.alerts),
  3::bigint,
  'their approved guardian sees the same three - §1''s full transparency'
);

select tests.login_as(tests.uid('tutor'));

select is(
  (select count(*) from public.alerts),
  4::bigint,
  'the tutor sees both his students'' windows - three of A''s and one of B''s'
);

select tests.login_as(tests.uid('student_b'));

select is(
  (select count(*) from public.alerts where student_id = tests.uid('student_a')),
  0::bigint,
  'an unrelated student sees none of student A''s'
);

select tests.login_as(tests.uid('guardian_c'));

select is(
  (select count(*) from public.alerts),
  0::bigint,
  'and a PENDING guardian sees nothing at all - §1 step 4 gates on approval'
);

-- The write blackout, probed rather than only asserted structurally above.
select tests.login_as(tests.uid('student_a'));

select throws_ok(
  $$ insert into public.alerts (student_id, assessment_id, kind, target_date)
     values ('00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-9000-000000000001', 'confirm', date '2026-10-01') $$,
  '42501', NULL,
  'the student cannot forge an alert for their own assessment - permission, not policy'
);

select throws_ok(
  $$ update public.alerts set sent_count = 0 $$,
  '42501', NULL,
  'nor rewrite one that exists'
);

-- ------------------------------------------------------------ email_log reads ---

select is(
  (select count(*) from public.email_log),
  2::bigint,
  'the student sees only their own mail - their two rows, not the guardian''s'
);

select is_empty(
  $$ select id from public.email_log
      where recipient_id = '00000000-0000-4000-a000-000000000003' $$,
  'the guardian''s digest is not readable by the student it is about'
);

select tests.login_as(tests.uid('guardian_a'));

select is(
  (select count(*) from public.email_log),
  1::bigint,
  'and the guardian sees their own, not the student''s'
);

-- ------------------------------------------------------------------- anon ---

select tests.login_as_anon();

select throws_ok(
  $$ select count(*) from public.alerts $$,
  '42501', NULL,
  'anon reaches none of it - /c/<token> goes through 0026''s definer RPC instead'
);

-- ===========================================================================
-- 6. Cascades — the window dies with the assessment it watched
-- ===========================================================================

select tests.logout();

delete from public.assessments where id = tests.uid('cwm_a');

select is(
  (select count(*) from public.alerts where assessment_id = tests.uid('cwm_a')),
  0::bigint,
  'deleting an assessment takes its whole window with it'
);

select is(
  (select count(*) from public.confirm_tokens),
  0::bigint,
  'and the tokens hanging off those alerts go too - no orphan answerable links'
);

select * from finish();

rollback;
