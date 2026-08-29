-- 0022 — log_manual_result() gains ocr_confidence (SPEC.md §3.2, §5.3)
--
-- Two things: the new key round-trips into results.ocr_confidence when a
-- caller provides it, and every existing caller shape (no ocr_confidence
-- key at all) still stores null - 0021's own "existing callers unaffected"
-- guarantee, extended to this fourth key.
--
-- Run against a local stack:
--
--     supabase db reset
--     supabase test db

begin;

set search_path = public, extensions, tests;

select plan(3);

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

-- Called once each, result_id captured into a real column rather than
-- re-invoked inside a nested subquery's WHERE clause.
create temporary table t0022_calls (
  label      text primary key,
  result_id  uuid not null
);

insert into t0022_calls (label, result_id)
select 'provided', (public.log_manual_result(
  tests.uid('student_a'),
  jsonb_build_object(
    'student_subject_id', tests.uid('physics_a'),
    'type', 'CWM', 'raw_obtained', 9, 'raw_total', 15,
    'ocr_confidence', jsonb_build_object('subject', 0.96, 'marks', 0.92, 'chapter', 0.71)
  )
) ->> 'result_id')::uuid;

insert into t0022_calls (label, result_id)
select 'omitted', (public.log_manual_result(
  tests.uid('student_a'),
  jsonb_build_object(
    'student_subject_id', tests.uid('physics_a'),
    'type', 'CWM', 'raw_obtained', 5, 'raw_total', 10
  )
) ->> 'result_id')::uuid;

insert into t0022_calls (label, result_id)
select 'with_other_keys', (public.log_manual_result(
  tests.uid('student_a'),
  jsonb_build_object(
    'student_subject_id', tests.uid('physics_a'),
    'type', 'CWM', 'raw_obtained', 1, 'raw_total', 2,
    'entry_mode', 'ocr', 'name_mismatch', true, 'parsed_student_name', 'Someone Else',
    'ocr_confidence', jsonb_build_object('subject', 0.5, 'marks', 0.5, 'chapter', 0.5)
  )
) ->> 'result_id')::uuid;

-- ===========================================================================
-- 1. Provided - round-trips exactly
-- ===========================================================================

select is(
  (select r.ocr_confidence from public.results r
     join t0022_calls c on c.result_id = r.id
    where c.label = 'provided'),
  jsonb_build_object('subject', 0.96, 'marks', 0.92, 'chapter', 0.71),
  'ocr_confidence round-trips into results exactly as given'
);

-- ===========================================================================
-- 2. Omitted - stays null, same as every pre-0022 caller
-- ===========================================================================

select is(
  (select r.ocr_confidence from public.results r
     join t0022_calls c on c.result_id = r.id
    where c.label = 'omitted'),
  null::jsonb,
  'omitting ocr_confidence leaves it null - the manual-entry form is unaffected'
);

-- ===========================================================================
-- 3. The other three 0021 keys still work alongside it
-- ===========================================================================

select is(
  (select row(r.entry_mode, r.name_mismatch, r.parsed_student_name) from public.results r
     join t0022_calls c on c.result_id = r.id
    where c.label = 'with_other_keys'),
  row('ocr'::text, true, 'Someone Else'::text),
  'ocr_confidence does not disturb the three keys 0021 already added'
);

select tests.logout();

select * from finish();

rollback;
