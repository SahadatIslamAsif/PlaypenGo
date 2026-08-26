-- 0013 — guardians write nothing, on any table, under any id
-- (CLAUDE.md "Guardians are read-only"; SPEC.md §1, §3.3; 0012 migration)
--
-- 0009 and 0011 already assert the case that matters most: a guardian cannot
-- write rows ABOUT their student. Both did so by aiming the insert at the
-- student's id, which the old `student_id = auth.uid()` predicate rejected.
--
-- That left the case this file exists for. A guardian supplying their OWN id
-- satisfied `student_id = auth.uid()` and the insert succeeded — junk rows
-- nothing reads, but a write nonetheless, on tables CLAUDE.md says guardians
-- have no insert policy on at all. 0012 closed it by requiring the caller's
-- profile role to be 'student'; these are the assertions that keep it closed.
--
-- Every table with a `student_id = auth.uid()` write predicate is covered.
-- 0007's tables are deliberately absent: profiles, link_codes,
-- link_code_attempts, guardian_links and tutor_links have no INSERT policy to
-- begin with, and 0009 already asserts that.
--
-- The last section is the regression half. A role check in a policy is an easy
-- way to lock out the people who are supposed to be writing, so the student's
-- own path and both tutor RPC paths are re-asserted here rather than trusted.
--
-- Run against a local stack:
--
--     supabase db reset
--     supabase test db

begin;

set search_path = public, extensions, tests;

select plan(30);

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
    when 'guardian_c' then '00000000-0000-4000-a000-000000000006'
    when 'physics_a'  then '00000000-0000-4000-b000-000000000001'
    when 'maths_a'    then '00000000-0000-4000-b000-000000000002'
    when 'paper_a1'   then '00000000-0000-4000-f000-000000000001'
    when 'chapter_a1' then '00000000-0000-4000-c000-000000000001'
    when 'routine_a'  then '00000000-0000-4000-9000-000000000001'
  end::uuid;
$fn$;

grant execute on function tests.uid(text) to authenticated, anon;

-- ===========================================================================
-- 1. Structural — every write policy on these six tables names the role
-- ===========================================================================
--
-- Six tables times three verbs. A behavioural test only covers the table
-- someone remembered to write one for; this fails if a later migration
-- rewrites any of these eighteen policies and drops the check.

select is(
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename in ('student_subjects', 'subject_papers', 'chapters',
                        'subject_aliases', 'routines', 'routine_periods')
      and cmd in ('INSERT', 'UPDATE', 'DELETE')),
  18::bigint,
  'all eighteen write policies are present across the six student-owned tables'
);

select is(
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename in ('student_subjects', 'subject_papers', 'chapters',
                        'subject_aliases', 'routines', 'routine_periods')
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
      and coalesce(qual, '') || coalesce(with_check, '') like '%my_role%'),
  18::bigint,
  'and every one of them requires the caller to be a student'
);

-- SELECT is untouched: §1's full transparency depends on guardians reading.
select is(
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename in ('student_subjects', 'subject_papers', 'chapters',
                        'subject_aliases', 'routines', 'routine_periods')
      and cmd = 'SELECT'
      and coalesce(qual, '') like '%my_role%'),
  0::bigint,
  'no SELECT policy was narrowed — guardians still read everything they could'
);

-- ===========================================================================
-- 2. A guardian cannot insert under their OWN id — the gap 0012 closed
-- ===========================================================================
--
-- This is the shape that used to succeed. Every insert below names
-- guardian A's own uid as student_id, so the old predicate was satisfied.

select tests.login_as(tests.uid('guardian_a'));

select throws_ok(
  $$ insert into public.student_subjects (student_id, display_name)
     values ('00000000-0000-4000-a000-000000000003', 'Guardian-owned subject') $$,
  '42501', NULL,
  'guardian A cannot insert a subject under their own id'
);

select throws_ok(
  $$ insert into public.subject_papers (student_id, student_subject_id, name)
     values ('00000000-0000-4000-a000-000000000003',
             '00000000-0000-4000-b000-000000000001', 'Guardian-owned paper') $$,
  '42501', NULL,
  'guardian A cannot insert a paper under their own id'
);

select throws_ok(
  $$ insert into public.chapters (student_id, student_subject_id, name, source)
     values ('00000000-0000-4000-a000-000000000003',
             '00000000-0000-4000-b000-000000000001',
             'Guardian-owned chapter', 'manual') $$,
  '42501', NULL,
  'guardian A cannot insert a chapter under their own id'
);

-- The one with a read path attached: subject_aliases_select exposes rows with
-- student_id null to every signed-in user. A guardian could never reach that
-- (null is not equal to anything), but their own-id rows were real rows.
select throws_ok(
  $$ insert into public.subject_aliases
       (alias_text, student_subject_id, source, student_id)
     values ('GuardianAlias', '00000000-0000-4000-b000-000000000001', 'manual',
             '00000000-0000-4000-a000-000000000003') $$,
  '42501', NULL,
  'guardian A cannot insert an alias under their own id'
);

select throws_ok(
  $$ insert into public.routines (student_id, session_label)
     values ('00000000-0000-4000-a000-000000000003', '2026-2027') $$,
  '42501', NULL,
  'guardian A cannot insert a routine under their own id'
);

select throws_ok(
  $$ insert into public.routine_periods
       (routine_id, student_id, day_of_week, period_no, raw_text)
     values ('00000000-0000-4000-9000-000000000001',
             '00000000-0000-4000-a000-000000000003', 0, 1, 'Physics') $$,
  '42501', NULL,
  'guardian A cannot insert a routine period under their own id'
);

-- Nothing landed anywhere.
select is(
  (select count(*) from public.student_subjects where student_id = tests.uid('guardian_a'))
  + (select count(*) from public.subject_papers  where student_id = tests.uid('guardian_a'))
  + (select count(*) from public.chapters        where student_id = tests.uid('guardian_a'))
  + (select count(*) from public.subject_aliases where student_id = tests.uid('guardian_a'))
  + (select count(*) from public.routines        where student_id = tests.uid('guardian_a'))
  + (select count(*) from public.routine_periods where student_id = tests.uid('guardian_a')),
  0::bigint,
  'not one guardian-owned row exists on any of the six tables'
);

-- ===========================================================================
-- 3. Still denied under the student's id — 0009 and 0011's case, unchanged
-- ===========================================================================

select throws_ok(
  $$ insert into public.chapters (student_id, student_subject_id, name, source)
     values ('00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-b000-000000000001', 'For the student', 'manual') $$,
  '42501', NULL,
  'guardian A still cannot insert a chapter for their student'
);

select throws_ok(
  $$ insert into public.routines (student_id, session_label)
     values ('00000000-0000-4000-a000-000000000002', '2026-2027') $$,
  '42501', NULL,
  'guardian A still cannot insert a routine for their student'
);

-- ===========================================================================
-- 4. UPDATE and DELETE, on rows that already exist
-- ===========================================================================
--
-- These are filtered to zero rows rather than errored, so each is read back —
-- the silent-success case 0009's header warns about.

select lives_ok(
  $$ update public.chapters set status = 'p100'
      where id = '00000000-0000-4000-4000-000000000001'
         or id = '00000000-0000-4000-c000-000000000001' $$,
  'guardian A''s chapter update raises nothing'
);

select is(
  (select status from public.chapters where id = tests.uid('chapter_a1')),
  'p100',
  'and changed nothing — the seeded chapter was already p100'
);

select lives_ok(
  $$ delete from public.student_subjects
      where id = '00000000-0000-4000-b000-000000000001' $$,
  'guardian A''s subject delete raises nothing'
);

select is(
  (select count(*) from public.student_subjects where id = tests.uid('physics_a')),
  1::bigint,
  'and the subject is still there'
);

-- ===========================================================================
-- 5. A pending guardian is no different
-- ===========================================================================
--
-- §1 step 4: guardian C redeemed student A's code and was never approved. They
-- read nothing; they must not write either, under any id.

select tests.login_as(tests.uid('guardian_c'));

select throws_ok(
  $$ insert into public.student_subjects (student_id, display_name)
     values ('00000000-0000-4000-a000-000000000006', 'Pending-guardian subject') $$,
  '42501', NULL,
  'a pending guardian cannot insert under their own id either'
);

-- ===========================================================================
-- 6. The tutor is unchanged — still no table write, still a working RPC
-- ===========================================================================

select tests.login_as(tests.uid('tutor'));

select throws_ok(
  $$ insert into public.student_subjects (student_id, display_name)
     values ('00000000-0000-4000-a000-000000000001', 'Tutor-owned subject') $$,
  '42501', NULL,
  'the tutor cannot insert a subject under their own id'
);

select throws_ok(
  $$ insert into public.routines (student_id, session_label)
     values ('00000000-0000-4000-a000-000000000002', '2026-2027') $$,
  '42501', NULL,
  'the tutor still cannot insert a routine directly'
);

-- The regression that matters. Both RPCs are SECURITY DEFINER and 0006 did not
-- use FORCE ROW LEVEL SECURITY, so the owner is not subject to the policies
-- 0012 rewrote. If that ever stopped being true, these two would fail.
select lives_ok(
  $$ select public.commit_syllabus_tree(
       '00000000-0000-4000-a000-000000000002',
       '{"subjects":[{"name":"Physics","chapters":["1.1: Measurement"]}]}'::jsonb,
       'Term 1') $$,
  'the tutor can still commit a syllabus tree through the definer RPC'
);

select lives_ok(
  $$ select public.commit_routine_grid(
       '00000000-0000-4000-a000-000000000002',
       '{"periods":[{"day_of_week":0,"period_no":1,"raw_text":"Phy",
         "student_subject_id":"00000000-0000-4000-b000-000000000001"}]}'::jsonb,
       '2026-2027') $$,
  'the tutor can still commit a routine through the definer RPC'
);

select is(
  (select count(*) from public.routine_periods
    where student_id = tests.uid('student_a') and raw_text = 'Phy'),
  1::bigint,
  'and the period it wrote is really there'
);

-- Alias capture runs inside that RPC and writes subject_aliases — a table 0012
-- just narrowed to students. The definer path must still reach it.
select is(
  (select source from public.subject_aliases
    where student_id = tests.uid('student_a') and lower(alias_text) = 'phy'),
  'routine',
  'and §5.1''s alias capture still wrote, though the tutor is not a student'
);

select lives_ok(
  $$ select public.update_routine_period(
       (select id from public.routine_periods
         where student_id = '00000000-0000-4000-a000-000000000002'
           and raw_text = 'Phy' limit 1),
       '{"teacher_raw":"Shafiul"}'::jsonb) $$,
  'the tutor can still edit a single cell through the definer RPC'
);

-- ===========================================================================
-- 7. The student still owns their tree — the regression half
-- ===========================================================================

select tests.login_as(tests.uid('student_a'));

select lives_ok(
  $$ insert into public.student_subjects (student_id, display_name)
     values ('00000000-0000-4000-a000-000000000002', 'Biology') $$,
  'the student still adds their own subject'
);

select lives_ok(
  $$ insert into public.chapters (student_id, student_subject_id, name, source)
     values ('00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-b000-000000000001', 'Added by hand', 'manual') $$,
  'the student still adds their own chapter'
);

select lives_ok(
  $$ update public.chapters set status = 'p80'
      where id = '00000000-0000-4000-c000-000000000002' $$,
  'the student still taps their own progress'
);

select is(
  (select status from public.chapters where name = '1.2: Motion'
     and student_id = tests.uid('student_a')),
  'p80',
  'and the tap landed'
);

select lives_ok(
  $$ insert into public.subject_aliases
       (alias_text, student_subject_id, source, student_id)
     values ('Bio', '00000000-0000-4000-b000-000000000001', 'manual',
             '00000000-0000-4000-a000-000000000002') $$,
  'the student still records their own alias'
);

select lives_ok(
  $$ delete from public.chapters
      where student_id = '00000000-0000-4000-a000-000000000002'
        and name = 'Added by hand' $$,
  'the student still deletes their own chapter'
);

select tests.logout();

select * from finish();

rollback;
