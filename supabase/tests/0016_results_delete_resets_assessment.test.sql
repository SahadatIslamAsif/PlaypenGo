-- 0016 — deleting a result resets or removes its assessment (0016 migration)
--
-- Not an authorization suite — deleteResult() is already proven student-only
-- by 0013_student_only_writes. What this file proves is the trigger's two
-- outcomes, one per assessment shape:
--
--   * an assessment log_manual_result() created purely to hold this result
--     (no scheduled_date) is deleted along with it — nothing else in the
--     schema refers to that row, so leaving it behind at status='logged'
--     with no result is exactly the phantom this migration exists to close;
--   * an assessment that started life as a scheduled CT (assignCTDate(),
--     modelled here the same way 0015's own suite does — inserting the row
--     directly rather than calling the student-facing action) survives, and
--     reverts to 'scheduled' with occurred_date cleared, because that CT is
--     still on the calendar whether or not a mark is attached to it.
--
-- 0020 added a third outcome and, with it, the reason the first two cannot be
-- told apart by status alone. A CWM window (§7.3) has no scheduled_date, so
-- 0016's original test would have taken the first branch and DELETED it —
-- destroying the very row that was watching for the paper. The discriminator
-- is `window_closed_at`: only a row that predated its result ever gets one,
-- which is why log_manual_result() now inserts at 'logged' rather than
-- 'occurred'. Section 3 is that case, and section 1 is what proves the
-- discriminator does not fire for an ordinary manual entry.
--
-- Run against a local stack:
--
--     supabase db reset
--     supabase test db

begin;

set search_path = public, extensions, tests;

select plan(15);

-- ------------------------------------------------------------- test names ---

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

-- ===========================================================================
-- 1. A manual-entry-only assessment is deleted along with its result
-- ===========================================================================

select lives_ok(
  $$ select public.log_manual_result(
       '00000000-0000-4000-a000-000000000002',
       jsonb_build_object(
         'student_subject_id', '00000000-0000-4000-b000-000000000001',
         'type', 'CWM', 'raw_obtained', 5, 'raw_total', 10
       )
     ) $$,
  'setup: a bare manual entry, no assessment_id given'
);

select is(
  (select status from public.assessments
    where student_id = tests.uid('student_a') and student_subject_id = tests.uid('physics_a')
      and type = 'CWM'),
  'logged',
  'sanity: the assessment is logged before the delete'
);

select lives_ok(
  $$ delete from public.results r
      using public.assessments a
      where r.assessment_id = a.id
        and a.student_id = '00000000-0000-4000-a000-000000000002'
        and a.type = 'CWM' $$,
  'the student deletes their own mis-keyed result'
);

select is(
  (select count(*) from public.assessments
    where student_id = tests.uid('student_a') and student_subject_id = tests.uid('physics_a')
      and type = 'CWM'),
  0::bigint,
  'the assessment is gone too - nothing else in the schema referred to it'
);

-- ===========================================================================
-- 2. A scheduled CT reverts to 'scheduled' instead of disappearing
-- ===========================================================================

select lives_ok(
  $$ insert into public.assessments
       (id, student_id, student_subject_id, type, status, scheduled_date, created_by)
     values ('00000000-0000-4000-7000-000000000020',
             '00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-b000-000000000001', 'CT', 'scheduled', '2026-09-01',
             '00000000-0000-4000-a000-000000000002') $$,
  'setup: a CT already on the calendar, the way assignCTDate() creates one'
);

select is(
  (public.log_manual_result(
    tests.uid('student_a'),
    jsonb_build_object(
      'assessment_id', '00000000-0000-4000-7000-000000000020',
      'raw_obtained', 18, 'raw_total', 40
    )
  ) ->> 'converted')::numeric,
  11.3,
  'the paper is logged against the scheduled CT'
);

select lives_ok(
  $$ delete from public.results
      where assessment_id = '00000000-0000-4000-7000-000000000020' $$,
  'the student deletes that result too'
);

select is(
  (select status from public.assessments where id = '00000000-0000-4000-7000-000000000020'),
  'scheduled',
  'the CT reverts to scheduled rather than vanishing - it is still on the calendar'
);

select is(
  (select row(scheduled_date, occurred_date) from public.assessments
    where id = '00000000-0000-4000-7000-000000000020'),
  row('2026-09-01'::date, null::date),
  'scheduled_date survives untouched; occurred_date is cleared back to null'
);

select is(
  (select row(window_closed_at, window_close_reason) from public.assessments
    where id = '00000000-0000-4000-7000-000000000020'),
  row(null::timestamptz, null::text),
  'and its one-occurrence window reopened - the CT is being watched again'
);

-- ===========================================================================
-- 3. A CWM window survives its result too, and reverts to 'predicted'
-- ===========================================================================
--
-- Phase 6 opens these; nothing in Phase 5 does. The row is written by hand
-- here for the same reason 0015's suite writes a scheduled CT by hand — the
-- shape is what is under test, not the writer.

select lives_ok(
  $$ insert into public.assessments
       (id, student_id, student_subject_id, type, status, created_by)
     values ('00000000-0000-4000-7000-000000000021',
             '00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-b000-000000000001', 'CWM', 'predicted',
             '00000000-0000-4000-a000-000000000002') $$,
  'setup: an open CWM window, the shape §7.3 opens on a chapter reaching p80'
);

select is(
  (public.log_manual_result(
    tests.uid('student_a'),
    jsonb_build_object(
      'assessment_id', '00000000-0000-4000-7000-000000000021',
      'raw_obtained', 12, 'raw_total', 15
    )
  ) ->> 'converted')::numeric,
  12.0,
  'the paper attaches to the open window - §5.3''s confirm path'
);

select is(
  (select window_close_reason from public.assessments
    where id = '00000000-0000-4000-7000-000000000021'),
  'result_logged',
  'and logging it closed the window - §7.5''s first reason, as a database fact'
);

select lives_ok(
  $$ delete from public.results
      where assessment_id = '00000000-0000-4000-7000-000000000021' $$,
  'the student deletes that result as well'
);

select is(
  (select row(status, window_closed_at, window_close_reason) from public.assessments
    where id = '00000000-0000-4000-7000-000000000021'),
  row('predicted'::text, null::timestamptz, null::text),
  'the window reverts to predicted and reopens - it is not deleted like a manual entry'
);

select tests.logout();

select * from finish();

rollback;
