-- 0014 — log_manual_result(): atomic assessment + result (SPEC.md §5.3, §6)
--
-- Unlike Phase 3's commit_routine_grid() and Phase 2's commit_syllabus_tree(),
-- this is SECURITY INVOKER. Those needed a definer because the tutor had no
-- table-level write path onto the tables involved; 0013 gives the tutor
-- INSERT/UPDATE on assessments and results directly, so this function needs no
-- privilege of its own. Running as the caller means the policies from 0013 are
-- still what authorizes every statement inside it — there is exactly one
-- authorization story for these two tables, not two that have to be kept in
-- sync.
--
-- Its reason to exist is purely atomicity. §5.3's manual fallback logs a
-- subject, paper, type, chapter, obtained and total in one form; that is one
-- assessment row and one result row, and two client round trips can leave the
-- first without the second — an assessment stuck at 'scheduled' forever, or
-- (worse) a result INSERT that fails after a real assessment has already been
-- created. Wrapping both in one function makes the pair one statement.

create or replace function public.log_manual_result(
  p_student uuid,
  p_entry   jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_assessment_id     uuid;
  v_student_subject   uuid;
  v_paper             uuid;
  v_chapter           uuid;
  v_type              text;
  v_occurred          date;
  v_obtained          numeric;
  v_total             numeric;
  v_result_id         uuid;
  v_percentage        numeric;
  v_converted         numeric;
begin
  -- No auth.uid()-vs-p_student check here on purpose: 0013's policies already
  -- run on every INSERT/UPDATE this function issues, under the caller's own
  -- privileges. A guardian or an unlinked tutor gets exactly the 42501 they
  -- would get calling supabase.from(...) directly — this function adds
  -- atomicity, not a second gate.

  v_obtained := nullif(p_entry ->> 'raw_obtained', '')::numeric;
  v_total    := nullif(p_entry ->> 'raw_total', '')::numeric;

  if v_obtained is null or v_total is null then
    raise exception 'Enter both the obtained and total marks.'
      using errcode = 'check_violation';
  end if;

  v_assessment_id := nullif(p_entry ->> 'assessment_id', '')::uuid;

  if v_assessment_id is not null then
    -- §5.3's other path: a CT already on the calendar, or a CWM confirmed
    -- through §7.6's "did this happen?" link. The assessment must already be
    -- this student's — the SELECT itself is policy-gated, so a mismatched or
    -- foreign id simply finds no row rather than leaking whose it is.
    select a.id into v_assessment_id
      from public.assessments a
     where a.id = v_assessment_id and a.student_id = p_student;

    if v_assessment_id is null then
      raise exception 'That assessment could not be found for this student.'
        using errcode = 'no_data_found';
    end if;

    if exists (select 1 from public.results r where r.assessment_id = v_assessment_id) then
      raise exception 'A result is already logged for this assessment.'
        using errcode = 'unique_violation';
    end if;
  else
    -- No assessment yet: the manual-entry form is creating both at once.
    v_student_subject := nullif(p_entry ->> 'student_subject_id', '')::uuid;
    v_paper           := nullif(p_entry ->> 'paper_id', '')::uuid;
    v_chapter         := nullif(p_entry ->> 'chapter_id', '')::uuid;
    v_type            := nullif(p_entry ->> 'type', '');
    v_occurred        := nullif(p_entry ->> 'occurred_date', '')::date;

    if v_student_subject is null then
      raise exception 'Choose a subject.' using errcode = 'check_violation';
    end if;

    if v_type is distinct from 'CT' and v_type is distinct from 'CWM' then
      raise exception 'Choose whether this is a CT or a CWM.'
        using errcode = 'check_violation';
    end if;

    insert into public.assessments
      (student_id, student_subject_id, paper_id, chapter_id, type,
       status, occurred_date, created_by)
    values
      (p_student, v_student_subject, v_paper, v_chapter, v_type,
       'occurred', coalesce(v_occurred, current_date), (select auth.uid()))
    returning id into v_assessment_id;
  end if;

  insert into public.results
    (assessment_id, student_id, raw_obtained, raw_total, paper_missing,
     entry_mode, verified_by)
  values
    (v_assessment_id, p_student, v_obtained, v_total,
     coalesce((p_entry ->> 'paper_missing')::bool, false),
     'manual', (select auth.uid()))
  returning id, percentage, converted into v_result_id, v_percentage, v_converted;

  return jsonb_build_object(
    'assessment_id', v_assessment_id,
    'result_id',     v_result_id,
    -- Read back from the generated columns (0013), never recomputed here, so
    -- the caller displays what Postgres actually stored.
    'percentage',    v_percentage,
    'converted',     v_converted
  );
end;
$fn$;

revoke execute on function public.log_manual_result(uuid, jsonb) from public, anon;
grant execute on function public.log_manual_result(uuid, jsonb) to authenticated;
