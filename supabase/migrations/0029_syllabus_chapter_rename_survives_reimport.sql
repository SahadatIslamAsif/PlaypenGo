-- 0029 — a renamed syllabus chapter survives a same-term re-import, and a
-- removed one is flagged rather than silently kept or silently deleted
-- (ARCHITECTURE.md §5.2's "Why this parse skips the review screen"; 0009's
-- commit_syllabus_tree and its chapters_syllabus_commit_uniq index)
--
-- 0009 keyed a syllabus-sourced chapter's identity on `name`, alongside
-- student_subject_id/paper_id/session_label/semester. That's the right key
-- for "the same document parsed twice" (0010's pgTAP suite proves that case
-- stays idempotent) but the wrong one the moment a human renames a chapter:
-- §5.2 makes renaming THE correction path for a bad parse, since the parse
-- itself skips review. Once a chapter's name no longer matches what the
-- document says, a re-commit for that same session_label/semester can't
-- recognise the row it already wrote — `name` is part of the conflict key,
-- so the rename changes the key, and the upsert inserts a second row under
-- the original parsed name instead of updating the one the student already
-- fixed.
--
-- A position-based key (student's own first attempt at this fix) was
-- considered and rejected: keying on a chapter's index in the parsed array
-- survives a rename, but breaks the moment a re-import inserts, removes, or
-- reorders chapters anywhere in the document — every chapter after the
-- change point matches a different row than before, silently attaching its
-- old (frozen, never-refreshed) name to whatever text now occupies that
-- position. That is a materially worse failure than the one bug it fixed:
-- 0009's original name-based match was already robust to reordering, since
-- content — not position — is what identity should track.
--
-- The actual fix: keep matching on content, the way 0009 always did, but
-- make the matched field immutable. `parsed_name` is set once, at the
-- moment a chapter is first committed, and is never written again by this
-- function. `name` stays exactly what it already was — the mutable display
-- value the subjects-screen rename affordance edits — but it drops out of
-- the conflict key entirely. A rename changes `name`; a re-import matches
-- on `parsed_name`, which the rename never touched. Insertion, deletion,
-- and reordering elsewhere in the document keep working exactly as they
-- did under 0009, because matching is still content-based, not positional.
--
-- The other question this raises: a re-import whose incoming chapter list
-- no longer contains a given `parsed_name` — the document dropped that
-- chapter. Deleting the row outright is schema-safe (0017: a chapter's
-- delete cascades only the assessment_chapters LINK, never the assessment
-- or any result already logged against it), but "schema-safe" isn't the
-- bar §5.2 set — a silent, automated delete is the one thing a chapter
-- gets to never be, since surfacing errors through normal use is the
-- entire justification for skipping the review screen in the first place.
-- A deletion has nothing to surface; the row is just gone, along with
-- whatever progress the student tapped in or CWM window is watching it.
-- So: flagged, not deleted. `syllabus_removed_at` is stamped when a
-- previously-committed chapter's `parsed_name` doesn't appear in the
-- current commit, and cleared if a later commit brings it back. The row
-- stays visible and exactly as deletable as it always was — the flag makes
-- the removal visible to a human instead of making the decision for them.
--
-- Scope, named rather than silently assumed: this removal-flagging pass
-- only ever looks at CHAPTERS within a subject (or paper) that the current
-- commit actually visits. A re-import that drops an entire SUBJECT or PAPER
-- from the tree leaves that subject's/paper's own chapters unflagged —
-- subjects and papers have no removal semantics at all here, same as 0009
-- left them (pure upsert, never touched by absence). Extending "flag, don't
-- delete" up to that level is a bigger, separate decision than the one this
-- migration was asked to make.
--
-- Zero production callers exist for commit_syllabus_tree today (§5.2's
-- syllabus parser hasn't shipped), so there is no committed syllabus data
-- to reconcile — the backfill below is defensive only, covering any local
-- dev/staging rows, not a real migration of live chapters.

alter table public.chapters add column parsed_name text;
alter table public.chapters add column syllabus_removed_at timestamptz;

update public.chapters
   set parsed_name = name
 where session_label is not null
   and parsed_name is null;

drop index if exists public.chapters_syllabus_commit_uniq;

create unique index chapters_syllabus_commit_uniq
  on public.chapters (
    student_subject_id,
    coalesce(paper_id, '00000000-0000-0000-0000-000000000000'::uuid),
    parsed_name,
    session_label,
    semester
  )
  where session_label is not null;

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
  v_removed_now      int;
  v_subjects_written int := 0;
  v_papers_written   int := 0;
  v_chapters_written int := 0;
  v_chapters_removed int := 0;
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

    -- Flag, don't delete (see header). Only touches this subject's direct
    -- chapters (paper_id is null) — paper chapters get their own pass below,
    -- scoped to v_paper_id, so the two passes never overlap.
    update public.chapters
       set syllabus_removed_at = now()
     where student_subject_id = v_subject_id
       and paper_id is null
       and session_label = p_session
       and semester is not distinct from v_semester
       and syllabus_removed_at is null
       and parsed_name <> all (v_seen_names);
    get diagnostics v_removed_now = row_count;
    v_chapters_removed := v_chapters_removed + v_removed_now;

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

      update public.chapters
         set syllabus_removed_at = now()
       where student_subject_id = v_subject_id
         and paper_id = v_paper_id
         and session_label = p_session
         and semester is not distinct from v_semester
         and syllabus_removed_at is null
         and parsed_name <> all (v_seen_names);
      get diagnostics v_removed_now = row_count;
      v_chapters_removed := v_chapters_removed + v_removed_now;
    end loop;
  end loop;

  return jsonb_build_object(
    'subjects_committed', v_subjects_written,
    'papers_committed',   v_papers_written,
    'chapters_committed', v_chapters_written,
    'chapters_removed',   v_chapters_removed
  );
end;
$fn$;
