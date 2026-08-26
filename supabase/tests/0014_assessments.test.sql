-- 0014 — assessments and results (SPEC.md §3.3, §6; 0013 migration)
--
-- Two things this file has to prove that no earlier suite does.
--
--   * §6's conversion arithmetic, exercised through the generated columns
--     rather than trusted as a formula written down somewhere: the three
--     worked examples from the spec, that a client cannot supply `converted`
--     or `percentage` directly (they are GENERATED ALWAYS), and that
--     `converted_scale` is derived from the assessment's type rather than
--     accepted from the caller.
--   * The access matrix is a genuinely different shape from every earlier
--     table. §3.3: a tutor gets INSERT/UPDATE through an ordinary policy here
--     — the first table-level tutor write in the project — and still cannot
--     DELETE. Every other write path so far has been either student-only or a
--     scoped definer RPC; this is neither.
--
-- Also covers the can_log_for() repair: 0003 defined it as
-- `p_student = auth.uid() or is_tutor_of(p_student)`, which a guardian
-- supplying their own id would satisfy — the exact hole 0012 closed on six
-- other tables. It has never had a caller until this migration, so 0013
-- redefines it before wiring it up. This suite is what would fail if that
-- redefinition were ever reverted.
--
-- Run against a local stack:
--
--     supabase db reset
--     supabase test db

begin;

set search_path = public, extensions, tests;

select plan(45);

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
    when 'guardian_b' then '00000000-0000-4000-a000-000000000005'
    when 'physics_a'  then '00000000-0000-4000-b000-000000000001'
    when 'maths_a'    then '00000000-0000-4000-b000-000000000002'
    when 'physics_b'  then '00000000-0000-4000-b000-000000000003'
  end::uuid;
$fn$;

grant execute on function tests.uid(text) to authenticated, anon;

-- Helper functions are created here, before any login_as() switches the role
-- away from the owning `postgres` — creating an object in schema `tests`
-- needs CREATE on that schema, which `authenticated` does not have (seed.sql
-- grants only USAGE + EXECUTE). 0010's fixture functions follow the same order
-- for the same reason.

create or replace function tests.new_assessment(p_type text)
returns uuid
language sql
security definer
set search_path = ''
as $fn$
  insert into public.assessments
    (student_id, student_subject_id, type, created_by)
  values
    ('00000000-0000-4000-a000-000000000002',
     '00000000-0000-4000-b000-000000000001', p_type,
     '00000000-0000-4000-a000-000000000002')
  returning id;
$fn$;

grant execute on function tests.new_assessment(text) to authenticated, anon;

-- `(with a as (...) insert into ... returning ...)` cannot be used as a scalar
-- expression argument to is() — Postgres allows a data-modifying WITH only as
-- a standalone statement, not parenthesized inline. plpgsql functions have no
-- such restriction (the INSERT runs as an ordinary statement inside the
-- function body), so the create-assessment-then-log-result pattern lives here
-- instead, and each assertion below calls a scalar/table function.

create or replace function tests.log_result(p_type text, p_obtained numeric, p_total numeric)
returns table (converted numeric, percentage numeric)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_assessment uuid;
begin
  v_assessment := tests.new_assessment(p_type);

  return query
    insert into public.results (assessment_id, student_id, raw_obtained, raw_total)
    values (v_assessment, '00000000-0000-4000-a000-000000000002', p_obtained, p_total)
    returning results.converted, results.percentage;
end;
$fn$;

grant execute on function tests.log_result(text, numeric, numeric) to authenticated, anon;

-- The scale-override case: converted_scale is supplied by the caller and must
-- come back overwritten by the results_set_scale trigger.
create or replace function tests.log_result_with_scale(
  p_type text, p_obtained numeric, p_total numeric, p_scale numeric
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_assessment uuid;
  v_scale      numeric;
begin
  v_assessment := tests.new_assessment(p_type);

  insert into public.results
    (assessment_id, student_id, raw_obtained, raw_total, converted_scale)
  values (v_assessment, '00000000-0000-4000-a000-000000000002', p_obtained, p_total, p_scale)
  returning converted_scale into v_scale;

  return v_scale;
end;
$fn$;

grant execute on function tests.log_result_with_scale(text, numeric, numeric, numeric)
  to authenticated, anon;

-- Returns the assessment's status and occurred_date after logging a result
-- against a freshly created assessment of the given initial status.
create or replace function tests.log_result_and_check_assessment(p_initial_status text)
returns table (status text, occurred_date date)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_assessment uuid;
begin
  insert into public.assessments
    (student_id, student_subject_id, type, status, created_by)
  values
    ('00000000-0000-4000-a000-000000000002',
     '00000000-0000-4000-b000-000000000001', 'CT', p_initial_status,
     '00000000-0000-4000-a000-000000000002')
  returning id into v_assessment;

  insert into public.results (assessment_id, student_id, raw_obtained, raw_total)
  values (v_assessment, '00000000-0000-4000-a000-000000000002', 18, 40);

  return query
    select a.status, a.occurred_date from public.assessments a where a.id = v_assessment;
end;
$fn$;

grant execute on function tests.log_result_and_check_assessment(text) to authenticated, anon;

-- ===========================================================================
-- 1. §6's conversion, through the generated columns
-- ===========================================================================

select tests.login_as(tests.uid('student_a'));

-- CWM 5/10 -> 7.5/15
select is(
  (select jsonb_build_object('converted', converted, 'percentage', percentage)
     from tests.log_result('CWM', 5, 10)),
  '{"converted": 7.5, "percentage": 50.0}'::jsonb,
  'CWM 5/10 converts to 7.5/15 at 50% - the spec''s first worked example'
);

-- CWM 15/15 -> 15.0/15, the "already on scale, do not special-case" case
select is(
  (select jsonb_build_object('converted', converted, 'percentage', percentage)
     from tests.log_result('CWM', 15, 15)),
  '{"converted": 15.0, "percentage": 100.0}'::jsonb,
  'CWM 15/15 converts to 15.0/15 - the formula is a no-op, not a special case'
);

-- CT 18/40 -> 11.3/25
select is(
  (select jsonb_build_object('converted', converted, 'percentage', percentage)
     from tests.log_result('CT', 18, 40)),
  '{"converted": 11.3, "percentage": 45.0}'::jsonb,
  'CT 18/40 converts to 11.3/25 - the spec''s third worked example'
);

-- Bonus marks: obtained > total is allowed, deliberately unconstrained.
select lives_ok(
  $$ with a as (
       insert into public.assessments (student_id, student_subject_id, type, created_by)
       values ('00000000-0000-4000-a000-000000000002',
               '00000000-0000-4000-b000-000000000001', 'CWM',
               '00000000-0000-4000-a000-000000000002')
       returning id
     )
     insert into public.results (assessment_id, student_id, raw_obtained, raw_total)
     select a.id, '00000000-0000-4000-a000-000000000002', 16, 15 from a $$,
  'a bonus mark of 16/15 is recorded rather than refused'
);

-- 0015: neither generated column accepts a null, though nothing here can
-- actually produce one — the point is that a future consumer typed against
-- `number` rather than `number | null` stays correct.
select is(
  (select attnotnull from pg_attribute
    where attrelid = 'public.results'::regclass and attname = 'percentage'),
  true,
  'percentage is NOT NULL'
);

select is(
  (select attnotnull from pg_attribute
    where attrelid = 'public.results'::regclass and attname = 'converted'),
  true,
  'converted is NOT NULL'
);

-- percentage and converted are GENERATED ALWAYS: a client naming them is
-- rejected outright, not merely overwritten.
select throws_ok(
  format(
    $$ insert into public.results
         (assessment_id, student_id, raw_obtained, raw_total, converted)
       values (%L, '00000000-0000-4000-a000-000000000002', 5, 10, 999) $$,
    tests.new_assessment('CWM')
  ),
  '428C9', NULL,
  'a client cannot supply `converted` directly - it is a generated column'
);

select throws_ok(
  format(
    $$ insert into public.results
         (assessment_id, student_id, raw_obtained, raw_total, percentage)
       values (%L, '00000000-0000-4000-a000-000000000002', 5, 10, 999) $$,
    tests.new_assessment('CWM')
  ),
  '428C9', NULL,
  'nor `percentage`'
);

-- converted_scale is derived from the assessment's type, not accepted from
-- the caller - the whole point of the results_set_scale trigger.
select is(
  tests.log_result_with_scale('CT', 10, 20, 999),
  25::numeric,
  'converted_scale is overridden to 25 for a CT even when the client sends 999'
);

select is(
  tests.log_result_with_scale('CWM', 10, 20, 999),
  15::numeric,
  'and to 15 for a CWM'
);

-- ===========================================================================
-- 2. A result implies a logged assessment
-- ===========================================================================

select is(
  (select status from tests.log_result_and_check_assessment('predicted')),
  'logged',
  'logging a result flips the assessment to logged - the alert-closing signal'
);

select is(
  (select occurred_date from tests.log_result_and_check_assessment('scheduled')),
  current_date,
  'and stamps occurred_date when it was still null'
);

-- Changing type after a result exists would silently re-scale a filed mark.
-- Split into a setup statement and a separate assertion — bundled into one
-- multi-CTE statement, the trigger's independent EXISTS scan did not reliably
-- see the sibling CTE's just-inserted result within the same statement.
select lives_ok(
  $$ insert into public.assessments
       (id, student_id, student_subject_id, type, created_by)
     values ('00000000-0000-4000-7000-000000000005',
             '00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-b000-000000000001', 'CWM',
             '00000000-0000-4000-a000-000000000002') $$,
  'setup: an assessment to lock the type of'
);

select lives_ok(
  $$ insert into public.results (assessment_id, student_id, raw_obtained, raw_total)
     values ('00000000-0000-4000-7000-000000000005',
             '00000000-0000-4000-a000-000000000002', 5, 10) $$,
  'setup: a result logged against it'
);

select throws_ok(
  $$ update public.assessments set type = 'CT'
      where id = '00000000-0000-4000-7000-000000000005' $$,
  '23514', NULL,
  'the type of an assessment with a logged result cannot be changed'
);

-- ===========================================================================
-- 3. §3.2's structural checks
-- ===========================================================================

select throws_ok(
  $$ insert into public.assessments
       (student_id, student_subject_id, type, scheduled_date, created_by)
     values ('00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-b000-000000000001', 'CWM', current_date,
             '00000000-0000-4000-a000-000000000002') $$,
  '23514', NULL,
  'scheduled_date is CT-only - the spec''s own annotation, enforced'
);

select throws_ok(
  $$ insert into public.assessments
       (student_id, student_subject_id, type, predicted_for_date, created_by)
     values ('00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-b000-000000000001', 'CT', current_date,
             '00000000-0000-4000-a000-000000000002') $$,
  '23514', NULL,
  'predicted_for_date is CWM-only'
);

select throws_ok(
  $$ insert into public.assessments
       (student_id, student_subject_id, type, created_by)
     values ('00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-b000-000000000003', 'CWM',
             '00000000-0000-4000-a000-000000000002') $$,
  '23503', NULL,
  'student A cannot file an assessment against student B''s Physics - composite FK'
);

-- The row's own student_id (student_a, self) satisfies the INSERT policy, so
-- this reaches the composite FK layer rather than being denied by RLS first —
-- unlike the guardian-own-id cases below, which never get this far.
select tests.login_as(tests.uid('student_b'));

select lives_ok(
  $$ insert into public.assessments
       (id, student_id, student_subject_id, type, created_by)
     values ('00000000-0000-4000-7000-000000000006',
             '00000000-0000-4000-a000-000000000004',
             '00000000-0000-4000-b000-000000000003', 'CWM',
             '00000000-0000-4000-a000-000000000004') $$,
  'setup: student B creates an assessment of their own'
);

select tests.login_as(tests.uid('student_a'));

select throws_ok(
  $$ insert into public.results (assessment_id, student_id, raw_obtained, raw_total)
     values ('00000000-0000-4000-7000-000000000006',
             '00000000-0000-4000-a000-000000000002', 5, 10) $$,
  '23503', NULL,
  'a result cannot claim a different student than its own assessment'
);

select throws_ok(
  $$ insert into public.results (assessment_id, student_id, raw_obtained, raw_total)
     values (gen_random_uuid(), '00000000-0000-4000-a000-000000000002', 5, 10) $$,
  '23503', NULL,
  'a result cannot reference an assessment that does not exist'
);

select throws_ok(
  format(
    $$ insert into public.results (assessment_id, student_id, raw_obtained, raw_total)
       values (%L, '00000000-0000-4000-a000-000000000002', -1, 10) $$,
    tests.new_assessment('CWM')
  ),
  '23514', NULL,
  'a negative obtained mark is rejected'
);

-- The generated column's division is evaluated before CHECK(raw_total > 0) is
-- reached, so Postgres raises division_by_zero rather than a constraint
-- violation. Either way a zero total is rejected, not silently stored.
select throws_ok(
  format(
    $$ insert into public.results (assessment_id, student_id, raw_obtained, raw_total)
       values (%L, '00000000-0000-4000-a000-000000000002', 5, 0) $$,
    tests.new_assessment('CWM')
  ),
  '22012', NULL,
  'a zero total is rejected - the divide-by-zero case'
);

-- ===========================================================================
-- 4. The access matrix - the first table-level tutor write in the project
-- ===========================================================================

select tests.login_as(tests.uid('tutor'));

select lives_ok(
  $$ insert into public.assessments
       (id, student_id, student_subject_id, type, created_by)
     values ('00000000-0000-4000-7000-000000000001',
             '00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-b000-000000000001', 'CT',
             '00000000-0000-4000-a000-000000000001') $$,
  'the tutor inserts an assessment for a linked student - the table grant'
);

select lives_ok(
  $$ update public.assessments set scheduled_date = current_date + 3
      where id = '00000000-0000-4000-7000-000000000001' $$,
  'and updates it - assigning the CT date'
);

select lives_ok(
  $$ insert into public.results
       (assessment_id, student_id, raw_obtained, raw_total, entry_mode, verified_by)
     values ('00000000-0000-4000-7000-000000000001',
             '00000000-0000-4000-a000-000000000002', 18, 40, 'manual',
             '00000000-0000-4000-a000-000000000001') $$,
  'the tutor logs a result on the student''s behalf - the primary session flow'
);

-- "Cannot delete student data" - the one verb withheld even here. A DELETE
-- whose USING clause matches nothing is not an error in Postgres, it is a
-- successful delete of zero rows — the silent-success case 0009's header
-- warns about. Each is read back rather than trusted on the absence of an
-- exception.
select lives_ok(
  $$ delete from public.assessments
      where id = '00000000-0000-4000-7000-000000000001' $$,
  'the tutor''s delete of the assessment raises nothing - filtered, not errored'
);

select is(
  (select count(*) from public.assessments
    where id = '00000000-0000-4000-7000-000000000001'),
  1::bigint,
  'and the assessment is still there'
);

select lives_ok(
  $$ delete from public.results
      where assessment_id = '00000000-0000-4000-7000-000000000001' $$,
  'nor does deleting the result raise anything'
);

select is(
  (select count(*) from public.results
    where assessment_id = '00000000-0000-4000-7000-000000000001'),
  1::bigint,
  'and the result is still there too'
);

-- Not tested here: "the tutor cannot write for a student they do not tutor".
-- seed.sql's tutor is approved for BOTH student A and student B, so the
-- fixture has no untutored student to aim at. That authorization check is
-- already asserted, on a random unrelated target, by 0010's and 0011's suites
-- for the other two definer/table write paths.

-- ===========================================================================
-- 5. The guardian - read-only, including under their own id
-- ===========================================================================

select tests.login_as(tests.uid('guardian_a'));

select is(
  (select count(*) from public.assessments
    where id = '00000000-0000-4000-7000-000000000001'),
  1::bigint,
  'guardian A reads the assessment the tutor logged for her student - full transparency'
);

select throws_ok(
  $$ insert into public.assessments
       (student_id, student_subject_id, type, created_by)
     values ('00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-b000-000000000001', 'CWM',
             '00000000-0000-4000-a000-000000000003') $$,
  '42501', NULL,
  'guardian A cannot insert an assessment for their student'
);

-- The 0012 case: a guardian writing under their OWN id, which can_log_for()'s
-- unrepaired form would have allowed.
select throws_ok(
  $$ insert into public.assessments
       (student_id, student_subject_id, type, created_by)
     values ('00000000-0000-4000-a000-000000000003',
             '00000000-0000-4000-b000-000000000001', 'CWM',
             '00000000-0000-4000-a000-000000000003') $$,
  '42501', NULL,
  'guardian A cannot insert an assessment under their own id either'
);

-- Points at a real assessment (the tutor's, from section 4) rather than a
-- bogus id. results_set_scale is a BEFORE INSERT trigger and runs before RLS's
-- WITH CHECK is enforced; against a nonexistent assessment_id it raises its own
-- 23503 first (§2's trigger), which would mask the RLS denial this test wants
-- to prove. A real id lets the trigger succeed and the INSERT policy be what
-- actually rejects the row.
select throws_ok(
  $$ insert into public.results (assessment_id, student_id, raw_obtained, raw_total)
     values ('00000000-0000-4000-7000-000000000001',
             '00000000-0000-4000-a000-000000000003', 5, 10) $$,
  '42501', NULL,
  'nor a result under their own id'
);

select lives_ok(
  $$ delete from public.assessments
      where id = '00000000-0000-4000-7000-000000000001' $$,
  'guardian A''s delete raises nothing - filtered to zero rows, not errored'
);

select is(
  (select count(*) from public.assessments
    where id = '00000000-0000-4000-7000-000000000001'),
  1::bigint,
  'and the assessment is still there'
);

-- ===========================================================================
-- 6. Family B sees nothing of family A
-- ===========================================================================

select tests.login_as(tests.uid('guardian_b'));

select is(
  (select count(*) from public.assessments where student_id = tests.uid('student_a')),
  0::bigint,
  'guardian B cannot see family A''s assessments'
);

select is(
  (select count(*) from public.results where student_id = tests.uid('student_a')),
  0::bigint,
  'nor family A''s results'
);

select tests.login_as(tests.uid('student_b'));

select is(
  (select count(*) from public.assessments where student_id = tests.uid('student_a')),
  0::bigint,
  'an unlinked student cannot see another student''s assessments'
);

select throws_ok(
  $$ insert into public.assessments
       (student_id, student_subject_id, type, created_by)
     values ('00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-b000-000000000001', 'CWM',
             '00000000-0000-4000-a000-000000000004') $$,
  '42501', NULL,
  'student B cannot write into student A''s tree'
);

-- ===========================================================================
-- 7. The student's own full CRUD, delete included
-- ===========================================================================

select tests.login_as(tests.uid('student_a'));

select lives_ok(
  $$ insert into public.assessments
       (id, student_id, student_subject_id, type, created_by)
     values ('00000000-0000-4000-7000-000000000002',
             '00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-b000-000000000001', 'CWM',
             '00000000-0000-4000-a000-000000000002') $$,
  'student A inserts their own assessment'
);

select lives_ok(
  $$ delete from public.assessments
      where id = '00000000-0000-4000-7000-000000000002' $$,
  'and deletes it - full CRUD for the student, delete included'
);

select is(
  (select count(*) from public.assessments
    where id = '00000000-0000-4000-7000-000000000002'),
  0::bigint,
  'and it is really gone'
);

-- ===========================================================================
-- 8. anon
-- ===========================================================================

select tests.login_as_anon();

select throws_ok(
  $$ select count(*) from public.assessments $$,
  '42501', NULL,
  'anon has no privilege on assessments'
);

select throws_ok(
  $$ select count(*) from public.results $$,
  '42501', NULL,
  'nor on results'
);

select tests.logout();

select * from finish();

rollback;
