-- 0011 — routines and routine_periods at the table level (ARCHITECTURE.md §3.2, §3.3;
-- 0010 migration)
--
-- 0009's blanket "every table in public has RLS on" assertion already fires if
-- 0010 forgets to enable it. This file is the behavioural half: the routine
-- holds where a child physically is at 09:40 on a Tuesday and which adult is in
-- the room, so "family B cannot read family A's" needs asserting directly and
-- not by inference from the subject-tree suite.
--
-- It also pins the two things 0010 decided that no other file records:
--
--   * writes are the student's alone at the table level, tutor included. Since
--     0019 that is true of the definer RPCs as well, covered by 0012's suite —
--     the routine is the student's end to end. If a future migration ever
--     widens routine_periods_insert, the tutor assertion here
--     fails and says so.
--   * the storage bucket is private and its policies shipped with it. 0006's
--     header made that a rule; this is the assertion behind the rule.
--
-- Run against a local stack:
--
--     supabase db reset
--     supabase test db

begin;

set search_path = public, extensions, tests;

select plan(28);

-- ------------------------------------------------------------- test names ---
-- Redefined here: 0009's and 0010's copies live inside their own transactions
-- and are rolled back with them.

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
    when 'physics_b'  then '00000000-0000-4000-b000-000000000003'
    when 'routine_a'  then '00000000-0000-4000-9000-000000000001'
    when 'routine_b'  then '00000000-0000-4000-9000-000000000002'
    when 'period_a1'  then '00000000-0000-4000-8000-000000000001'
    when 'period_a2'  then '00000000-0000-4000-8000-000000000002'
    when 'period_b1'  then '00000000-0000-4000-8000-000000000003'
  end::uuid;
$fn$;

grant execute on function tests.uid(text) to authenticated, anon;

-- ===========================================================================
-- 1. Structural
-- ===========================================================================

select is(
  (select count(*) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('routines', 'routine_periods')
      and c.relrowsecurity),
  2::bigint,
  'RLS is on for both routine tables'
);

select is(
  (select public from storage.buckets where id = 'routines'),
  false,
  'the routines bucket is private — §3.3 allows signed URLs only'
);

-- 0006: "the bucket and its policies must ship in the same migration". A bucket
-- with RLS on storage.objects and no policy denies everything, which is safe
-- but broken; a bucket whose policies are forgotten in a later refactor is not.
select is(
  (select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'routines_storage_%'),
  4::bigint,
  'all four routines storage policies shipped with the bucket'
);

-- ===========================================================================
-- 2. Each student writes their own routine through the ordinary policies
-- ===========================================================================

select tests.login_as(tests.uid('student_a'));

select lives_ok(
  $$ insert into public.routines (id, student_id, session_label)
     values ('00000000-0000-4000-9000-000000000001',
             '00000000-0000-4000-a000-000000000002', '2026-2027') $$,
  'student A creates their own routine'
);

-- Sunday period 1 is Physics; Sunday period 2 is the vertical BREAK column of
-- §5.1 rule 1 — no subject, is_academic false.
select lives_ok(
  $$ insert into public.routine_periods
       (id, routine_id, student_id, day_of_week, period_no, start_time, end_time,
        raw_text, teacher_raw, student_subject_id, is_academic)
     values
       ('00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-9000-000000000001',
        '00000000-0000-4000-a000-000000000002', 0, 1, '08:15', '08:55',
        'Physics', 'Shafiul', '00000000-0000-4000-b000-000000000001', true),
       ('00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-9000-000000000001',
        '00000000-0000-4000-a000-000000000002', 0, 2, '10:55', '11:25',
        'B', null, null, false) $$,
  'student A fills two Sunday cells, one academic and one break'
);

select tests.login_as(tests.uid('student_b'));

select lives_ok(
  $$ insert into public.routines (id, student_id, session_label)
     values ('00000000-0000-4000-9000-000000000002',
             '00000000-0000-4000-a000-000000000004', '2026-2027') $$,
  'student B creates their own, unrelated routine'
);

select lives_ok(
  $$ insert into public.routine_periods
       (id, routine_id, student_id, day_of_week, period_no, raw_text, student_subject_id)
     values ('00000000-0000-4000-8000-000000000003',
             '00000000-0000-4000-9000-000000000002',
             '00000000-0000-4000-a000-000000000004', 0, 1, 'Physics',
             '00000000-0000-4000-b000-000000000003') $$,
  'student B fills a cell of their own'
);

-- ===========================================================================
-- 3. Constraints
-- ===========================================================================

select tests.login_as(tests.uid('student_a'));

-- §5.1 rule 6: Friday and Saturday are the weekend and never appear.
select throws_ok(
  $$ insert into public.routine_periods
       (routine_id, student_id, day_of_week, period_no, raw_text)
     values ('00000000-0000-4000-9000-000000000001',
             '00000000-0000-4000-a000-000000000002', 5, 1, 'Physics') $$,
  '23514', NULL,
  'a Friday period is rejected — the routine runs Sunday to Thursday'
);

select throws_ok(
  $$ insert into public.routine_periods
       (routine_id, student_id, day_of_week, period_no, raw_text)
     values ('00000000-0000-4000-9000-000000000001',
             '00000000-0000-4000-a000-000000000002', 0, 1, 'Maths') $$,
  '23505', NULL,
  'a second cell for Sunday period 1 collides — one cell per day per period'
);

-- The composite FK from 0010. This is the structural guard that a routine cell
-- can never point at another family's subject, whatever a policy says.
select throws_ok(
  $$ insert into public.routine_periods
       (routine_id, student_id, day_of_week, period_no, raw_text, student_subject_id)
     values ('00000000-0000-4000-9000-000000000001',
             '00000000-0000-4000-a000-000000000002', 1, 1, 'Physics',
             '00000000-0000-4000-b000-000000000003') $$,
  '23503', NULL,
  'student A cannot point a cell at student B''s Physics — the composite FK denies it'
);

select throws_ok(
  $$ insert into public.routines (student_id, session_label)
     values ('00000000-0000-4000-a000-000000000002', '2026-2027') $$,
  '23505', NULL,
  'a second active routine for the same session collides — only one is in force'
);

select lives_ok(
  $$ insert into public.routines (student_id, session_label, is_active)
     values ('00000000-0000-4000-a000-000000000002', '2026-2027', false) $$,
  'a retired routine for the same session is fine — history is kept, not deleted'
);

-- ===========================================================================
-- 4. A cannot see B
-- ===========================================================================

select is(
  (select count(*) from public.routines where student_id = tests.uid('student_b')),
  0::bigint,
  'student A cannot see student B''s routine'
);

select is(
  (select count(*) from public.routine_periods where id = tests.uid('period_b1')),
  0::bigint,
  'student A cannot see student B''s periods'
);

select tests.login_as(tests.uid('guardian_b'));

select is(
  (select count(*) from public.routines where id = tests.uid('routine_a')),
  0::bigint,
  'guardian B cannot see family A''s routine'
);

select is(
  (select count(*) from public.routine_periods where routine_id = tests.uid('routine_a')),
  0::bigint,
  'guardian B cannot see family A''s periods — not where their child is at 09:40'
);

-- ===========================================================================
-- 5. The linked guardian reads, and only reads
-- ===========================================================================

select tests.login_as(tests.uid('guardian_a'));

select is(
  (select count(*) from public.routine_periods where routine_id = tests.uid('routine_a')),
  2::bigint,
  'guardian A reads their own student''s routine — §1 full transparency'
);

-- Aimed at the student, which is the threat: a guardian writing rows that the
-- student and tutor would then read as the child's real timetable. The
-- guardian's own-id case — which this predicate alone did not deny — is
-- migration 0012's, and is asserted in 0013's suite.
select throws_ok(
  $$ insert into public.routines (student_id, session_label)
     values ('00000000-0000-4000-a000-000000000002', 'Term 1') $$,
  '42501', NULL,
  'guardian A cannot insert a routine for their student'
);

-- The silent-zero-rows case 0009's header warns about: the guardian holds the
-- UPDATE privilege, the USING clause filters every candidate away, and Postgres
-- reports success. Read the row back rather than trusting the lack of an error.
select lives_ok(
  $$ update public.routine_periods set raw_text = 'Chemistry'
      where id = '00000000-0000-4000-8000-000000000001' $$,
  'guardian A''s update raises nothing — the policy filters rather than errors'
);

select is(
  (select raw_text from public.routine_periods where id = tests.uid('period_a1')),
  'Physics',
  'and it changed nothing: the cell still says Physics'
);

select lives_ok(
  $$ delete from public.routine_periods
      where id = '00000000-0000-4000-8000-000000000001' $$,
  'guardian A''s delete raises nothing'
);

select is(
  (select count(*) from public.routine_periods where id = tests.uid('period_a1')),
  1::bigint,
  'and the period is still there'
);

-- ===========================================================================
-- 6. The tutor reads, but cannot write at the table level
-- ===========================================================================
--
-- §3.3 grants the tutor UPDATE on `results` and nothing else. The routine was
-- once reachable through 0011's definer RPC; 0019 closed that too, so these
-- assertions now say the same thing at both levels. They are what would fail
-- if either were ever "simplified" into a widened table policy.

select tests.login_as(tests.uid('tutor'));

-- Distinct students, not rows: student A also has the retired routine from
-- section 3, and the point here is reach across families, not row count.
select is(
  (select count(distinct student_id) from public.routines),
  2::bigint,
  'the tutor reads the routines of both linked students'
);

select throws_ok(
  $$ insert into public.routine_periods
       (routine_id, student_id, day_of_week, period_no, raw_text)
     values ('00000000-0000-4000-9000-000000000001',
             '00000000-0000-4000-a000-000000000002', 1, 3, 'Physics') $$,
  '42501', NULL,
  'the tutor cannot insert a period directly — only through commit_routine_grid'
);

select lives_ok(
  $$ update public.routine_periods set raw_text = 'Chemistry'
      where id = '00000000-0000-4000-8000-000000000001' $$,
  'the tutor''s direct update raises nothing — filtered, not errored'
);

select is(
  (select raw_text from public.routine_periods where id = tests.uid('period_a1')),
  'Physics',
  'and it changed nothing at the table level'
);

-- ===========================================================================
-- 7. anon
-- ===========================================================================

select tests.login_as_anon();

select throws_ok(
  $$ select count(*) from public.routines $$,
  '42501', NULL,
  'anon has no privilege on routines at all — 0006''s revoke still bites'
);

select throws_ok(
  $$ select count(*) from public.routine_periods $$,
  '42501', NULL,
  'anon has no privilege on routine_periods either'
);

select tests.logout();

select * from finish();

rollback;
