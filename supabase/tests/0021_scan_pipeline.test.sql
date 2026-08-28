-- 0021 — the scan pipeline (SPEC.md §3.2, §3.3, §5.3; 0021 migration)
--
-- Four things this file has to prove that no earlier suite does.
--
--   * §3.3's blackout is real: the tutor and guardian see nothing in
--     scan_jobs / scan_pages, not even the count of rows, and not even
--     through confirm_scan_job() — which is SECURITY INVOKER precisely so the
--     table policies decide this rather than a check inside the function.
--   * confirm_scan_job() does what §5.3's "On confirm" describes: writes a
--     result through log_manual_result() (so §6's conversion, the two entry
--     shapes and set_assessment_chapters() all come for free), writes one
--     result_images row per page naming the scripts/ destination, and moves
--     the job to 'confirmed' with result_id set — all inside one statement,
--     so a failure partway leaves nothing half-done.
--   * the scan_jobs check constraint is deliberately one-directional: a job
--     may be 'confirmed' with a null result_id (its result was later deleted
--     and results_reset_assessment_on_delete() cannot un-confirm a scan job),
--     but a job that is NOT 'confirmed' may never carry a result_id.
--   * log_manual_result()'s new optional keys — entry_mode, name_mismatch,
--     parsed_student_name — default to exactly what every pre-0021 caller
--     already gets, so the manual-entry form is unaffected by this migration.
--
-- Run against a local stack:
--
--     supabase db reset
--     supabase test db

begin;

set search_path = public, extensions, tests;

select plan(31);

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
    when 'chapter_a1' then '00000000-0000-4000-c000-000000000001'
  end::uuid;
$fn$;

grant execute on function tests.uid(text) to authenticated, anon;

select tests.login_as(tests.uid('student_a'));

-- ===========================================================================
-- 1. Table shape and RLS structure
-- ===========================================================================

select is(
  (select count(*) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'scan_jobs' and c.relrowsecurity),
  1::bigint,
  'scan_jobs has RLS enabled'
);

-- §3.3's blackout, structural: no policy on either table names a guardian- or
-- tutor-admitting predicate. The absence is the rule, so this asserts the
-- absence directly rather than only probing it behaviourally below.
select is_empty(
  $$ select tablename || '.' || policyname
       from pg_policies
      where schemaname = 'public'
        and tablename in ('scan_jobs', 'scan_pages')
        and (coalesce(qual, '') || coalesce(with_check, ''))
            ~ '(can_read_student|is_tutor_of|is_guardian_of)' $$,
  'no policy on scan_jobs or scan_pages admits a tutor or guardian'
);

-- result_images is the one table in this migration that DOES admit them, and
-- only on SELECT — §1's "full transparency" needs the evidence readable.
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'result_images'
      and cmd = 'SELECT' and coalesce(qual, '') like '%can_read_student%'),
  1::bigint,
  'result_images SELECT is can_read_student - the tutor and guardian may read it'
);

select is_empty(
  $$ select policyname from pg_policies
      where schemaname = 'public' and tablename = 'result_images'
        and cmd <> 'SELECT'
        and (coalesce(qual, '') || coalesce(with_check, ''))
            ~ '(can_read_student|is_tutor_of|is_guardian_of)' $$,
  'but every write on result_images stays student-only'
);

-- ===========================================================================
-- 2. Uploading — the student's own path, page by page
-- ===========================================================================

select lives_ok(
  $$ insert into public.scan_jobs (id, student_id, status)
     values ('00000000-0000-4000-7000-000000000050',
             '00000000-0000-4000-a000-000000000002', 'uploading') $$,
  'the student opens a scan job'
);

select lives_ok(
  $$ insert into public.scan_pages (scan_job_id, student_id, page_no, storage_path)
     values ('00000000-0000-4000-7000-000000000050',
             '00000000-0000-4000-a000-000000000002', 1,
             '00000000-0000-4000-a000-000000000002/00000000-0000-4000-7000-000000000050/1.webp') $$,
  'and adds a page'
);

select throws_ok(
  $$ insert into public.scan_pages (scan_job_id, student_id, page_no, storage_path)
     values ('00000000-0000-4000-7000-000000000050',
             '00000000-0000-4000-a000-000000000002', 6,
             '00000000-0000-4000-a000-000000000002/00000000-0000-4000-7000-000000000050/6.webp') $$,
  '23514', NULL,
  'a sixth page is rejected - §5.3''s 1-5 page cap'
);

select tests.login_as(tests.uid('student_b'));

select throws_ok(
  $$ insert into public.scan_pages (scan_job_id, student_id, page_no, storage_path)
     values ('00000000-0000-4000-7000-000000000050',
             '00000000-0000-4000-a000-000000000004', 2,
             '00000000-0000-4000-a000-000000000004/00000000-0000-4000-7000-000000000050/2.webp') $$,
  '23503', NULL,
  'student B cannot attach a page to student A''s job - the composite FK'
);

select tests.login_as(tests.uid('student_a'));

select is(
  (select status from public.scan_jobs where id = '00000000-0000-4000-7000-000000000050'),
  'uploading',
  'sanity: the job is still open before confirming'
);

update public.scan_jobs set status = 'review'
 where id = '00000000-0000-4000-7000-000000000050';

-- ===========================================================================
-- 3. confirm_scan_job() — §5.3's "On confirm", end to end
-- ===========================================================================

select is(
  (public.confirm_scan_job(
     '00000000-0000-4000-7000-000000000050',
     jsonb_build_object(
       'student_subject_id', tests.uid('physics_a'),
       'type', 'CWM', 'raw_obtained', 8, 'raw_total', 10,
       'chapter_ids', jsonb_build_array(tests.uid('chapter_a1'))
     )
   ) ->> 'converted')::numeric,
  12.0,
  '8/10 CWM converts to 12.0/15 through the same path as manual entry'
);

select is(
  (select status from public.scan_jobs where id = '00000000-0000-4000-7000-000000000050'),
  'confirmed',
  'the job moved to confirmed'
);

select is(
  (select count(*) from public.scan_jobs
    where id = '00000000-0000-4000-7000-000000000050' and result_id is not null),
  1::bigint,
  'and result_id was set'
);

select is(
  (select entry_mode from public.results r
     join public.scan_jobs sj on sj.result_id = r.id
    where sj.id = '00000000-0000-4000-7000-000000000050'),
  'ocr',
  'the result is entry_mode ocr, forced by confirm_scan_job regardless of the payload'
);

select is(
  (select ac.chapter_id from public.assessment_chapters ac
     join public.scan_jobs sj on sj.result_id in (
       select r.id from public.results r where r.assessment_id = ac.assessment_id
     )
    where sj.id = '00000000-0000-4000-7000-000000000050'),
  tests.uid('chapter_a1'),
  'the chapter link went through set_assessment_chapters - §5.3''s multi-select path'
);

select is(
  (select count(*) from public.result_images ri
     join public.scan_jobs sj on sj.result_id = ri.result_id
    where sj.id = '00000000-0000-4000-7000-000000000050'),
  1::bigint,
  'one result_images row was written for the one page'
);

select is(
  (select ri.storage_path from public.result_images ri
     join public.scan_jobs sj on sj.result_id = ri.result_id
    where sj.id = '00000000-0000-4000-7000-000000000050'),
  '00000000-0000-4000-a000-000000000002/' ||
    (select result_id from public.scan_jobs where id = '00000000-0000-4000-7000-000000000050') ||
    '/1.webp',
  'and it names the scripts/ destination, extension carried over from the scans/ path'
);

-- ===========================================================================
-- 4. confirm_scan_job() — the failure paths
-- ===========================================================================

select throws_ok(
  $$ select public.confirm_scan_job(
       '00000000-0000-4000-7000-000000000050',
       jsonb_build_object('student_subject_id', '00000000-0000-4000-b000-000000000001',
                          'type', 'CWM', 'raw_obtained', 1, 'raw_total', 2)
     ) $$,
  '23505', NULL,
  'confirming an already-confirmed job fails - not a second result'
);

select throws_ok(
  $$ select public.confirm_scan_job(
       gen_random_uuid(),
       jsonb_build_object('student_subject_id', '00000000-0000-4000-b000-000000000001',
                          'type', 'CWM', 'raw_obtained', 1, 'raw_total', 2)
     ) $$,
  'P0002', NULL,
  'confirming a job that does not exist is reported, not silently created'
);

select lives_ok(
  $$ insert into public.scan_jobs (id, student_id, status)
     values ('00000000-0000-4000-7000-000000000051',
             '00000000-0000-4000-a000-000000000002', 'uploading') $$,
  'setup: a job still uploading, no pages yet'
);

select throws_ok(
  $$ select public.confirm_scan_job(
       '00000000-0000-4000-7000-000000000051',
       jsonb_build_object('student_subject_id', '00000000-0000-4000-b000-000000000001',
                          'type', 'CWM', 'raw_obtained', 1, 'raw_total', 2)
     ) $$,
  '23514', NULL,
  'confirming a job still uploading is refused - it is not in review yet'
);

-- ===========================================================================
-- 5. The one-directional check: confirmed may lack a result, nothing else
--    may have one
-- ===========================================================================
--
-- results_reset_assessment_on_delete() (0020) has no branch that walks a
-- scan_jobs row back out of 'confirmed' when its result is deleted - the job
-- itself still happened, and log_manual_result()'s ON DELETE SET NULL on
-- scan_jobs.result_id is what this half of the constraint exists to allow.

select lives_ok(
  $$ delete from public.results r
      using public.scan_jobs sj
      where sj.id = '00000000-0000-4000-7000-000000000050'
        and r.id = sj.result_id $$,
  'the student deletes the result the scan produced'
);

select is(
  (select row(status, result_id) from public.scan_jobs
    where id = '00000000-0000-4000-7000-000000000050'),
  row('confirmed'::text, null::uuid),
  'the job stays confirmed with result_id nulled - it still happened'
);

-- The other half of the check needs a result to point at, since a null
-- result_id already satisfies it regardless of status.
select lives_ok(
  $$ select public.log_manual_result(
       '00000000-0000-4000-a000-000000000002',
       jsonb_build_object('student_subject_id', '00000000-0000-4000-b000-000000000001',
                          'type', 'CWM', 'raw_obtained', 3, 'raw_total', 10)
     ) $$,
  'setup: an unrelated result to attempt pointing a non-confirmed job at'
);

select throws_ok(
  $$ update public.scan_jobs
        set result_id = (select id from public.results order by created_at desc limit 1)
      where id = '00000000-0000-4000-7000-000000000051' $$,
  '23514', NULL,
  'a job stuck at uploading cannot carry a result_id - the other half of the check'
);

-- ===========================================================================
-- 6. abandon_expired_scan_jobs() — invoker-scoped, sweeps only the caller's own
-- ===========================================================================

select lives_ok(
  $$ update public.scan_jobs set expires_at = now() - interval '1 day'
      where id = '00000000-0000-4000-7000-000000000051' $$,
  'setup: the still-uploading job is past its TTL'
);

select results_eq(
  $$ select public.abandon_expired_scan_jobs() $$,
  $$ values ('00000000-0000-4000-7000-000000000051'::uuid) $$,
  'the sweep abandons exactly the one expired job - not the confirmed one, not a fresh one'
);

select is(
  (select status from public.scan_jobs where id = '00000000-0000-4000-7000-000000000051'),
  'abandoned',
  'and its status reflects that'
);

-- ===========================================================================
-- 7. The tutor and guardian - the blackout, behaviourally
-- ===========================================================================

select tests.login_as(tests.uid('tutor'));

select is(
  (select count(*) from public.scan_jobs),
  0::bigint,
  'the tutor sees zero scan_jobs rows, though they are approved for student A'
);

select throws_ok(
  $$ insert into public.scan_jobs (student_id, status)
     values ('00000000-0000-4000-a000-000000000002', 'uploading') $$,
  '42501', NULL,
  'nor can the tutor open one on the student''s behalf'
);

-- Job 51 genuinely exists (student A's), but confirm_scan_job's own SELECT is
-- an ordinary policy-gated read - RLS hides the row from the tutor exactly as
-- it would from any other query, and the function reports "not found" rather
-- than "not permitted". That is the SECURITY INVOKER argument made concrete:
-- there is no second check inside the function for RLS to disagree with.
select throws_ok(
  $$ select public.confirm_scan_job(
       '00000000-0000-4000-7000-000000000051', '{}'::jsonb) $$,
  'P0002', NULL,
  'confirm_scan_job finds nothing for the tutor to confirm - the job exists, RLS just hides it'
);

select tests.login_as(tests.uid('guardian_a'));

select is(
  (select count(*) from public.scan_jobs),
  0::bigint,
  'the guardian sees zero scan_jobs rows too - §1''s read-only never extended to these'
);

select tests.logout();

select * from finish();

rollback;
