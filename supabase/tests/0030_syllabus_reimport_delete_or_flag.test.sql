-- 0030 — re-import reconcile: delete a clean absence, flag everything else
-- (ARCHITECTURE.md §5.2; 0030 migration)
--
-- 0029's suite proves identity survives insertion/reorder/rename and that a
-- removed chapter is flagged, never deleted. This file proves the narrower
-- rule 0030 adds on top: an absent chapter is deleted only when NOTHING
-- about it could matter to a human — syllabus-sourced, never progressed,
-- never renamed, never scoped into an assessment. Any one of those flips it
-- back to 0029's flag behaviour. Five chapters are built so each protection
-- is tested in isolation, plus a manual chapter (the real-world case,
-- session_label null) to prove the reconcile never reaches outside the
-- commit's own scope at all.
--
-- Run against a local stack:
--
--     supabase db reset
--     supabase test db

begin;

set search_path = public, extensions, tests;

select plan(18);

create or replace function tests.uid(p_who text)
returns uuid
language sql
immutable
as $fn$
  select case p_who
    when 'student_a' then '00000000-0000-4000-a000-000000000002'
  end::uuid;
$fn$;

grant execute on function tests.uid(text) to authenticated, anon;

select tests.login_as(tests.uid('student_a'));

-- ===========================================================================
-- Setup — five Chemistry chapters, each given a different reason (or none)
-- to survive a re-import that drops it
-- ===========================================================================

select is(
  public.commit_syllabus_tree(
    tests.uid('student_a'),
    '{"semester":"First","subjects":[
       {"name":"Chemistry","chapters":["Ch1","Ch2","Ch3","Ch4","Ch5"]}
     ]}'::jsonb,
    'Delete Term'
  ),
  jsonb_build_object('subjects_committed', 1, 'papers_committed', 0,
                      'chapters_committed', 5, 'chapters_deleted', 0, 'chapters_flagged', 0),
  'Chemistry v1: five chapters committed, nothing deleted or flagged yet'
);

-- Ch1 stays exactly as imported — untouched, the case that now deletes.

select lives_ok(
  $$ update public.chapters set status = 'p80'
      where student_id = '00000000-0000-4000-a000-000000000002'
        and session_label = 'Delete Term' and parsed_name = 'Ch2' $$,
  'Ch2 gets progress tapped — protects it from delete'
);

select lives_ok(
  $$ update public.chapters set status = 'not_taught'
      where student_id = '00000000-0000-4000-a000-000000000002'
        and session_label = 'Delete Term' and parsed_name = 'Ch3' $$,
  'Ch3 is marked not taught — also protects it from delete'
);

select lives_ok(
  $$ update public.chapters set name = 'Renamed Ch4'
      where student_id = '00000000-0000-4000-a000-000000000002'
        and session_label = 'Delete Term' and parsed_name = 'Ch4' $$,
  'Ch4 is renamed — name no longer matches parsed_name, protects it from delete'
);

select lives_ok(
  $$ insert into public.assessments
       (id, student_id, student_subject_id, type, status, scheduled_date, created_by)
     values ('00000000-0000-4000-7000-000000000041',
             '00000000-0000-4000-a000-000000000002',
             (select id from public.student_subjects
               where student_id = '00000000-0000-4000-a000-000000000002'
                 and display_name = 'Chemistry'),
             'CT', 'scheduled', '2026-10-01',
             '00000000-0000-4000-a000-000000000002') $$,
  'a CT is scheduled against Chemistry'
);

select lives_ok(
  $$ insert into public.assessment_chapters (assessment_id, chapter_id, student_id)
     select '00000000-0000-4000-7000-000000000041', c.id, c.student_id
       from public.chapters c
      where c.student_id = '00000000-0000-4000-a000-000000000002'
        and c.session_label = 'Delete Term' and c.parsed_name = 'Ch5' $$,
  'the CT is scoped to Ch5 — protects it from delete, unlike a bare progress tap'
);

-- A manual, carried-over chapter on the same subject — the real production
-- shape (§8; audit finding: production's 14 manual chapters are all
-- session_label = null). Out of commit_syllabus_tree's scope entirely, same
-- as 0029 left it — never a delete-or-flag candidate regardless of what the
-- document says.
select lives_ok(
  $$ insert into public.chapters
       (student_id, student_subject_id, name, source)
     select '00000000-0000-4000-a000-000000000002', ss.id, 'Carried over from last term', 'manual'
       from public.student_subjects ss
      where ss.student_id = '00000000-0000-4000-a000-000000000002'
        and ss.display_name = 'Chemistry' $$,
  'a manually added, carried-over chapter sits on the same subject'
);

-- ===========================================================================
-- Re-import drops all five named chapters — only Ch2/Ch3/Ch4/Ch5 should
-- survive as flags; Ch1 should be gone outright
-- ===========================================================================

select is(
  public.commit_syllabus_tree(
    tests.uid('student_a'),
    '{"semester":"First","subjects":[
       {"name":"Chemistry","chapters":["Unrelated"]}
     ]}'::jsonb,
    'Delete Term'
  ),
  jsonb_build_object('subjects_committed', 1, 'papers_committed', 0,
                      'chapters_committed', 1, 'chapters_deleted', 1, 'chapters_flagged', 4),
  'Chemistry v2: one new chapter committed, Ch1 deleted, the other four flagged'
);

select is(
  (select count(*) from public.chapters
    where student_id = tests.uid('student_a')
      and session_label = 'Delete Term' and parsed_name = 'Ch1'),
  0::bigint,
  'Ch1 — untouched, syllabus-sourced, unlinked — is gone outright, not flagged'
);

select is(
  (select syllabus_removed_at is not null and status = 'p80' from public.chapters
    where student_id = tests.uid('student_a')
      and session_label = 'Delete Term' and parsed_name = 'Ch2'),
  true,
  'Ch2 is flagged, not deleted, and its progress tap survived'
);

select is(
  (select syllabus_removed_at is not null and status = 'not_taught' from public.chapters
    where student_id = tests.uid('student_a')
      and session_label = 'Delete Term' and parsed_name = 'Ch3'),
  true,
  'Ch3 is flagged, not deleted, and stays not taught'
);

select is(
  (select syllabus_removed_at is not null and name = 'Renamed Ch4' from public.chapters
    where student_id = tests.uid('student_a')
      and session_label = 'Delete Term' and parsed_name = 'Ch4'),
  true,
  'Ch4 is flagged, not deleted, and its rename survived'
);

select is(
  (select syllabus_removed_at is not null from public.chapters
    where student_id = tests.uid('student_a')
      and session_label = 'Delete Term' and parsed_name = 'Ch5'),
  true,
  'Ch5 is flagged, not deleted, despite carrying no progress or rename of its own'
);

select is(
  (select count(*) from public.assessment_chapters
    where assessment_id = '00000000-0000-4000-7000-000000000041'),
  1::bigint,
  'the CT''s link to Ch5 survives — flagging never touches assessment_chapters'
);

select is(
  (select syllabus_removed_at from public.chapters
    where student_id = tests.uid('student_a')
      and source = 'manual' and name = 'Carried over from last term'),
  null,
  'the manual chapter is untouched — outside session_label scope, deleted or flagged never applies'
);

-- ===========================================================================
-- Ch2 comes back — the flag clears, same as 0029; already-flagged rows are
-- not re-counted
-- ===========================================================================

select is(
  public.commit_syllabus_tree(
    tests.uid('student_a'),
    '{"semester":"First","subjects":[
       {"name":"Chemistry","chapters":["Ch2","Unrelated"]}
     ]}'::jsonb,
    'Delete Term'
  ),
  jsonb_build_object('subjects_committed', 1, 'papers_committed', 0,
                      'chapters_committed', 2, 'chapters_deleted', 0, 'chapters_flagged', 0),
  'Chemistry v3: Ch2 and Unrelated committed, nothing newly deleted or flagged — Ch3/Ch4/Ch5 were already flagged'
);

select is(
  (select syllabus_removed_at is null and status = 'p80' from public.chapters
    where student_id = tests.uid('student_a')
      and session_label = 'Delete Term' and parsed_name = 'Ch2'),
  true,
  'Ch2''s flag is cleared now that it is back, and its progress is still intact'
);

select is(
  (select syllabus_removed_at is not null from public.chapters
    where student_id = tests.uid('student_a')
      and session_label = 'Delete Term' and parsed_name = 'Ch3'),
  true,
  'Ch3 is still flagged — v3 never mentioned it'
);

select tests.logout();

select * from finish();

rollback;
