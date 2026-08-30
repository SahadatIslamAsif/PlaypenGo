-- 0009 — commit_syllabus_tree(): the tutor write path onto the subject tree
-- (ARCHITECTURE.md §3.1, §4.2; the decision flagged in 0008 and asserted in 0009's
-- pgTAP suite)
--
-- 0008 left writes on student_subjects/subject_papers/chapters as student-only
-- at the table level — deliberately, because §3.3 grants tutors nothing beyond
-- assessments/results/result_images, and a policy that let a tutor write a
-- student's syllabus tree would let them write ANY linked student's tree, with
-- no way to scope it to "the syllabus commit step" specifically.
--
-- This is that scoped path. Table-level RLS is unchanged — still student-only,
-- still exactly what 0008 shipped and what 0009's pgTAP suite already asserts.
-- SECURITY DEFINER runs as the function owner, so it isn't subject to those
-- policies, and it does its own authorization check as the first thing it
-- does: p_student = auth.uid() OR is_tutor_of(p_student). Nobody else reaches
-- this table through it.
--
-- Chapters carry a partial unique index scoped to session_label so a repeat
-- commit of the same term is a no-op rather than a duplicate, while chapters
-- from an earlier session_label are left alone — the exact protection §4.2
-- asks for ("next term's upload does not destroy this term's history").
-- Manually-added chapters (session_label null, via the ordinary per-row
-- INSERT policy) are outside this index and unaffected.

create unique index chapters_syllabus_commit_uniq
  on public.chapters (
    student_subject_id,
    coalesce(paper_id, '00000000-0000-0000-0000-000000000000'::uuid),
    name,
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
  v_subjects_written int := 0;
  v_papers_written   int := 0;
  v_chapters_written int := 0;
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
    for v_chapter in select * from jsonb_array_elements(coalesce(v_subject -> 'chapters', '[]'::jsonb))
    loop
      if jsonb_typeof(v_chapter) is distinct from 'string' then
        raise exception 'Chapter names must be strings.' using errcode = 'check_violation';
      end if;
      v_chapter_name := btrim(v_chapter #>> '{}');
      if v_chapter_name is null or v_chapter_name = '' then
        continue;
      end if;

      insert into public.chapters
        (student_id, student_subject_id, paper_id, name, source,
         sort_order, session_label, semester)
      values
        (p_student, v_subject_id, null, v_chapter_name, 'syllabus',
         v_chapter_order, p_session, v_semester)
      on conflict (student_subject_id,
                   coalesce(paper_id, '00000000-0000-0000-0000-000000000000'::uuid),
                   name, session_label, semester)
        where session_label is not null
      do update set sort_order = excluded.sort_order;

      v_chapters_written := v_chapters_written + 1;
      v_chapter_order := v_chapter_order + 1;
    end loop;

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
      for v_chapter in select * from jsonb_array_elements(coalesce(v_paper -> 'chapters', '[]'::jsonb))
      loop
        if jsonb_typeof(v_chapter) is distinct from 'string' then
          raise exception 'Chapter names must be strings.' using errcode = 'check_violation';
        end if;
        v_chapter_name := btrim(v_chapter #>> '{}');
        if v_chapter_name is null or v_chapter_name = '' then
          continue;
        end if;

        insert into public.chapters
          (student_id, student_subject_id, paper_id, name, source,
           sort_order, session_label, semester)
        values
          (p_student, v_subject_id, v_paper_id, v_chapter_name, 'syllabus',
           v_chapter_order, p_session, v_semester)
        on conflict (student_subject_id,
                     coalesce(paper_id, '00000000-0000-0000-0000-000000000000'::uuid),
                     name, session_label, semester)
          where session_label is not null
        do update set sort_order = excluded.sort_order;

        v_chapters_written := v_chapters_written + 1;
        v_chapter_order := v_chapter_order + 1;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object(
    'subjects_committed', v_subjects_written,
    'papers_committed',   v_papers_written,
    'chapters_committed', v_chapters_written
  );
end;
$fn$;

-- Same posture as issue_link_code()/redeem_link_code(): authenticated only,
-- nothing for anon.
revoke execute on function public.commit_syllabus_tree(uuid, jsonb, text)
  from public, anon;

grant execute on function public.commit_syllabus_tree(uuid, jsonb, text)
  to authenticated;
