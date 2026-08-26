-- 0015 — log_manual_result() (SPEC.md §5.3, §6; 0014 migration)
--
-- Unlike 0009's and 0011's suites, this is not proving an authorization check
-- the function does itself — 0014's header explains why: log_manual_result()
-- is SECURITY INVOKER, so 0013's table policies are what authorize every
-- statement inside it, and there is one authorization story for these two
-- tables, not two. What this file proves instead:
--
--   * the two INSERTs are atomic — a rejected result never leaves behind an
--     orphan assessment;
--   * both entry shapes from §5.3 work: creating a fresh assessment+result
--     together (the manual-entry form), and attaching a result to an
--     assessment that already exists (a CT already on the calendar, or a
--     confirmed CWM from §7.6);
--   * calling it does not create a second authorization surface — a caller
--     the table policies would deny is denied here too, with the same error.
--
-- Run against a local stack:
--
--     supabase db reset
--     supabase test db

begin;

set search_path = public, extensions, tests;

select plan(18);

-- ------------------------------------------------------------- test names ---

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
  end::uuid;
$fn$;

grant execute on function tests.uid(text) to authenticated, anon;

-- ===========================================================================
-- 1. Fresh assessment + result together — the manual-entry form's path
-- ===========================================================================

select tests.login_as(tests.uid('student_a'));

select is(
  public.log_manual_result(
    tests.uid('student_a'),
    jsonb_build_object(
      'student_subject_id', tests.uid('physics_a'),
      'type', 'CWM',
      'raw_obtained', 5,
      'raw_total', 10
    )
  ) - 'assessment_id' - 'result_id',
  jsonb_build_object('percentage', 50.0, 'converted', 7.5),
  'creates the assessment and result together and returns §6''s converted figures'
);

select is(
  (select count(*) from public.assessments
    where student_id = tests.uid('student_a') and student_subject_id = tests.uid('physics_a')
      and type = 'CWM' and status = 'logged'),
  1::bigint,
  'the created assessment is already status logged, not scheduled-then-logged'
);

select is(
  (select entry_mode from public.results r
    join public.assessments a on a.id = r.assessment_id
    where a.student_subject_id = tests.uid('physics_a') and a.type = 'CWM'),
  'manual',
  'entry_mode is manual - this is §5.3''s fallback path, not Phase 5''s scan'
);

select throws_ok(
  $$ select public.log_manual_result(
       '00000000-0000-4000-a000-000000000002',
       jsonb_build_object('type', 'CWM', 'raw_obtained', 5, 'raw_total', 10)
     ) $$,
  '23514', NULL,
  'no subject at all is rejected before either row is written'
);

select throws_ok(
  $$ select public.log_manual_result(
       '00000000-0000-4000-a000-000000000002',
       jsonb_build_object(
         'student_subject_id', '00000000-0000-4000-b000-000000000001',
         'type', 'semester_exam', 'raw_obtained', 5, 'raw_total', 10)
     ) $$,
  '23514', NULL,
  'a type outside CT/CWM is rejected - §10 item 3, semester exams are out of scope'
);

-- ===========================================================================
-- 2. Atomicity — a rejected result leaves no orphan assessment
-- ===========================================================================
--
-- The failing call below creates a fresh assessment (no assessment_id given)
-- and only then attempts the result INSERT that fails on the zero total.
-- Postgres's ordinary statement-level atomicity means a single top-level
-- `SELECT log_manual_result(...)` call rolls back everything the function did
-- if it raises — this is what buys §5.3's form its atomicity from a single
-- client round trip, which two separate INSERTs from the browser would not
-- have gotten for free.

create temporary table tmp_before_count as
  select count(*) as n from public.assessments where student_id = '00000000-0000-4000-a000-000000000002';

select throws_ok(
  $$ select public.log_manual_result(
       '00000000-0000-4000-a000-000000000002',
       jsonb_build_object(
         'student_subject_id', '00000000-0000-4000-b000-000000000001',
         'type', 'CWM', 'raw_obtained', 5, 'raw_total', 0)
     ) $$,
  '22012', NULL,
  'a zero total fails inside the function, on the same division-by-zero terms as 0014''s suite'
);

select is(
  (select count(*) from public.assessments where student_id = '00000000-0000-4000-a000-000000000002'),
  (select n from tmp_before_count),
  'and no assessment was left behind by the failed attempt'
);

drop table tmp_before_count;

-- ===========================================================================
-- 3. Attaching to an existing assessment — §7.6's confirmed-CWM path
-- ===========================================================================

select lives_ok(
  $$ insert into public.assessments
       (id, student_id, student_subject_id, type, status, created_by)
     values ('00000000-0000-4000-7000-000000000010',
             '00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-b000-000000000001', 'CT', 'scheduled',
             '00000000-0000-4000-a000-000000000002') $$,
  'setup: a CT already on the calendar'
);

select is(
  (public.log_manual_result(
    tests.uid('student_a'),
    jsonb_build_object(
      'assessment_id', '00000000-0000-4000-7000-000000000010',
      'raw_obtained', 18, 'raw_total', 40
    )
  ) ->> 'converted')::numeric,
  11.3,
  'attaching to an already-scheduled CT converts at 25, not 15'
);

select is(
  (select status from public.assessments where id = '00000000-0000-4000-7000-000000000010'),
  'logged',
  'and the assessment moved from scheduled straight to logged'
);

select throws_ok(
  $$ select public.log_manual_result(
       '00000000-0000-4000-a000-000000000002',
       jsonb_build_object('assessment_id', '00000000-0000-4000-7000-000000000010',
                          'raw_obtained', 5, 'raw_total', 10)
     ) $$,
  '23505', NULL,
  'a second result cannot attach to an assessment that already has one'
);

select throws_ok(
  $$ select public.log_manual_result(
       '00000000-0000-4000-a000-000000000002',
       jsonb_build_object('assessment_id', gen_random_uuid(),
                          'raw_obtained', 5, 'raw_total', 10)
     ) $$,
  'P0002', NULL,
  'an assessment_id that does not exist for this student is reported, not silently created'
);

-- ===========================================================================
-- 4. No second authorization surface
-- ===========================================================================

select tests.login_as_anon();

select throws_ok(
  $$ select public.log_manual_result(
       '00000000-0000-4000-a000-000000000002',
       jsonb_build_object('student_subject_id', '00000000-0000-4000-b000-000000000001',
                          'type', 'CWM', 'raw_obtained', 5, 'raw_total', 10)
     ) $$,
  '42501', NULL,
  'anon cannot call log_manual_result at all'
);

select tests.login_as(tests.uid('guardian_a'));

select throws_ok(
  $$ select public.log_manual_result(
       '00000000-0000-4000-a000-000000000002',
       jsonb_build_object('student_subject_id', '00000000-0000-4000-b000-000000000001',
                          'type', 'CWM', 'raw_obtained', 5, 'raw_total', 10)
     ) $$,
  '42501', NULL,
  'a guardian is denied by the same table policy the function runs under'
);

select throws_ok(
  $$ select public.log_manual_result(
       '00000000-0000-4000-a000-000000000003',
       jsonb_build_object('student_subject_id', '00000000-0000-4000-b000-000000000001',
                          'type', 'CWM', 'raw_obtained', 5, 'raw_total', 10)
     ) $$,
  '42501', NULL,
  'nor can a guardian log a result under their own id through this function'
);

select tests.login_as(tests.uid('student_b'));

select throws_ok(
  $$ select public.log_manual_result(
       '00000000-0000-4000-a000-000000000002',
       jsonb_build_object('student_subject_id', '00000000-0000-4000-b000-000000000001',
                          'type', 'CWM', 'raw_obtained', 5, 'raw_total', 10)
     ) $$,
  '42501', NULL,
  'an unrelated student cannot log a result for student A'
);

-- The tutor's session-logging path, §5.3's primary use.
select tests.login_as(tests.uid('tutor'));

select is(
  (public.log_manual_result(
    tests.uid('student_a'),
    jsonb_build_object(
      'student_subject_id', tests.uid('physics_a'),
      'type', 'CWM', 'raw_obtained', 9, 'raw_total', 10,
      'paper_missing', true
    )
  ) ->> 'converted')::numeric,
  13.5,
  'the tutor logs a result on the student''s behalf through the same function'
);

select is(
  (select paper_missing from public.results r
    join public.assessments a on a.id = r.assessment_id
    where a.student_subject_id = tests.uid('physics_a') and r.raw_obtained = 9),
  true,
  'and the paper_missing flag from §5.3''s manual fallback is recorded'
);

select tests.logout();

select * from finish();

rollback;
