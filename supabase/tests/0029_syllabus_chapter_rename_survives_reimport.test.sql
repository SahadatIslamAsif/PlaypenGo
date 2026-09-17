-- 0029 — parsed_name survives insertion/deletion/reorder, and a removed
-- chapter is flagged rather than deleted or silently kept
-- (ARCHITECTURE.md §5.2; 0029 migration)
--
-- 0010 already proves an *identical* re-commit is idempotent. This file
-- covers what changes when a re-import's chapter list doesn't match the
-- old one exactly — insertion, deletion, and reorder, the cases a
-- position-keyed match would get wrong and a content-keyed one shouldn't:
--
--   A. chapters inserted mid-list — every existing chapter keeps its own
--      content, the new ones land as their own rows, nothing is discarded
--   B. chapters removed, then one brought back — flagged, never deleted;
--      nothing flagged ever reads as still live; the flag clears if the
--      chapter reappears
--   C. a rename survives a re-import that also reorders and adds a chapter
--
-- Every commit's returned counts are checked alongside the row-level
-- assertions, not as an afterthought — chapters_committed/chapters_deleted/
-- chapters_flagged are meant to describe exactly what that commit did.
--
-- 0030 narrows "removed" from an unconditional flag into delete-or-flag: a
-- syllabus-sourced, untouched, never-renamed, unlinked chapter is now
-- deleted rather than flagged. Section B's whole point is proving flag
-- semantics (never-live, flag-clears-on-reappearance) survive a re-import,
-- so it taps progress onto Ch2/Ch4 before they drop out — protecting them
-- from 0030's delete path so this file keeps testing what it was written to
-- test. 0030's own suite covers the untouched-chapter-gets-deleted case this
-- file deliberately avoids.
--
-- Run against a local stack:
--
--     supabase db reset
--     supabase test db

begin;

set search_path = public, extensions, tests;

select plan(30);

create or replace function tests.uid(p_who text)
returns uuid
language sql
immutable
as $fn$
  select case p_who
    when 'student_a'   then '00000000-0000-4000-a000-000000000002'
  end::uuid;
$fn$;

grant execute on function tests.uid(text) to authenticated, anon;

select tests.login_as(tests.uid('student_a'));

-- ===========================================================================
-- A. Insertion mid-list — nothing discarded, nothing else disturbed
-- ===========================================================================

select is(
  public.commit_syllabus_tree(
    tests.uid('student_a'),
    '{"semester":"First","subjects":[
       {"name":"Geography","chapters":["Ch1","Ch2","Ch3","Ch4","Ch5"]}
     ]}'::jsonb,
    'Insert Term'
  ),
  jsonb_build_object('subjects_committed', 1, 'papers_committed', 0,
                      'chapters_committed', 5, 'chapters_deleted', 0, 'chapters_flagged', 0),
  'Geography v1: five chapters committed, none removed'
);

select is(
  public.commit_syllabus_tree(
    tests.uid('student_a'),
    '{"semester":"First","subjects":[
       {"name":"Geography","chapters":["Ch1","Ch2","NEW-A","NEW-B","Ch3","Ch4","Ch5"]}
     ]}'::jsonb,
    'Insert Term'
  ),
  jsonb_build_object('subjects_committed', 1, 'papers_committed', 0,
                      'chapters_committed', 7, 'chapters_deleted', 0, 'chapters_flagged', 0),
  'Geography v2: seven chapters committed (two new, mid-list), still none removed'
);

select is(
  (select count(*) from public.chapters c
     join public.student_subjects ss on ss.id = c.student_subject_id
    where ss.student_id = tests.uid('student_a') and ss.display_name = 'Geography'
      and c.session_label = 'Insert Term'),
  7::bigint,
  'seven Geography rows exist for Insert Term, matching the tree size exactly'
);

select is(
  (select name from public.chapters c
     join public.student_subjects ss on ss.id = c.student_subject_id
    where ss.student_id = tests.uid('student_a') and ss.display_name = 'Geography'
      and c.session_label = 'Insert Term' and c.parsed_name = 'Ch1'),
  'Ch1',
  'Ch1, before the insertion point, kept its own content'
);

select is(
  (select name from public.chapters c
     join public.student_subjects ss on ss.id = c.student_subject_id
    where ss.student_id = tests.uid('student_a') and ss.display_name = 'Geography'
      and c.session_label = 'Insert Term' and c.parsed_name = 'Ch5'),
  'Ch5',
  'Ch5, after the insertion point, kept its own content too — not shifted onto a neighbour'
);

select is(
  (select name from public.chapters c
     join public.student_subjects ss on ss.id = c.student_subject_id
    where ss.student_id = tests.uid('student_a') and ss.display_name = 'Geography'
      and c.session_label = 'Insert Term' and c.parsed_name = 'NEW-A'),
  'NEW-A',
  'the first inserted chapter landed as its own row'
);

select is(
  (select name from public.chapters c
     join public.student_subjects ss on ss.id = c.student_subject_id
    where ss.student_id = tests.uid('student_a') and ss.display_name = 'Geography'
      and c.session_label = 'Insert Term' and c.parsed_name = 'NEW-B'),
  'NEW-B',
  'the second inserted chapter landed as its own row'
);

select is(
  (select count(*) from public.chapters c
     join public.student_subjects ss on ss.id = c.student_subject_id
    where ss.student_id = tests.uid('student_a') and ss.display_name = 'Geography'
      and c.session_label = 'Insert Term' and c.syllabus_removed_at is not null),
  0::bigint,
  'an insertion-only re-import flags nothing as removed'
);

-- ===========================================================================
-- B. Removal — flagged, never deleted, never left reading as live; a
--    chapter that comes back has its flag cleared
-- ===========================================================================

select is(
  public.commit_syllabus_tree(
    tests.uid('student_a'),
    '{"semester":"First","subjects":[
       {"name":"History","chapters":["Ch1","Ch2","Ch3","Ch4"]}
     ]}'::jsonb,
    'Remove Term'
  ),
  jsonb_build_object('subjects_committed', 1, 'papers_committed', 0,
                      'chapters_committed', 4, 'chapters_deleted', 0, 'chapters_flagged', 0),
  'History v1: four chapters committed, none removed'
);

-- Protects Ch2/Ch4 from 0030's delete path (see file header) so the
-- assertions below keep proving flag semantics specifically.
select lives_ok(
  $$ update public.chapters set status = 'p80'
      where student_id = '00000000-0000-4000-a000-000000000002'
        and session_label = 'Remove Term' and parsed_name in ('Ch2', 'Ch4') $$,
  'student A taps progress on Ch2 and Ch4 before they drop out of the document'
);

select is(
  public.commit_syllabus_tree(
    tests.uid('student_a'),
    '{"semester":"First","subjects":[
       {"name":"History","chapters":["Ch1","Ch3"]}
     ]}'::jsonb,
    'Remove Term'
  ),
  jsonb_build_object('subjects_committed', 1, 'papers_committed', 0,
                      'chapters_committed', 2, 'chapters_deleted', 0, 'chapters_flagged', 2),
  'History v2: two chapters committed, two flagged removed — matches Ch2 and Ch4 dropping out'
);

select is(
  (select count(*) from public.chapters c
     join public.student_subjects ss on ss.id = c.student_subject_id
    where ss.student_id = tests.uid('student_a') and ss.display_name = 'History'
      and c.session_label = 'Remove Term'),
  4::bigint,
  'all four History rows still exist — a removal flags, it does not delete'
);

select is(
  (select syllabus_removed_at is null from public.chapters c
     join public.student_subjects ss on ss.id = c.student_subject_id
    where ss.student_id = tests.uid('student_a') and ss.display_name = 'History'
      and c.session_label = 'Remove Term' and c.parsed_name = 'Ch1'),
  true,
  'Ch1, still in the document, is not flagged'
);

select is(
  (select syllabus_removed_at is null from public.chapters c
     join public.student_subjects ss on ss.id = c.student_subject_id
    where ss.student_id = tests.uid('student_a') and ss.display_name = 'History'
      and c.session_label = 'Remove Term' and c.parsed_name = 'Ch3'),
  true,
  'Ch3, still in the document, is not flagged'
);

select is(
  (select syllabus_removed_at is not null from public.chapters c
     join public.student_subjects ss on ss.id = c.student_subject_id
    where ss.student_id = tests.uid('student_a') and ss.display_name = 'History'
      and c.session_label = 'Remove Term' and c.parsed_name = 'Ch2'),
  true,
  'Ch2, dropped from the document, is flagged'
);

select is(
  (select syllabus_removed_at is not null from public.chapters c
     join public.student_subjects ss on ss.id = c.student_subject_id
    where ss.student_id = tests.uid('student_a') and ss.display_name = 'History'
      and c.session_label = 'Remove Term' and c.parsed_name = 'Ch4'),
  true,
  'Ch4, dropped from the document, is flagged'
);

select is(
  (select count(*) from public.chapters c
     join public.student_subjects ss on ss.id = c.student_subject_id
    where ss.student_id = tests.uid('student_a') and ss.display_name = 'History'
      and c.session_label = 'Remove Term' and c.syllabus_removed_at is null),
  2::bigint,
  'exactly two History rows read as live — no flagged row is left claiming to be current'
);

-- Ch2 comes back; Ch4 stays gone.
select is(
  public.commit_syllabus_tree(
    tests.uid('student_a'),
    '{"semester":"First","subjects":[
       {"name":"History","chapters":["Ch1","Ch2","Ch3"]}
     ]}'::jsonb,
    'Remove Term'
  ),
  jsonb_build_object('subjects_committed', 1, 'papers_committed', 0,
                      'chapters_committed', 3, 'chapters_deleted', 0, 'chapters_flagged', 0),
  'History v3: three chapters committed, zero newly removed (Ch4 was already flagged, not re-counted)'
);

select is(
  (select syllabus_removed_at is null from public.chapters c
     join public.student_subjects ss on ss.id = c.student_subject_id
    where ss.student_id = tests.uid('student_a') and ss.display_name = 'History'
      and c.session_label = 'Remove Term' and c.parsed_name = 'Ch2'),
  true,
  'Ch2''s flag cleared now that it is back in the document'
);

select is(
  (select syllabus_removed_at is not null from public.chapters c
     join public.student_subjects ss on ss.id = c.student_subject_id
    where ss.student_id = tests.uid('student_a') and ss.display_name = 'History'
      and c.session_label = 'Remove Term' and c.parsed_name = 'Ch4'),
  true,
  'Ch4 is still flagged — v3 never mentioned it'
);

select is(
  (select count(*) from public.chapters c
     join public.student_subjects ss on ss.id = c.student_subject_id
    where ss.student_id = tests.uid('student_a') and ss.display_name = 'History'
      and c.session_label = 'Remove Term'),
  4::bigint,
  'still four rows total across all three History commits — nothing was ever deleted'
);

-- ===========================================================================
-- C. A rename survives a re-import that also reorders and adds a chapter
--    (paper-level, so this also exercises the per-paper flagging pass)
-- ===========================================================================

select is(
  public.commit_syllabus_tree(
    tests.uid('student_a'),
    '{"semester":"First","subjects":[
       {"name":"Mathematics","papers":[
         {"name":"Math D","chapters":["Ch1","Ch2","Ch3"]}
       ]}
     ]}'::jsonb,
    'Reorder Term'
  ),
  jsonb_build_object('subjects_committed', 1, 'papers_committed', 1,
                      'chapters_committed', 3, 'chapters_deleted', 0, 'chapters_flagged', 0),
  'Math D v1: three chapters committed, none removed'
);

select lives_ok(
  $$ update public.chapters set name = '2.1: Renamed'
      where student_id = '00000000-0000-4000-a000-000000000002'
        and session_label = 'Reorder Term' and parsed_name = 'Ch2' $$,
  'student A renames the chapter whose parsed_name is "Ch2"'
);

select is(
  public.commit_syllabus_tree(
    tests.uid('student_a'),
    '{"semester":"First","subjects":[
       {"name":"Mathematics","papers":[
         {"name":"Math D","chapters":["Ch3","Ch1","NEW","Ch2"]}
       ]}
     ]}'::jsonb,
    'Reorder Term'
  ),
  jsonb_build_object('subjects_committed', 1, 'papers_committed', 1,
                      'chapters_committed', 4, 'chapters_deleted', 0, 'chapters_flagged', 0),
  'Math D v2: reordered plus one new chapter, four committed, none removed'
);

select is(
  (select c.name from public.chapters c
     join public.subject_papers sp on sp.id = c.paper_id
    where c.student_id = tests.uid('student_a') and c.session_label = 'Reorder Term'
      and sp.name = 'Math D' and c.parsed_name = 'Ch2'),
  '2.1: Renamed',
  'the rename survived a re-import that also reordered and inserted a chapter'
);

select is(
  (select c.name from public.chapters c
     join public.subject_papers sp on sp.id = c.paper_id
    where c.student_id = tests.uid('student_a') and c.session_label = 'Reorder Term'
      and sp.name = 'Math D' and c.parsed_name = 'Ch1'),
  'Ch1',
  'Ch1 is untouched despite moving position in the reordered list'
);

select is(
  (select c.name from public.chapters c
     join public.subject_papers sp on sp.id = c.paper_id
    where c.student_id = tests.uid('student_a') and c.session_label = 'Reorder Term'
      and sp.name = 'Math D' and c.parsed_name = 'Ch3'),
  'Ch3',
  'Ch3 is untouched despite moving position too'
);

select is(
  (select c.name from public.chapters c
     join public.subject_papers sp on sp.id = c.paper_id
    where c.student_id = tests.uid('student_a') and c.session_label = 'Reorder Term'
      and sp.name = 'Math D' and c.parsed_name = 'NEW'),
  'NEW',
  'the newly inserted chapter landed as its own row'
);

select is(
  (select count(*) from public.chapters c
     join public.subject_papers sp on sp.id = c.paper_id
    where c.student_id = tests.uid('student_a') and c.session_label = 'Reorder Term'
      and sp.name = 'Math D'),
  4::bigint,
  'exactly four Math D rows exist — no duplicates from the reorder'
);

select is(
  (select count(*) from public.chapters c
     join public.subject_papers sp on sp.id = c.paper_id
    where c.student_id = tests.uid('student_a') and c.session_label = 'Reorder Term'
      and sp.name = 'Math D' and c.syllabus_removed_at is not null),
  0::bigint,
  'nothing in Math D is flagged removed — the reorder dropped nothing'
);

select tests.logout();

select * from finish();

rollback;
