-- 0031 — assessments.name and save_ct() (0031 migration)
--
-- What this file has to prove, beyond the raw column constraints:
--
--   * the backfill numbers by the test's actual date, not by row-insertion
--     order, and a cancelled CT still consumes a number rather than being
--     skipped;
--   * save_ct() links every chapter in chapter_ids atomically on create, and
--     REPLACES the set on update, the same as set_assessment_chapters()
--     itself already guarantees for assignCTDate() — this is the assertion
--     assignCTDate() could never make, because its UPDATE branch never
--     called set_assessment_chapters() at all;
--   * re-dating a CT that is not logged/occurred reopens its window
--     (0026's cancel trigger has no inverse without this); a CT already at
--     logged/occurred keeps its status and its closed window exactly as
--     they were;
--   * the access matrix is exactly assignCTDate()'s today: student-only, a
--     foreign assessment id not found rather than denied.
--
-- Run against a local stack:
--
--     supabase db reset
--     supabase test db

begin;

set search_path = public, extensions, tests;

select plan(25);

create or replace function tests.uid(p_who text)
returns uuid
language sql
immutable
as $fn$
  select case p_who
    when 'tutor'      then '00000000-0000-4000-a000-000000000001'
    when 'student_a'  then '00000000-0000-4000-a000-000000000002'
    when 'guardian_a' then '00000000-0000-4000-a000-000000000003'
    when 'student_b'  then '00000000-0000-4000-a000-000000000004'
    when 'physics_a'  then '00000000-0000-4000-b000-000000000001'
    when 'chapter_a1' then '00000000-0000-4000-c000-000000000001'
    when 'chapter_a2' then '00000000-0000-4000-c000-000000000002'
    when 'chapter_a3' then '00000000-0000-4000-9200-000000000001'
    when 'ct_x'       then '00000000-0000-4000-9100-000000000001'
    when 'ct_y'       then '00000000-0000-4000-9100-000000000002'
    when 'ct_z'       then '00000000-0000-4000-9100-000000000003'
    when 'ct_cancel'  then '00000000-0000-4000-9100-000000000004'
    when 'ct_logged'  then '00000000-0000-4000-9100-000000000005'
  end::uuid;
$fn$;

grant execute on function tests.uid(text) to authenticated, anon;

-- ===========================================================================
-- 1. The raw column constraints
-- ===========================================================================

select throws_ok(
  $$ insert into public.assessments
       (student_id, student_subject_id, type, status, name, created_by)
     values (tests.uid('student_a'), tests.uid('physics_a'), 'CWM', 'logged',
             'not allowed', tests.uid('student_a')) $$,
  '23514', NULL,
  'a named CWM throws - name is CT-only'
);

select throws_ok(
  $$ insert into public.assessments
       (student_id, student_subject_id, type, status, scheduled_date, name, created_by)
     values (tests.uid('student_a'), tests.uid('physics_a'), 'CT', 'scheduled',
             '2026-10-15', ' CT 1 ', tests.uid('student_a')) $$,
  '23514', NULL,
  'an untrimmed name throws'
);

select throws_ok(
  $$ insert into public.assessments
       (student_id, student_subject_id, type, status, scheduled_date, name, created_by)
     values (tests.uid('student_a'), tests.uid('physics_a'), 'CT', 'scheduled',
             '2026-10-15', repeat('x', 61), tests.uid('student_a')) $$,
  '23514', NULL,
  'a 61-character name throws'
);

-- ===========================================================================
-- 2. Backfill numbers by date, not by creation order, and a cancelled CT
--    consumes its number - reproduced here since the real migration ran
--    against zero rows on a fresh database.
-- ===========================================================================

select lives_ok(
  $$ insert into public.assessments
       (id, student_id, student_subject_id, type, status, scheduled_date, created_by, created_at)
     values
       (tests.uid('ct_x'), tests.uid('student_a'), tests.uid('physics_a'), 'CT', 'scheduled',
        '2026-10-20', tests.uid('student_a'), now() - interval '3 days'),
       (tests.uid('ct_y'), tests.uid('student_a'), tests.uid('physics_a'), 'CT', 'scheduled',
        '2026-10-05', tests.uid('student_a'), now() - interval '2 days'),
       (tests.uid('ct_z'), tests.uid('student_a'), tests.uid('physics_a'), 'CT', 'cancelled',
        '2026-10-10', tests.uid('student_a'), now() - interval '1 day') $$,
  'setup: three CTs, created earliest-first but due latest-first, one cancelled'
);

select lives_ok(
  $$ with numbered as (
       select id,
              row_number() over (
                partition by student_id, student_subject_id
                order by coalesce(scheduled_date, occurred_date,
                                   (created_at at time zone 'Asia/Dhaka')::date),
                         created_at, id
              ) as n
         from public.assessments
        where type = 'CT' and student_id = tests.uid('student_a')
     )
     update public.assessments a set name = 'CT ' || numbered.n
       from numbered where a.id = numbered.id $$,
  '0031''s own backfill query, rerun against the fixture rows above'
);

select is(
  (select name from public.assessments where id = tests.uid('ct_y')),
  'CT 1', 'the earliest DATE numbers first, even though it was created second'
);

select is(
  (select name from public.assessments where id = tests.uid('ct_z')),
  'CT 2', 'the cancelled CT consumes the middle number rather than being skipped'
);

select is(
  (select name from public.assessments where id = tests.uid('ct_x')),
  'CT 3', 'the earliest-CREATED row numbers last, because its date is latest'
);

-- ===========================================================================
-- 3. save_ct() - create with multiple chapters, atomically
-- ===========================================================================

select tests.login_as(tests.uid('student_a'));

select lives_ok(
  $$ insert into public.chapters
       (id, student_id, student_subject_id, name, source, status, sort_order)
     values (tests.uid('chapter_a3'), tests.uid('student_a'), tests.uid('physics_a'),
             'A third chapter for the multi-link test', 'manual', 'not_started', 99) $$,
  'setup: a third chapter to link, alongside the two Physics chapters seed.sql already has'
);

select lives_ok(
  $$ select public.save_ct(
       tests.uid('student_a'),
       jsonb_build_object(
         'student_subject_id', tests.uid('physics_a'),
         'name', 'CT Save Test',
         'scheduled_date', '2026-11-01',
         'chapter_ids', jsonb_build_array(
           tests.uid('chapter_a1'), tests.uid('chapter_a2'), tests.uid('chapter_a3')
         )
       )
     ) $$,
  'save_ct creates a scheduled CT with three chapter links in one call'
);

select is(
  (select count(*) from public.assessment_chapters ac
    join public.assessments a on a.id = ac.assessment_id
    where a.name = 'CT Save Test'),
  3::bigint,
  'all three links exist - this is the atomic call assignCTDate''s UPDATE branch never made'
);

select lives_ok(
  $$ select public.save_ct(
       tests.uid('student_a'),
       jsonb_build_object(
         'assessment_id', (select id from public.assessments where name = 'CT Save Test'),
         'scheduled_date', '2026-11-08',
         'chapter_ids', jsonb_build_array(tests.uid('chapter_a1'), tests.uid('chapter_a2'))
       )
     ) $$,
  're-saving the same CT with two chapters instead of three'
);

select is(
  (select array_agg(chapter_id order by chapter_id) from public.assessment_chapters ac
    join public.assessments a on a.id = ac.assessment_id
    where a.name = 'CT Save Test'),
  array[tests.uid('chapter_a1'), tests.uid('chapter_a2')],
  'REPLACES the set - exactly two links remain, not three'
);

select is(
  (select scheduled_date from public.assessments where name = 'CT Save Test'),
  date '2026-11-08',
  'and the postponed date is saved'
);

-- ===========================================================================
-- 4. Re-dating reopens a closed window - unless the CT is logged/occurred
-- ===========================================================================

select lives_ok(
  $$ insert into public.assessments
       (id, student_id, student_subject_id, type, status, scheduled_date,
        window_closed_at, window_close_reason, created_by)
     values (tests.uid('ct_cancel'), tests.uid('student_a'), tests.uid('physics_a'),
             'CT', 'cancelled', '2026-09-01', now(), 'ct_cancelled', tests.uid('student_a')) $$,
  'setup: a cancelled CT with its window already closed'
);

select lives_ok(
  $$ select public.save_ct(
       tests.uid('student_a'),
       jsonb_build_object('assessment_id', tests.uid('ct_cancel'), 'scheduled_date', '2026-11-15')
     ) $$,
  're-dating the cancelled CT through save_ct'
);

select is(
  (select status from public.assessments where id = tests.uid('ct_cancel')),
  'scheduled',
  'it comes back to scheduled'
);

select is(
  (select window_closed_at from public.assessments where id = tests.uid('ct_cancel')),
  NULL,
  'and its window reopens - advanceWindows() can see it again'
);

-- A CT already logged keeps its status and its closed window: renaming it
-- is not rescheduling it, and result_logged must not be silently overwritten.

select lives_ok(
  $$ insert into public.assessments
       (id, student_id, student_subject_id, type, status, scheduled_date, occurred_date,
        window_closed_at, window_close_reason, created_by)
     values (tests.uid('ct_logged'), tests.uid('student_a'), tests.uid('physics_a'),
             'CT', 'logged', '2026-08-01', '2026-08-01',
             now(), 'result_logged', tests.uid('student_a')) $$,
  'setup: an already-logged CT'
);

select lives_ok(
  $$ select public.save_ct(
       tests.uid('student_a'),
       jsonb_build_object('assessment_id', tests.uid('ct_logged'), 'name', 'CT Renamed',
                           'scheduled_date', '2026-08-01')
     ) $$,
  'renaming the logged CT through save_ct'
);

select is(
  (select status from public.assessments where id = tests.uid('ct_logged')),
  'logged',
  'status is untouched - a rename is not a reschedule'
);

select is(
  (select window_close_reason from public.assessments where id = tests.uid('ct_logged')),
  'result_logged',
  'and neither is its close reason'
);

select tests.logout();

-- ===========================================================================
-- 5. Access matrix - student-only, foreign id not found
-- ===========================================================================

select tests.login_as(tests.uid('guardian_a'));

select throws_ok(
  $$ select public.save_ct(
       tests.uid('student_a'),
       jsonb_build_object('student_subject_id', tests.uid('physics_a'), 'scheduled_date', '2026-11-20')
     ) $$,
  '42501', NULL,
  'a guardian cannot schedule a CT - assessments_insert is student-only'
);

select tests.login_as(tests.uid('tutor'));

select throws_ok(
  $$ select public.save_ct(
       tests.uid('student_a'),
       jsonb_build_object('student_subject_id', tests.uid('physics_a'), 'scheduled_date', '2026-11-20')
     ) $$,
  '42501', NULL,
  'the tutor cannot schedule one either - §3.3''s tutor reach stops at UPDATE on results'
);

select tests.login_as(tests.uid('student_b'));

select throws_ok(
  $$ select public.save_ct(
       tests.uid('student_b'),
       jsonb_build_object('assessment_id', tests.uid('ct_x'), 'scheduled_date', '2026-11-20')
     ) $$,
  'P0002', NULL,
  'another student''s assessment id (ct_x, student A''s) is not found, not denied - same as log_manual_result''s own case'
);

select tests.logout();

select * from finish();

rollback;
