-- 0017 — assessment_chapters, set_assessment_chapters(), log_manual_result() (0017 migration)
--
-- Six things this file has to prove that no earlier suite does.
--
--   * the anti-drift composite FK actually rejects a cross-student link, and
--     the pair (assessment_id, chapter_id) is unique;
--   * deleting the assessment cascades its links; deleting a chapter removes
--     only the link, leaving the assessment and any result on it standing —
--     the same "a logged mark outlives the syllabus row" guarantee 0013's
--     chapter_id FK gave, now for a many-to-many shape;
--   * set_assessment_chapters() replaces a set atomically (a second call with
--     a smaller list drops what the first call added, not merges with it);
--   * the access matrix on the new table is exactly assessments' — the
--     student and nobody else, on both verbs. 0017 originally gave the tutor
--     INSERT and DELETE here, reasoning that it "preserves the tutor's
--     existing" reach onto assessments; 0018 removed that reach when §3.3 was
--     revised, and this section is what holds the two tables in step;
--   * log_manual_result() links every id in `chapter_ids`, on both entry
--     shapes, and tolerates the array being empty or absent.
--
-- Run against a local stack:
--
--     supabase db reset
--     supabase test db

begin;

set search_path = public, extensions, tests;

select plan(23);

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
    when 'chapter_a2' then '00000000-0000-4000-c000-000000000002'
    when 'chapter_b1' then '00000000-0000-4000-c000-000000000003'
  end::uuid;
$fn$;

grant execute on function tests.uid(text) to authenticated, anon;

select tests.login_as(tests.uid('student_a'));

-- ===========================================================================
-- 1. set_assessment_chapters() links, and REPLACES rather than merges
-- ===========================================================================

select lives_ok(
  $$ insert into public.assessments
       (id, student_id, student_subject_id, type, status, scheduled_date, created_by)
     values ('00000000-0000-4000-7000-000000000031',
             '00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-b000-000000000001', 'CT', 'scheduled', '2026-09-10',
             '00000000-0000-4000-a000-000000000002') $$,
  'setup: a CT spanning chapters, the way assignCTDate() will create one'
);

select lives_ok(
  $$ select public.set_assessment_chapters(
       '00000000-0000-4000-7000-000000000031',
       array['00000000-0000-4000-c000-000000000001', '00000000-0000-4000-c000-000000000002']::uuid[]
     ) $$,
  'links both chapters at once'
);

select is(
  (select count(*) from public.assessment_chapters
    where assessment_id = '00000000-0000-4000-7000-000000000031'),
  2::bigint,
  'both links exist'
);

select lives_ok(
  $$ select public.set_assessment_chapters(
       '00000000-0000-4000-7000-000000000031',
       array['00000000-0000-4000-c000-000000000001']::uuid[]
     ) $$,
  'a second call with a shorter list'
);

select is(
  (select array_agg(chapter_id order by chapter_id) from public.assessment_chapters
    where assessment_id = '00000000-0000-4000-7000-000000000031'),
  array[tests.uid('chapter_a1')],
  'REPLACES the set - the dropped chapter''s link is gone, not merged with'
);

-- ===========================================================================
-- 2. The composite FK and the pair-uniqueness constraint
-- ===========================================================================

select throws_ok(
  $$ insert into public.assessment_chapters (assessment_id, chapter_id, student_id)
     values ('00000000-0000-4000-7000-000000000031',
             '00000000-0000-4000-c000-000000000003',
             '00000000-0000-4000-a000-000000000002') $$,
  '23503', NULL,
  'chapter_b1 belongs to student B - the composite FK rejects it under student A''s own id'
);

select throws_ok(
  $$ insert into public.assessment_chapters (assessment_id, chapter_id, student_id)
     values ('00000000-0000-4000-7000-000000000031',
             '00000000-0000-4000-c000-000000000001',
             '00000000-0000-4000-a000-000000000002') $$,
  '23505', NULL,
  'the same (assessment, chapter) pair cannot be linked twice'
);

-- ===========================================================================
-- 3. Deleting the assessment cascades its links
-- ===========================================================================

select lives_ok(
  $$ delete from public.assessments where id = '00000000-0000-4000-7000-000000000031' $$,
  'the student deletes the assessment outright'
);

select is(
  (select count(*) from public.assessment_chapters
    where assessment_id = '00000000-0000-4000-7000-000000000031'),
  0::bigint,
  'its links are gone with it'
);

-- ===========================================================================
-- 4. Deleting a CHAPTER removes only the link - the assessment and its
--    result survive, on the same terms 0013's chapter_id FK gave
-- ===========================================================================

select lives_ok(
  $$ insert into public.chapters
       (id, student_id, student_subject_id, name, source, status, sort_order)
     values ('00000000-0000-4000-7000-000000000040',
             '00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-b000-000000000001',
             'A temporary chapter', 'manual', 'p100', 99) $$,
  'setup: a throwaway chapter to delete later'
);

select is(
  (public.log_manual_result(
    tests.uid('student_a'),
    jsonb_build_object(
      'student_subject_id', tests.uid('physics_a'),
      'type', 'CWM', 'raw_obtained', 9, 'raw_total', 10,
      'chapter_ids', jsonb_build_array('00000000-0000-4000-7000-000000000040')
    )
  ) ->> 'converted')::numeric,
  13.5,
  'log_manual_result links a single chapter via the new array field'
);

select lives_ok(
  $$ delete from public.chapters where id = '00000000-0000-4000-7000-000000000040' $$,
  'the student deletes that chapter'
);

select is(
  (select count(*) from public.results r
    join public.assessments a on a.id = r.assessment_id
    where a.student_subject_id = tests.uid('physics_a') and r.raw_obtained = 9),
  1::bigint,
  'the result is untouched'
);

-- ===========================================================================
-- 5. log_manual_result() with multiple chapters, and with none at all
-- ===========================================================================

select is(
  (public.log_manual_result(
    tests.uid('student_a'),
    jsonb_build_object(
      'student_subject_id', tests.uid('physics_a'),
      'type', 'CWM', 'raw_obtained', 3, 'raw_total', 10,
      'chapter_ids', jsonb_build_array(
        '00000000-0000-4000-c000-000000000001',
        '00000000-0000-4000-c000-000000000002'
      )
    )
  ) ? 'assessment_id'),
  true,
  'a fresh multi-chapter CWM logs without error'
);

select is(
  (select count(*) from public.assessment_chapters ac
    join public.assessments a on a.id = ac.assessment_id
    where a.student_subject_id = tests.uid('physics_a')
      and a.type = 'CWM' and a.status = 'logged'
      and ac.chapter_id in (tests.uid('chapter_a1'), tests.uid('chapter_a2'))),
  2::bigint,
  'both chapters got linked to the same assessment'
);

select lives_ok(
  $$ select public.log_manual_result(
       '00000000-0000-4000-a000-000000000002',
       jsonb_build_object(
         'student_subject_id', '00000000-0000-4000-b000-000000000001',
         'type', 'CWM', 'raw_obtained', 4, 'raw_total', 10
       )
     ) $$,
  'chapter_ids can be omitted entirely - not every CWM names a chapter'
);

-- ===========================================================================
-- 6. Access matrix - exactly assessments' shape: student-only, both verbs
-- ===========================================================================

select lives_ok(
  $$ insert into public.assessments
       (id, student_id, student_subject_id, type, status, scheduled_date, created_by)
     values ('00000000-0000-4000-7000-000000000032',
             '00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-b000-000000000001', 'CT', 'scheduled', '2026-09-15',
             '00000000-0000-4000-a000-000000000002') $$,
  'setup: one more CT, for the authorization matrix'
);

select lives_ok(
  $$ select public.set_assessment_chapters(
       '00000000-0000-4000-7000-000000000032',
       array['00000000-0000-4000-c000-000000000001']::uuid[]
     ) $$,
  'setup: and the student links a chapter to it, for the others to fail against'
);

select tests.login_as(tests.uid('guardian_a'));

select throws_ok(
  $$ select public.set_assessment_chapters(
       '00000000-0000-4000-7000-000000000032',
       array['00000000-0000-4000-c000-000000000001']::uuid[]
     ) $$,
  '42501', NULL,
  'a guardian cannot link a chapter - assessment_chapters_insert denies it'
);

select tests.login_as(tests.uid('student_b'));

select throws_ok(
  $$ select public.set_assessment_chapters(
       '00000000-0000-4000-7000-000000000032',
       array['00000000-0000-4000-c000-000000000001']::uuid[]
     ) $$,
  'P0002', NULL,
  'an unrelated student cannot even see student A''s assessment exists - not found, not denied, same as log_manual_result''s own foreign-id case'
);

-- 0017 gated both verbs on can_log_for() and argued the DELETE was safe
-- because it "preserves the tutor's existing" reach onto assessments. 0018
-- removed that reach, so the argument went with it: which chapters a paper
-- covered is the student's record of their own work.
select tests.login_as(tests.uid('tutor'));

select throws_ok(
  $$ select public.set_assessment_chapters(
       '00000000-0000-4000-7000-000000000032',
       array['00000000-0000-4000-c000-000000000001', '00000000-0000-4000-c000-000000000002']::uuid[]
     ) $$,
  '42501', NULL,
  'the tutor cannot link a chapter - assessment_chapters_insert is student-only now'
);

-- The other denial shape: DELETE is filtered by USING, so it is a silent
-- success over zero rows and has to be read back.
select lives_ok(
  $$ delete from public.assessment_chapters
      where assessment_id = '00000000-0000-4000-7000-000000000032'
        and chapter_id = '00000000-0000-4000-c000-000000000001' $$,
  'the tutor''s delete raises nothing - filtered, not errored'
);

select is(
  (select count(*) from public.assessment_chapters
    where assessment_id = '00000000-0000-4000-7000-000000000032'),
  1::bigint,
  'and the link the student made is still there'
);

select tests.logout();

select * from finish();

rollback;
