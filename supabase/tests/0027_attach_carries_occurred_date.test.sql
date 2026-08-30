-- 0027 — attaching a result carries its occurred_date through
--
-- The case that shipped broken: a predicted CWM window (§7.3), still open,
-- attached via log_manual_result() with a header date that is genuinely
-- older than the day the test runs. Before 0027, results_mark_assessment_logged()
-- (0020) would coalesce straight to current_date because a predicted window
-- has neither occurred_date nor scheduled_date set. This asserts the
-- submitted date wins, and that it is not merely coincidental with today.
--
-- Run against a local stack:
--
--     supabase db reset
--     supabase test db

begin;

set search_path = public, extensions, tests;

select plan(7);

create or replace function tests.uid(p_who text)
returns uuid
language sql
immutable
as $fn$
  select case p_who
    when 'student_a'  then '00000000-0000-4000-a000-000000000002'
    when 'physics_a'  then '00000000-0000-4000-b000-000000000001'
  end::uuid;
$fn$;

grant execute on function tests.uid(text) to authenticated, anon;

select tests.login_as(tests.uid('student_a'));

-- A predicted CWM window, exactly the shape openWindows() produces: no
-- occurred_date, no scheduled_date, nothing for the trigger to fall back to
-- but current_date.
select lives_ok(
  $$ insert into public.assessments
       (id, student_id, student_subject_id, type, status, created_by)
     values ('00000000-0000-4000-7000-000000000020',
             '00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-b000-000000000001', 'CWM', 'predicted',
             '00000000-0000-4000-a000-000000000002') $$,
  'setup: an open predicted CWM window, no occurred_date or scheduled_date yet'
);

-- ===========================================================================
-- 1. The header date wins over current_date on attach
-- ===========================================================================

select is(
  (public.log_manual_result(
    tests.uid('student_a'),
    jsonb_build_object(
      'assessment_id', '00000000-0000-4000-7000-000000000020',
      'occurred_date', '2020-01-15',
      'raw_obtained', 12, 'raw_total', 15
    )
  ) ->> 'converted')::numeric,
  12.0,
  'the attach still converts correctly - this is the occurred_date fix, not a marks regression'
);

select is(
  (select occurred_date from public.assessments where id = '00000000-0000-4000-7000-000000000020'),
  '2020-01-15'::date,
  'occurred_date is the paper''s header date, not current_date'
);

select isnt(
  (select occurred_date from public.assessments where id = '00000000-0000-4000-7000-000000000020'),
  current_date,
  'and specifically not the day this was logged - the bug this guards against'
);

select is(
  (select status from public.assessments where id = '00000000-0000-4000-7000-000000000020'),
  'logged',
  'the window still closes result_logged (0020s trigger, untouched) despite the backdated date'
);

-- ===========================================================================
-- 2. No date supplied on attach - the trigger's own fallback still applies,
--    unchanged. Not a regression: a manual attach with no date at all was
--    always current_date, and still is.
-- ===========================================================================

select lives_ok(
  $$ insert into public.assessments
       (id, student_id, student_subject_id, type, status, created_by)
     values ('00000000-0000-4000-7000-000000000021',
             '00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-b000-000000000001', 'CWM', 'predicted',
             '00000000-0000-4000-a000-000000000002') $$,
  'setup: a second open window, attached with no occurred_date at all'
);

select is(
  (select public.log_manual_result(
    tests.uid('student_a'),
    jsonb_build_object(
      'assessment_id', '00000000-0000-4000-7000-000000000021',
      'raw_obtained', 5, 'raw_total', 10
    )
  ) is not null),
  true,
  'attaching with no date at all still succeeds - not exercised by the count above, just confirming no exception'
);

select tests.logout();

select * from finish();

rollback;
