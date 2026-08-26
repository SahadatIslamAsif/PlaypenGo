-- 0010 — commit_syllabus_tree() (SPEC.md §3.1, §4.2; 0009 migration)
--
-- 0009's pgTAP suite already proves student_subjects/subject_papers/chapters
-- stay student-only at the table level. This file proves the definer RPC that
-- is the tutor's ONLY path onto that tree: it does its own authorization
-- check (self or an approved tutor of the target student) rather than
-- widening any table policy, and it must not duplicate rows or clobber a
-- student's progress taps when the same syllabus is committed twice — the
-- whole reason it exists is repeatable syllabus uploads across terms.
--
-- Reuses seed.sql's fixture as-is (tutor approved for student_a and
-- student_b, guardian_a approved read-only for student_a) rather than adding
-- new rows — the fixture already has everything this needs. All assertions
-- that touch `chapters` filter by this file's own session_label so they don't
-- depend on the exact chapters seed.sql happens to ship.
--
-- Run against a local stack:
--
--     supabase db reset
--     supabase test db

begin;

set search_path = public, extensions, tests;

select plan(21);

-- ------------------------------------------------------------- test names ---
-- Same mapping 0009 uses, redefined here because 0009's copy lives inside its
-- own transaction and is rolled back with it — nothing it creates persists
-- for this file.

create or replace function tests.uid(p_who text)
returns uuid
language sql
immutable
as $fn$
  select case p_who
    when 'tutor'       then '00000000-0000-4000-a000-000000000001'
    when 'student_a'   then '00000000-0000-4000-a000-000000000002'
    when 'guardian_a'  then '00000000-0000-4000-a000-000000000003'
    when 'student_b'   then '00000000-0000-4000-a000-000000000004'
    when 'physics_a'   then '00000000-0000-4000-b000-000000000001'
  end::uuid;
$fn$;

grant execute on function tests.uid(text) to authenticated, anon;

-- A two-subject tree: "Physics" collides with seed.sql's existing student_
-- subject of that name for student_a (exercises the on-conflict UPDATE path
-- and reuses physics_a's id); "Mathematics" is brand new and splits into two
-- papers (exercises subject_papers + per-paper chapters).
create or replace function tests.syllabus_tree_v1()
returns jsonb
language sql
immutable
as $fn$
  select '{
    "semester": "First",
    "subjects": [
      {"name": "Physics", "teacher_name": "Rina",
       "chapters": ["1.1: Physical Quantities", "1.2: Motion"]},
      {"name": "Mathematics", "papers": [
        {"name": "Math D",   "chapters": ["Chapter 1 - Number"]},
        {"name": "Add Math", "chapters": ["Chapter 2 - Algebra"]}
      ]}
    ]
  }'::jsonb;
$fn$;

-- ===========================================================================
-- 1. Authorization — the check the RPC exists to enforce
-- ===========================================================================

select tests.login_as_anon();

select throws_ok(
  $$ select public.commit_syllabus_tree(
       '00000000-0000-4000-a000-000000000002', '{"subjects":[]}'::jsonb, 'Term 1') $$,
  '42501', NULL,
  'anon cannot call commit_syllabus_tree at all'
);

select tests.login_as(tests.uid('student_b'));

select throws_ok(
  $$ select public.commit_syllabus_tree(
       '00000000-0000-4000-a000-000000000002', '{"subjects":[]}'::jsonb, 'Term 1') $$,
  '42501', NULL,
  'student B cannot commit a tree for student A — not themselves, not their tutor'
);

select tests.login_as(tests.uid('tutor'));

select throws_ok(
  $$ select public.commit_syllabus_tree(
       gen_random_uuid(), '{"subjects":[]}'::jsonb, 'Term 1') $$,
  '42501', NULL,
  'the tutor cannot commit a tree for a student they do not tutor'
);

select tests.login_as(tests.uid('guardian_a'));

select throws_ok(
  $$ select public.commit_syllabus_tree(
       '00000000-0000-4000-a000-000000000002', '{"subjects":[]}'::jsonb, 'Term 1') $$,
  '42501', NULL,
  'a guardian cannot commit a syllabus tree — read-only everywhere'
);

-- ===========================================================================
-- 2. Input validation, as the authorized caller
-- ===========================================================================

select tests.login_as(tests.uid('student_a'));

select throws_ok(
  $$ select public.commit_syllabus_tree(
       '00000000-0000-4000-a000-000000000002', '{"subjects":[]}'::jsonb, '') $$,
  '23514', NULL,
  'an empty session label is rejected'
);

select throws_ok(
  $$ select public.commit_syllabus_tree(
       '00000000-0000-4000-a000-000000000002', '{}'::jsonb, 'Term 1') $$,
  '23514', NULL,
  'a tree with no subjects array is rejected'
);

select throws_ok(
  $$ select public.commit_syllabus_tree(
       '00000000-0000-4000-a000-000000000002',
       '{"subjects":[{"name":"  "}]}'::jsonb, 'Term 1') $$,
  '23514', NULL,
  'a subject with a blank name is rejected'
);

select throws_ok(
  $$ select public.commit_syllabus_tree(
       '00000000-0000-4000-a000-000000000002',
       '{"subjects":[{"name":"Biology","papers":[{"name":""}]}]}'::jsonb, 'Term 1') $$,
  '23514', NULL,
  'a paper with a blank name is rejected'
);

-- ===========================================================================
-- 3. The tutor commits student A's tree
-- ===========================================================================

select tests.login_as(tests.uid('tutor'));

select is(
  public.commit_syllabus_tree(tests.uid('student_a'), tests.syllabus_tree_v1(), 'Term 1'),
  jsonb_build_object('subjects_committed', 2, 'papers_committed', 2, 'chapters_committed', 4),
  'the tutor commits student A''s tree and gets back the right counts'
);

select is(
  (select id from public.student_subjects
    where student_id = tests.uid('student_a') and display_name = 'Physics'),
  tests.uid('physics_a'),
  '"Physics" collided with the seeded subject and reused its id, not a duplicate'
);

select is(
  (select teacher_name from public.student_subjects where id = tests.uid('physics_a')),
  'Rina',
  'the collision updated teacher_name from the seeded "Shafiul" to the committed "Rina"'
);

select is(
  (select count(*) from public.subject_papers sp
     join public.student_subjects ss on ss.id = sp.student_subject_id
    where ss.student_id = tests.uid('student_a') and ss.display_name = 'Mathematics'),
  2::bigint,
  '"Mathematics" is new and has both papers'
);

select is(
  (select count(*) from public.chapters
    where student_id = tests.uid('student_a') and session_label = 'Term 1'),
  4::bigint,
  'four Term 1 chapters were written: two under Physics, one per Mathematics paper'
);

-- ===========================================================================
-- 4. Student A re-commits the identical tree — self-authorized, idempotent
-- ===========================================================================

select tests.login_as(tests.uid('student_a'));

select is(
  public.commit_syllabus_tree(tests.uid('student_a'), tests.syllabus_tree_v1(), 'Term 1'),
  jsonb_build_object('subjects_committed', 2, 'papers_committed', 2, 'chapters_committed', 4),
  'student A can also commit their own tree, and the counts are unchanged'
);

select is(
  (select count(*) from public.chapters
    where student_id = tests.uid('student_a') and session_label = 'Term 1'),
  4::bigint,
  'the repeat commit did not duplicate any Term 1 chapters'
);

-- ===========================================================================
-- 5. A re-commit must not clobber progress the student already logged
-- ===========================================================================

select lives_ok(
  $$ update public.chapters set status = 'p100'
      where student_id = '00000000-0000-4000-a000-000000000002'
        and session_label = 'Term 1' and name = 'Chapter 1 - Number' $$,
  'student A taps a Term 1 chapter to p100 through the ordinary update policy'
);

select tests.login_as(tests.uid('tutor'));

-- The tutor re-commits the same tree a third time, from a different identity
-- than the one that logged the progress tap.
select is(
  public.commit_syllabus_tree(tests.uid('student_a'), tests.syllabus_tree_v1(), 'Term 1'),
  jsonb_build_object('subjects_committed', 2, 'papers_committed', 2, 'chapters_committed', 4),
  'the tutor''s repeat commit succeeds too'
);

select is(
  (select status from public.chapters
    where student_id = tests.uid('student_a')
      and session_label = 'Term 1' and name = 'Chapter 1 - Number'),
  'p100',
  'and the student''s p100 progress survived the tutor''s repeat commit'
);

-- ===========================================================================
-- 6. A new term does not touch the last one's history
-- ===========================================================================

select is(
  public.commit_syllabus_tree(
    tests.uid('student_a'),
    '{"semester":"Second","subjects":[
       {"name":"Mathematics","papers":[
         {"name":"Math D","chapters":["Chapter 5 - Trigonometry"]}
       ]}
     ]}'::jsonb,
    'Term 2'
  ),
  jsonb_build_object('subjects_committed', 1, 'papers_committed', 1, 'chapters_committed', 1),
  'a Term 2 commit against the same Mathematics subject succeeds'
);

select is(
  (select count(*) from public.chapters
    where student_id = tests.uid('student_a') and session_label = 'Term 1'),
  4::bigint,
  'Term 1''s chapters are untouched by the Term 2 commit'
);

select is(
  (select count(*) from public.chapters
    where student_id = tests.uid('student_a') and session_label = 'Term 2'),
  1::bigint,
  'Term 2''s chapter was added alongside it'
);

select tests.logout();

select * from finish();

rollback;
