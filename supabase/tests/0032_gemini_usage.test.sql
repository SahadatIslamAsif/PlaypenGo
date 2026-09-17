-- 0032 — gemini_usage: one global daily counter for the shared Gemini quota
--
-- The one property worth a whole test file over a quick manual check: the
-- counter is per Google project, not per student. Two different
-- authenticated callers on the same day must land on the same row and the
-- same running total, or this table would be silently wrong the moment a
-- second student used the app.
--
-- Run against a local stack:
--
--     supabase db reset
--     supabase test db

begin;

set search_path = public, extensions, tests;

select plan(8);

-- Neither auth.users nor profiles is touched: record_gemini_call() and
-- get_gemini_usage_today() only ever look at auth.uid() from the JWT claims
-- tests.login_as() sets, never at a profiles row - so any UUID does.
create or replace function tests.uid(p_who text)
returns uuid
language sql
immutable
as $fn$
  select case p_who
    when 'student_a' then '00000000-0000-4000-c000-000000000001'
    when 'student_b' then '00000000-0000-4000-c000-000000000002'
  end::uuid;
$fn$;

grant execute on function tests.uid(text) to authenticated, anon;

-- ===========================================================================
-- 1. anon has no reach at all - like link_codes (0004), the only door is
--    the two definer functions, and anon isn't on the grant list for either.
-- ===========================================================================

select tests.login_as_anon();

select throws_ok(
  $$ select public.record_gemini_call() $$,
  '42501', NULL,
  'anon cannot record a call'
);

select throws_ok(
  $$ select public.get_gemini_usage_today() $$,
  '42501', NULL,
  'anon cannot read today''s count either'
);

select tests.logout();

-- ===========================================================================
-- 2. One caller, counted at send - each call increments, nothing is
--    deduplicated or batched.
-- ===========================================================================

select tests.login_as(tests.uid('student_a'));

select is(
  public.record_gemini_call(),
  1,
  'the first call of the day starts the counter at 1'
);

select is(
  public.record_gemini_call(),
  2,
  'a second call from the same caller increments the same row'
);

select is(
  public.get_gemini_usage_today(),
  2,
  'and the read-only peek agrees'
);

select tests.logout();

-- ===========================================================================
-- 3. Global, not per-student - the whole point of this migration. A
--    different authenticated caller lands on the SAME row and continues the
--    SAME running total, because the quota is per Google project.
-- ===========================================================================

select tests.login_as(tests.uid('student_b'));

select is(
  public.record_gemini_call(),
  3,
  'a second student''s call continues the first student''s count rather than starting its own'
);

select is(
  public.get_gemini_usage_today(),
  3,
  'and that student reads the same shared total back, not a total of their own calls'
);

select tests.logout();

-- One row per day, never one per student.
select is(
  (select count(*) from public.gemini_usage)::int,
  1,
  'still exactly one row for today, regardless of how many students called in'
);

select * from finish();

rollback;
