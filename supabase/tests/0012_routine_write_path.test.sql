-- 0012 — commit_routine_grid() and update_routine_period() (SPEC.md §3.3, §5.1;
-- 0011 migration)
--
-- 0011's suite proves routines/routine_periods stay student-only at the table
-- level. This file proves the two definer functions that are the tutor's only
-- way past that, on the same terms 0010's suite holds commit_syllabus_tree()
-- to: each does its own authorization check rather than widening a policy,
-- neither duplicates rows when the same grid is committed twice, and the
-- alias capture §5.1 asks for actually happens — including for a tutor, who
-- cannot write subject_aliases through the table policy at all.
--
-- The grid below is deliberately small and shaped like the real sample: a
-- Sunday with Physics under a short form ('Phy'), the vertical BREAK column of
-- §5.1 rule 1, and a Maths period, which §5.1 rule 5 maps to the parent
-- subject and never to a paper.
--
-- Run against a local stack:
--
--     supabase db reset
--     supabase test db

begin;

set search_path = public, extensions, tests;

select plan(38);

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
    when 'maths_a'    then '00000000-0000-4000-b000-000000000002'
    when 'physics_b'  then '00000000-0000-4000-b000-000000000003'
    when 'routine_1'  then '00000000-0000-4000-9000-000000000001'
    when 'routine_2'  then '00000000-0000-4000-9000-000000000002'
  end::uuid;
$fn$;

grant execute on function tests.uid(text) to authenticated, anon;

-- Three Sunday cells. 'Phy' is a short form, so committing it must capture an
-- alias; 'Maths' is student A's own display_name, so it must not.
create or replace function tests.routine_v1()
returns jsonb
language sql
immutable
as $fn$
  select '{
    "routine_id": "00000000-0000-4000-9000-000000000001",
    "image_path": "00000000-0000-4000-a000-000000000002/00000000-0000-4000-9000-000000000001/1.webp",
    "periods": [
      {"day_of_week": 0, "period_no": 1, "start_time": "08:15", "end_time": "08:55",
       "raw_text": "Phy", "teacher_raw": "Shafiul",
       "student_subject_id": "00000000-0000-4000-b000-000000000001", "is_academic": true},
      {"day_of_week": 0, "period_no": 2, "start_time": "10:55", "end_time": "11:25",
       "raw_text": "B", "is_academic": false},
      {"day_of_week": 0, "period_no": 3, "start_time": "11:25", "end_time": "12:05",
       "raw_text": "Maths", "teacher_raw": "Rakin",
       "student_subject_id": "00000000-0000-4000-b000-000000000002", "is_academic": true}
    ]
  }'::jsonb;
$fn$;

-- ===========================================================================
-- 1. Authorization — the check both functions exist to enforce
-- ===========================================================================

select tests.login_as_anon();

select throws_ok(
  $$ select public.commit_routine_grid(
       '00000000-0000-4000-a000-000000000002', '{"periods":[]}'::jsonb, '2026-2027') $$,
  '42501', NULL,
  'anon cannot call commit_routine_grid at all'
);

select throws_ok(
  $$ select public.update_routine_period(gen_random_uuid(), '{}'::jsonb) $$,
  '42501', NULL,
  'anon cannot call update_routine_period either'
);

select tests.login_as(tests.uid('student_b'));

select throws_ok(
  $$ select public.commit_routine_grid(
       '00000000-0000-4000-a000-000000000002', '{"periods":[]}'::jsonb, '2026-2027') $$,
  '42501', NULL,
  'student B cannot commit student A''s routine — not themselves, not their tutor'
);

select tests.login_as(tests.uid('guardian_a'));

select throws_ok(
  $$ select public.commit_routine_grid(
       '00000000-0000-4000-a000-000000000002', '{"periods":[]}'::jsonb, '2026-2027') $$,
  '42501', NULL,
  'guardian A cannot commit a routine — read-only everywhere, RPC included'
);

select tests.login_as(tests.uid('tutor'));

select throws_ok(
  $$ select public.commit_routine_grid(
       gen_random_uuid(), '{"periods":[]}'::jsonb, '2026-2027') $$,
  '42501', NULL,
  'the tutor cannot commit for a student they do not tutor'
);

-- ===========================================================================
-- 2. Input validation, as an authorized caller
-- ===========================================================================

select tests.login_as(tests.uid('student_a'));

select throws_ok(
  $$ select public.commit_routine_grid(
       '00000000-0000-4000-a000-000000000002', '{"periods":[]}'::jsonb, '  ') $$,
  '23514', NULL,
  'an empty session label is rejected'
);

select throws_ok(
  $$ select public.commit_routine_grid(
       '00000000-0000-4000-a000-000000000002', '{}'::jsonb, '2026-2027') $$,
  '23514', NULL,
  'a grid with no periods array is rejected'
);

-- §5.1 rule 6, enforced in the RPC as well as the check constraint, so the
-- caller gets a sentence instead of a constraint name.
select throws_ok(
  $$ select public.commit_routine_grid(
       '00000000-0000-4000-a000-000000000002',
       '{"periods":[{"day_of_week":5,"period_no":1}]}'::jsonb, '2026-2027') $$,
  '23514', NULL,
  'a Friday period is rejected — the routine runs Sunday to Thursday'
);

select throws_ok(
  $$ select public.commit_routine_grid(
       '00000000-0000-4000-a000-000000000002',
       '{"periods":[{"day_of_week":0,"period_no":0}]}'::jsonb, '2026-2027') $$,
  '23514', NULL,
  'period 0 is rejected — periods are numbered from 1'
);

-- The cross-family guard, checked in the function so it reads as a sentence
-- rather than surfacing 0010's composite FK violation.
select throws_ok(
  $$ select public.commit_routine_grid(
       '00000000-0000-4000-a000-000000000002',
       '{"periods":[{"day_of_week":0,"period_no":1,"raw_text":"Physics",
         "student_subject_id":"00000000-0000-4000-b000-000000000003"}]}'::jsonb,
       '2026-2027') $$,
  '23514', NULL,
  'a cell cannot point at student B''s Physics'
);

-- ===========================================================================
-- 3. The tutor commits student A's routine
-- ===========================================================================

select tests.login_as(tests.uid('tutor'));

select is(
  public.commit_routine_grid(tests.uid('student_a'), tests.routine_v1(), '2026-2027'),
  jsonb_build_object(
    'routine_id',        tests.uid('routine_1'),
    'periods_committed', 3,
    'periods_removed',   0,
    'aliases_captured',  1
  ),
  'the tutor commits student A''s routine and gets back the right counts'
);

select is(
  (select count(*) from public.routine_periods where routine_id = tests.uid('routine_1')),
  3::bigint,
  'all three Sunday cells were written'
);

select is(
  (select image_path from public.routines where id = tests.uid('routine_1')),
  '00000000-0000-4000-a000-000000000002/00000000-0000-4000-9000-000000000001/1.webp',
  'the storage path the client chose was stored with the routine'
);

select is(
  (select is_academic from public.routine_periods
    where routine_id = tests.uid('routine_1') and period_no = 2),
  false,
  'the BREAK cell is non-academic — §5.1 rule 1'
);

-- ===========================================================================
-- 4. Alias capture — §5.1's "write the pair into subject_aliases"
-- ===========================================================================
--
-- This is the assertion that matters most for the tutor. subject_aliases_insert
-- in 0008 requires student_id = auth.uid(), so the row below is one the tutor
-- could not have written through the table policy at any point.

select is(
  (select student_subject_id from public.subject_aliases
    where student_id = tests.uid('student_a') and lower(alias_text) = 'phy'),
  tests.uid('physics_a'),
  'committing the short form "Phy" captured a student-scoped alias for Physics'
);

select is(
  (select source from public.subject_aliases
    where student_id = tests.uid('student_a') and lower(alias_text) = 'phy'),
  'routine',
  'and it is marked as coming from the routine'
);

select is(
  (select count(*) from public.subject_aliases
    where student_id = tests.uid('student_a') and lower(alias_text) = 'maths'),
  0::bigint,
  '"Maths" is student A''s own display_name, so no alias was captured for it'
);

-- The global 'Phy' -> catalogue alias from seed.sql is a different row under a
-- different partial index. A student-scoped correction must not touch it.
select is(
  (select count(*) from public.subject_aliases
    where student_id is null and lower(alias_text) = 'phy'),
  1::bigint,
  'the shipped global "Phy" alias is untouched — one student cannot reshape it'
);

-- ===========================================================================
-- 5. Idempotency — the same grid twice
-- ===========================================================================

select tests.login_as(tests.uid('student_a'));

select is(
  public.commit_routine_grid(tests.uid('student_a'), tests.routine_v1(), '2026-2027'),
  jsonb_build_object(
    'routine_id',        tests.uid('routine_1'),
    'periods_committed', 3,
    'periods_removed',   0,
    'aliases_captured',  1
  ),
  'student A re-commits the identical grid and the counts are unchanged'
);

select is(
  (select count(*) from public.routine_periods where routine_id = tests.uid('routine_1')),
  3::bigint,
  'the repeat commit did not duplicate a single cell'
);

select is(
  (select count(*) from public.routines where student_id = tests.uid('student_a')),
  1::bigint,
  'and it did not create a second routine'
);

-- ===========================================================================
-- 6. The grid is authoritative — a removed period is deleted
-- ===========================================================================

select is(
  public.commit_routine_grid(
    tests.uid('student_a'),
    jsonb_set(tests.routine_v1(), '{periods}',
      (tests.routine_v1() -> 'periods') - 2),
    '2026-2027'
  ) -> 'periods_removed',
  '1'::jsonb,
  'dropping the Maths cell from the payload removes it from the routine'
);

select is(
  (select count(*) from public.routine_periods where routine_id = tests.uid('routine_1')),
  2::bigint,
  'two cells remain'
);

-- The alias survives the cell that produced it. §5.1 wants the short form to
-- keep resolving on a future paper header, not only while the period exists.
select is(
  (select count(*) from public.subject_aliases
    where student_id = tests.uid('student_a') and lower(alias_text) = 'phy'),
  1::bigint,
  'the captured alias outlives the grid edit'
);

-- ===========================================================================
-- 7. A new routine retires the old one
-- ===========================================================================

select lives_ok(
  $$ select public.commit_routine_grid(
       '00000000-0000-4000-a000-000000000002',
       '{"routine_id":"00000000-0000-4000-9000-000000000002",
         "periods":[{"day_of_week":1,"period_no":1,"raw_text":"Chemistry"}]}'::jsonb,
       '2026-2027') $$,
  'student A commits a second routine for the same session'
);

select is(
  (select count(*) from public.routines
    where student_id = tests.uid('student_a') and is_active),
  1::bigint,
  'only one routine is in force'
);

select is(
  (select is_active from public.routines where id = tests.uid('routine_1')),
  false,
  'the first routine was retired, not deleted — old predictions stay readable'
);

-- The client names the routine id, so it could name someone else's.
select tests.login_as(tests.uid('tutor'));

select throws_ok(
  $$ select public.commit_routine_grid(
       '00000000-0000-4000-a000-000000000004',
       '{"routine_id":"00000000-0000-4000-9000-000000000002","periods":[]}'::jsonb,
       '2026-2027') $$,
  '42501', NULL,
  'the tutor cannot commit student A''s routine id under student B — checked explicitly'
);

-- ===========================================================================
-- 8. update_routine_period — the single-cell path
-- ===========================================================================

select throws_ok(
  $$ select public.update_routine_period(gen_random_uuid(), '{"raw_text":"X"}'::jsonb) $$,
  'P0002', NULL,
  'editing a period that no longer exists says so'
);

select tests.login_as(tests.uid('guardian_a'));

select throws_ok(
  $$ select public.update_routine_period(
       (select id from public.routine_periods
         where routine_id = '00000000-0000-4000-9000-000000000001' and period_no = 1),
       '{"raw_text":"Chemistry"}'::jsonb) $$,
  '42501', NULL,
  'guardian A cannot edit a cell through the RPC either'
);

select tests.login_as(tests.uid('tutor'));

select lives_ok(
  $$ select public.update_routine_period(
       (select id from public.routine_periods
         where routine_id = '00000000-0000-4000-9000-000000000001' and period_no = 1),
       '{"teacher_raw":"Shafiur"}'::jsonb) $$,
  'the tutor corrects a teacher''s spelling mid-session'
);

-- The whole point of reading p_patch key by key: an absent key is "I did not
-- touch this", not "make it null".
select is(
  (select raw_text from public.routine_periods
    where routine_id = tests.uid('routine_1') and period_no = 1),
  'Phy',
  'the keys the patch omitted were left alone'
);

select is(
  (select teacher_raw from public.routine_periods
    where routine_id = tests.uid('routine_1') and period_no = 1),
  'Shafiur',
  'and the key it carried was applied'
);

-- ...while an explicit null is a real instruction to clear the column.
select lives_ok(
  $$ select public.update_routine_period(
       (select id from public.routine_periods
         where routine_id = '00000000-0000-4000-9000-000000000001' and period_no = 1),
       '{"teacher_raw":null}'::jsonb) $$,
  'an explicit null is accepted'
);

select is(
  (select teacher_raw from public.routine_periods
    where routine_id = tests.uid('routine_1') and period_no = 1),
  NULL,
  'and it cleared the teacher'
);

-- A correction re-points the short form. §5.1's alias table is a record of what
-- the human last decided, not of the first guess.
select lives_ok(
  $$ select public.update_routine_period(
       (select id from public.routine_periods
         where routine_id = '00000000-0000-4000-9000-000000000001' and period_no = 1),
       '{"student_subject_id":"00000000-0000-4000-b000-000000000002"}'::jsonb) $$,
  'the tutor re-points the "Phy" cell at Maths'
);

select is(
  (select student_subject_id from public.subject_aliases
    where student_id = tests.uid('student_a') and lower(alias_text) = 'phy'),
  tests.uid('maths_a'),
  'and the alias followed the correction rather than keeping the stale mapping'
);

select throws_ok(
  $$ select public.update_routine_period(
       (select id from public.routine_periods
         where routine_id = '00000000-0000-4000-9000-000000000001' and period_no = 1),
       '{"student_subject_id":"00000000-0000-4000-b000-000000000003"}'::jsonb) $$,
  '23514', NULL,
  'a cell still cannot be pointed at student B''s subject'
);

select tests.logout();

select * from finish();

rollback;
