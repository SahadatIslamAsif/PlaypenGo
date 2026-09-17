-- 0030 — re-import reconcile: delete a clean absence, flag everything else
-- (ARCHITECTURE.md §5.2; 0029's parsed_name/syllabus_removed_at; plan
-- "four-changes-one-pass", Change 2b)
--
-- 0029 made a syllabus chapter's identity immutable (`parsed_name`, matched
-- on, never rewritten) and gave a chapter whose `parsed_name` disappears from
-- a re-import a flag instead of a delete. That was right for the reordering/
-- insertion/deletion case 0029 was written for, where the document's own
-- chapter list changes shape.
--
-- The parser this same plan lands (Change 1+2) changes a different thing:
-- how one document turns into chapter strings at all — splitting compound
-- lines, stripping leading markers, prefixing parent context. Re-importing
-- the *same* document under the *new* rules routinely produces a near-miss
-- name for a chapter nothing actually removed — `3.1: Levers and Pulleys`
-- (0029-era parse) becomes `Levers and Pulleys` (this parser). Flag-and-
-- insert turns every one of those into a flagged husk plus a live duplicate,
-- which is worse than either a clean delete or a clean flag: the husk is
-- pure noise (nothing but the marker-stripping rule ever produced it) and it
-- sits in the way of the very rename/delete correction path §5.2 relies on.
--
-- A blind replace — delete whatever's absent, no exceptions — is the wrong
-- fix in the other direction. `assessment_chapters.chapter_id` cascades on
-- delete (0017): deleting a chapter silently narrows a logged CT's recorded
-- scope. A blind replace would also undo 0029's whole point (a rename
-- survives re-import) and would delete `source = 'manual'` rows (§8's
-- carried-over topics from a previous term), neither of which this pass ever
-- touches — both are already excluded by construction below.
--
-- So: delete only the shape that is unambiguously parser noise, flag
-- everything a human might actually care about. A chapter is DELETED when
-- every one of these holds:
--   - `source = 'syllabus'`      — never a hand-added or carried-over row
--   - `status = 'not_started'`   — nothing tapped; `not_taught` is a
--                                   deliberate student action and must
--                                   survive, so the test is the positive
--                                   `= 'not_started'`, not a negated one
--   - `name is not distinct from parsed_name` — never renamed; §5.2's
--                                   correction path is exactly this field,
--                                   and a chapter a human already touched is
--                                   never silently removed
--   - no `assessment_chapters` row references it — never scoped into a
--                                   logged or scheduled CT
-- Anything absent that fails even one of those keeps 0029's behaviour:
-- flagged (`syllabus_removed_at = now()`), not deleted, exactly as before.
--
-- Both flagging passes below (subject-level chapters, then each paper's)
-- become two statements instead of one: a DELETE scoped to the extra four
-- conditions, then an UPDATE re-running 0029's original candidate query.
-- Rows the DELETE already removed simply no longer match the UPDATE's scan —
-- no separate "already handled" bookkeeping needed.
--
-- The RPC's return shape changes accordingly: 0029's single `chapters_removed`
-- splits into `chapters_deleted` and `chapters_flagged`, so the import
-- summary the student sees is honest about which happened. Callers updated
-- in this pass: `app/(app)/_components/import-syllabus-button.tsx` (its
-- `CommitResult` type and summary string) and
-- `supabase/tests/0010_commit_syllabus_tree.test.sql` (its four
-- `jsonb_build_object` expectations, all zero-count cases unaffected in
-- substance).
--
-- Not addressed this pass, same gap 0029 left and named here rather than
-- silently carried forward again: a re-import that drops an entire subject
-- or paper from the tree leaves that subject's/paper's own chapters neither
-- deleted nor flagged — this reconcile only ever looks at chapters within a
-- subject/paper the current commit actually visits.

create or replace function public.commit_syllabus_tree(
  p_student uuid,
  p_tree    jsonb,
  p_session text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid              uuid := (select auth.uid());
  v_semester         text := nullif(btrim(p_tree ->> 'semester'), '');
  v_subject          jsonb;
  v_paper            jsonb;
  v_chapter          jsonb;
  v_subject_id       uuid;
  v_paper_id         uuid;
  v_subject_name     text;
  v_paper_name       text;
  v_chapter_name     text;
  v_subject_order    int;
  v_paper_order      int;
  v_chapter_order    int;
  -- Chapter names actually seen in this commit's current subject (or
  -- paper), reset at the start of each one. Anything already on that
  -- subject/paper for this session_label/semester whose parsed_name isn't
  -- in this array by the end of the loop just fell out of the document.
  v_seen_names       text[];
  v_deleted_now      int;
  v_flagged_now      int;
  v_subjects_written int := 0;
  v_papers_written   int := 0;
  v_chapters_written int := 0;
  v_chapters_deleted int := 0;
  v_chapters_flagged int := 0;
begin
  if v_uid is null then
    raise exception 'Sign in to commit a syllabus.' using errcode = 'insufficient_privilege';
  end if;

  -- The one authorization check every write in this function relies on. Not a
  -- table policy: a definer function so a tutor's syllabus-commit reach stops
  -- exactly here, instead of becoming a standing INSERT/UPDATE grant on the
  -- whole subject tree.
  if not (p_student = v_uid or public.is_tutor_of(p_student)) then
    raise exception 'You are not authorised to edit this student''s subjects.'
      using errcode = 'insufficient_privilege';
  end if;

  if nullif(btrim(p_session), '') is null then
    raise exception 'A session label is required.' using errcode = 'check_violation';
  end if;

  if jsonb_typeof(p_tree -> 'subjects') is distinct from 'array' then
    raise exception 'The syllabus tree must include a subjects array.'
      using errcode = 'check_violation';
  end if;

  v_subject_order := 0;

  for v_subject in select * from jsonb_array_elements(p_tree -> 'subjects')
  loop
    v_subject_name := nullif(btrim(v_subject ->> 'name'), '');
    if v_subject_name is null then
      raise exception 'Every subject needs a name.' using errcode = 'check_violation';
    end if;

    insert into public.student_subjects
      (student_id, catalog_id, display_name, teacher_name, sort_order)
    values (
      p_student,
      nullif(v_subject ->> 'catalog_id', '')::uuid,
      v_subject_name,
      nullif(btrim(v_subject ->> 'teacher_name'), ''),
      v_subject_order
    )
    on conflict (student_id, display_name) do update
       set catalog_id   = excluded.catalog_id,
           teacher_name = coalesce(excluded.teacher_name, public.student_subjects.teacher_name),
           sort_order   = excluded.sort_order
    returning id into v_subject_id;

    v_subjects_written := v_subjects_written + 1;
    v_subject_order := v_subject_order + 1;

    -- Subject-level chapters (no paper) — e.g. Physics, which never splits.
    v_chapter_order := 0;
    v_seen_names := '{}';
    for v_chapter in select * from jsonb_array_elements(coalesce(v_subject -> 'chapters', '[]'::jsonb))
    loop
      if jsonb_typeof(v_chapter) is distinct from 'string' then
        raise exception 'Chapter names must be strings.' using errcode = 'check_violation';
      end if;
      v_chapter_name := btrim(v_chapter #>> '{}');
      if v_chapter_name is null or v_chapter_name = '' then
        continue;
      end if;
      v_seen_names := v_seen_names || v_chapter_name;

      -- parsed_name is the ON CONFLICT match — content-based, immutable,
      -- set once here and never written again. name is set to the same
      -- text on first insert but is free to drift from it afterwards.
      insert into public.chapters
        (student_id, student_subject_id, paper_id, name, parsed_name, source,
         sort_order, session_label, semester)
      values
        (p_student, v_subject_id, null, v_chapter_name, v_chapter_name, 'syllabus',
         v_chapter_order, p_session, v_semester)
      on conflict (student_subject_id,
                   coalesce(paper_id, '00000000-0000-0000-0000-000000000000'::uuid),
                   parsed_name, session_label, semester)
        where session_label is not null
      -- name is deliberately absent from this SET: once matched, a rename
      -- is never reverted by a later re-import. syllabus_removed_at clears
      -- here too — a chapter that reappears in the document was never
      -- really gone.
      do update set sort_order = excluded.sort_order,
                    syllabus_removed_at = null;

      v_chapters_written := v_chapters_written + 1;
      v_chapter_order := v_chapter_order + 1;
    end loop;

    -- Delete-or-flag (see header). Only touches this subject's direct
    -- chapters (paper_id is null) — paper chapters get their own pass below,
    -- scoped to v_paper_id, so the two passes never overlap.
    --
    -- Delete first: unambiguous parser noise only — never renamed, never
    -- progressed, never scoped into an assessment, and syllabus-sourced.
    delete from public.chapters c
     where c.student_subject_id = v_subject_id
       and c.paper_id is null
       and c.session_label = p_session
       and c.semester is not distinct from v_semester
       and c.syllabus_removed_at is null
       and c.parsed_name <> all (v_seen_names)
       and c.source = 'syllabus'
       and c.status = 'not_started'
       and c.name is not distinct from c.parsed_name
       and not exists (
         select 1 from public.assessment_chapters ac where ac.chapter_id = c.id
       );
    get diagnostics v_deleted_now = row_count;
    v_chapters_deleted := v_chapters_deleted + v_deleted_now;

    -- Everything else absent from this commit is flagged, not deleted — a
    -- rename, a progress tap, an assessment link, or a manual row (excluded
    -- entirely by source) all mean a human cares about this row. Rows the
    -- DELETE above already removed no longer match this scan.
    update public.chapters
       set syllabus_removed_at = now()
     where student_subject_id = v_subject_id
       and paper_id is null
       and session_label = p_session
       and semester is not distinct from v_semester
       and syllabus_removed_at is null
       and parsed_name <> all (v_seen_names);
    get diagnostics v_flagged_now = row_count;
    v_chapters_flagged := v_chapters_flagged + v_flagged_now;

    -- Papers — e.g. Math D + Add Math under Mathematics — and their chapters.
    v_paper_order := 0;
    for v_paper in select * from jsonb_array_elements(coalesce(v_subject -> 'papers', '[]'::jsonb))
    loop
      v_paper_name := nullif(btrim(v_paper ->> 'name'), '');
      if v_paper_name is null then
        raise exception 'Every paper needs a name.' using errcode = 'check_violation';
      end if;

      insert into public.subject_papers (student_id, student_subject_id, name, sort_order)
      values (p_student, v_subject_id, v_paper_name, v_paper_order)
      on conflict (student_subject_id, name) do update
         set sort_order = excluded.sort_order
      returning id into v_paper_id;

      v_papers_written := v_papers_written + 1;
      v_paper_order := v_paper_order + 1;

      v_chapter_order := 0;
      v_seen_names := '{}';
      for v_chapter in select * from jsonb_array_elements(coalesce(v_paper -> 'chapters', '[]'::jsonb))
      loop
        if jsonb_typeof(v_chapter) is distinct from 'string' then
          raise exception 'Chapter names must be strings.' using errcode = 'check_violation';
        end if;
        v_chapter_name := btrim(v_chapter #>> '{}');
        if v_chapter_name is null or v_chapter_name = '' then
          continue;
        end if;
        v_seen_names := v_seen_names || v_chapter_name;

        insert into public.chapters
          (student_id, student_subject_id, paper_id, name, parsed_name, source,
           sort_order, session_label, semester)
        values
          (p_student, v_subject_id, v_paper_id, v_chapter_name, v_chapter_name, 'syllabus',
           v_chapter_order, p_session, v_semester)
        on conflict (student_subject_id,
                     coalesce(paper_id, '00000000-0000-0000-0000-000000000000'::uuid),
                     parsed_name, session_label, semester)
          where session_label is not null
        do update set sort_order = excluded.sort_order,
                      syllabus_removed_at = null;

        v_chapters_written := v_chapters_written + 1;
        v_chapter_order := v_chapter_order + 1;
      end loop;

      delete from public.chapters c
       where c.student_subject_id = v_subject_id
         and c.paper_id = v_paper_id
         and c.session_label = p_session
         and c.semester is not distinct from v_semester
         and c.syllabus_removed_at is null
         and c.parsed_name <> all (v_seen_names)
         and c.source = 'syllabus'
         and c.status = 'not_started'
         and c.name is not distinct from c.parsed_name
         and not exists (
           select 1 from public.assessment_chapters ac where ac.chapter_id = c.id
         );
      get diagnostics v_deleted_now = row_count;
      v_chapters_deleted := v_chapters_deleted + v_deleted_now;

      update public.chapters
         set syllabus_removed_at = now()
       where student_subject_id = v_subject_id
         and paper_id = v_paper_id
         and session_label = p_session
         and semester is not distinct from v_semester
         and syllabus_removed_at is null
         and parsed_name <> all (v_seen_names);
      get diagnostics v_flagged_now = row_count;
      v_chapters_flagged := v_chapters_flagged + v_flagged_now;
    end loop;
  end loop;

  return jsonb_build_object(
    'subjects_committed', v_subjects_written,
    'papers_committed',   v_papers_written,
    'chapters_committed', v_chapters_written,
    'chapters_deleted',   v_chapters_deleted,
    'chapters_flagged',   v_chapters_flagged
  );
end;
$fn$;
