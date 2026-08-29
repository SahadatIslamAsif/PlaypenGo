-- 0023 — attach_scan_job_to_result() (SPEC.md §5.3, 0023 migration)
--
-- Three things this file has to prove that 0021/0022's suites don't:
--
--   * it leaves raw_obtained/raw_total alone while flipping entry_mode
--     manual -> ocr and clearing paper_missing - §5.3's "leaves confirmed
--     fields alone, fills only what is empty";
--   * a chapter already linked by hand survives untouched, while an empty
--     assessment_chapters set does pick up the scan's suggestion - the two
--     halves of "fills only what is empty" that a single test can't cover;
--   * it refuses a result that already has a paper attached (entry_mode
--     already 'ocr'), and it refuses a job attaching to another student's
--     result - the second exactly as findable-or-not as everywhere else in
--     this project (RLS narrows the SELECT first; "not found" and "not
--     yours" read identically on purpose).
--
-- Run against a local stack:
--
--     supabase db reset
--     supabase test db

begin;

set search_path = public, extensions, tests;

select plan(11);

-- ------------------------------------------------------------- test names ---

create or replace function tests.uid(p_who text)
returns uuid
language sql
immutable
as $fn$
  select case p_who
    when 'student_a'  then '00000000-0000-4000-a000-000000000002'
    when 'student_b'  then '00000000-0000-4000-a000-000000000004'
    when 'physics_a'  then '00000000-0000-4000-b000-000000000001'
    when 'chapter_a1' then '00000000-0000-4000-c000-000000000001'
    when 'chapter_a2' then '00000000-0000-4000-c000-000000000002'
  end::uuid;
$fn$;

grant execute on function tests.uid(text) to authenticated, anon;

-- ------------------------------------------------------------------ setup ---
--
-- Two manually-logged results ("Paper not returned" - exactly what a real
-- Attach paper flow starts from): one with no chapter picked yet, one where
-- a chapter was already picked by hand. And three scan_jobs at 'review',
-- each with one page - one per result, plus a spare for the "already
-- attached" guard.

select tests.login_as(tests.uid('student_a'));

create temporary table t0023_setup (
  label text primary key,
  id    uuid not null
);

insert into t0023_setup (label, id)
select 'result_empty', (public.log_manual_result(
  tests.uid('student_a'),
  jsonb_build_object(
    'student_subject_id', tests.uid('physics_a'),
    'type', 'CWM', 'raw_obtained', 5, 'raw_total', 15,
    'occurred_date', '2026-08-01', 'paper_missing', true
  )
) ->> 'result_id')::uuid;

insert into t0023_setup (label, id)
select 'result_chaptered', (public.log_manual_result(
  tests.uid('student_a'),
  jsonb_build_object(
    'student_subject_id', tests.uid('physics_a'),
    'type', 'CWM', 'raw_obtained', 9, 'raw_total', 15,
    'occurred_date', '2026-08-02', 'paper_missing', true,
    'chapter_ids', jsonb_build_array(tests.uid('chapter_a1'))
  )
) ->> 'result_id')::uuid;

insert into public.scan_jobs (id, student_id, status)
values
  ('00000000-0000-4000-7000-000000000060', tests.uid('student_a'), 'review'),
  ('00000000-0000-4000-7000-000000000061', tests.uid('student_a'), 'review'),
  ('00000000-0000-4000-7000-000000000062', tests.uid('student_a'), 'review');

insert into public.scan_pages (scan_job_id, student_id, page_no, storage_path)
values
  ('00000000-0000-4000-7000-000000000060', tests.uid('student_a'), 1,
   tests.uid('student_a') || '/00000000-0000-4000-7000-000000000060/1.webp'),
  ('00000000-0000-4000-7000-000000000061', tests.uid('student_a'), 1,
   tests.uid('student_a') || '/00000000-0000-4000-7000-000000000061/1.webp'),
  ('00000000-0000-4000-7000-000000000062', tests.uid('student_a'), 1,
   tests.uid('student_a') || '/00000000-0000-4000-7000-000000000062/1.webp');

-- ===========================================================================
-- 1. Attaching to the empty-chapter result - fills the gap
-- ===========================================================================

select lives_ok(
  $$ select public.attach_scan_job_to_result(
       '00000000-0000-4000-7000-000000000060',
       (select id from t0023_setup where label = 'result_empty'),
       jsonb_build_object(
         'chapter_ids', jsonb_build_array('00000000-0000-4000-c000-000000000002'),
         'name_mismatch', true, 'parsed_student_name', 'Someone Else',
         'ocr_confidence', jsonb_build_object('subject', 0.9, 'marks', 0.9, 'chapter', 0.6)
       )
     ) $$,
  'attaching to a manually-logged result with no chapter yet succeeds'
);

select is(
  (select row(r.raw_obtained, r.raw_total, r.entry_mode, r.paper_missing)
     from public.results r join t0023_setup s on s.id = r.id
    where s.label = 'result_empty'),
  row(5::numeric, 15::numeric, 'ocr'::text, false),
  'marks are untouched; entry_mode flips to ocr and paper_missing clears'
);

select is(
  (select ac.chapter_id from public.assessment_chapters ac
     join public.results r on r.assessment_id = ac.assessment_id
     join t0023_setup s on s.id = r.id
    where s.label = 'result_empty'),
  tests.uid('chapter_a2'),
  'the scan''s chapter suggestion filled the empty slot'
);

select is(
  (select row(sj.status, sj.result_id) from public.scan_jobs sj
    where sj.id = '00000000-0000-4000-7000-000000000060'),
  row('confirmed'::text, (select id from t0023_setup where label = 'result_empty')),
  'the job is confirmed and points at the result it attached to'
);

select is(
  (select ri.storage_path from public.result_images ri
     join public.results r on r.id = ri.result_id
     join t0023_setup s on s.id = r.id
    where s.label = 'result_empty'),
  tests.uid('student_a') || '/' ||
    (select id from t0023_setup where label = 'result_empty') || '/1.webp',
  'the image was recorded under the result''s own scripts/ destination'
);

-- ===========================================================================
-- 2. Attaching to the already-chaptered result - never overwrites the pick
-- ===========================================================================

select lives_ok(
  $$ select public.attach_scan_job_to_result(
       '00000000-0000-4000-7000-000000000061',
       (select id from t0023_setup where label = 'result_chaptered'),
       jsonb_build_object('chapter_ids', jsonb_build_array('00000000-0000-4000-c000-000000000002'))
     ) $$,
  'attaching to a result that already has a chapter also succeeds'
);

select is(
  (select array_agg(ac.chapter_id order by ac.chapter_id) from public.assessment_chapters ac
     join public.results r on r.assessment_id = ac.assessment_id
     join t0023_setup s on s.id = r.id
    where s.label = 'result_chaptered'),
  array[tests.uid('chapter_a1')],
  'the hand-picked chapter survives untouched - the scan''s suggestion never overwrote it'
);

-- ===========================================================================
-- 3. Guards
-- ===========================================================================

select throws_ok(
  $$ select public.attach_scan_job_to_result(
       '00000000-0000-4000-7000-000000000062',
       (select id from t0023_setup where label = 'result_empty'),
       '{}'::jsonb
     ) $$,
  '23514', NULL,
  'a result that already has a paper attached (entry_mode ocr) refuses a second one'
);

-- A fresh job + result pair for student B, so the cross-student attempt below
-- is a genuine "wrong owner", not "already confirmed" tripping first. Logged
-- in as B before either insert - scan_jobs_insert/scan_pages_insert are
-- is_owner_student(), same as everywhere else in this project.
select tests.login_as(tests.uid('student_b'));

insert into public.scan_jobs (id, student_id, status)
values ('00000000-0000-4000-7000-000000000063', tests.uid('student_b'), 'review');

insert into public.scan_pages (scan_job_id, student_id, page_no, storage_path)
values ('00000000-0000-4000-7000-000000000063', tests.uid('student_b'), 1,
        tests.uid('student_b') || '/00000000-0000-4000-7000-000000000063/1.webp');

select throws_ok(
  $$ select public.attach_scan_job_to_result(
       '00000000-0000-4000-7000-000000000063',
       (select id from t0023_setup where label = 'result_chaptered'),
       '{}'::jsonb
     ) $$,
  'P0002', NULL,
  'student B cannot attach their own job to student A''s result'
);

select tests.login_as(tests.uid('student_a'));

select throws_ok(
  $$ select public.attach_scan_job_to_result(
       '00000000-0000-4000-7000-000000000063',
       (select id from t0023_setup where label = 'result_chaptered'),
       '{}'::jsonb
     ) $$,
  'P0002', NULL,
  'and student A cannot drive student B''s job either - RLS hides it, same as confirm_scan_job'
);

select is(
  (select target_result_id from public.scan_jobs where id = '00000000-0000-4000-7000-000000000063'),
  null::uuid,
  'target_result_id stays null unless a caller sets it - not implicitly written by attach'
);

select tests.logout();

select * from finish();

rollback;
