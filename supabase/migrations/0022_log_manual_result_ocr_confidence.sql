-- 0022 — log_manual_result gains ocr_confidence (SPEC.md §3.2, §5.3)
--
-- 0021 widened this function for entry_mode / name_mismatch /
-- parsed_student_name but missed the fourth field §3.2's own results table
-- has carried since 0013: `ocr_confidence jsonb`, "per-field confidence
-- from the parse." Nothing has ever written it — the manual-entry form has
-- no confidence to report, and confirm_scan_job() (§5.3's "on confirm") is
-- the only caller that ever will. Same shape as 0021's own widening: one
-- new optional key, defaulted to exactly what every existing caller
-- already gets — null.

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
  v_chapter_ids       uuid[];
  v_type              text;
  v_occurred          date;
  v_obtained          numeric;
  v_total             numeric;
  v_entry_mode        text;
  v_name_mismatch     bool;
  v_parsed_name       text;
  v_ocr_confidence    jsonb;
  v_result_id         uuid;
  v_percentage        numeric;
  v_converted         numeric;
begin
  v_obtained := nullif(p_entry ->> 'raw_obtained', '')::numeric;
  v_total    := nullif(p_entry ->> 'raw_total', '')::numeric;

  if v_obtained is null or v_total is null then
    raise exception 'Enter both the obtained and total marks.'
      using errcode = 'check_violation';
  end if;

  v_entry_mode     := coalesce(nullif(p_entry ->> 'entry_mode', ''), 'manual');
  v_name_mismatch  := coalesce((p_entry ->> 'name_mismatch')::bool, false);
  v_parsed_name    := nullif(p_entry ->> 'parsed_student_name', '');
  -- `->` not `->>`: this is a jsonb object ({subject, marks, chapter}), not
  -- text. Absent key -> SQL null -> the column stays null, same "every
  -- existing caller unaffected" shape as the other three optional keys.
  v_ocr_confidence := p_entry -> 'ocr_confidence';

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
    -- No assessment yet: the manual-entry form, or a scan with no window to
    -- attach to, is creating both at once.
    v_student_subject := nullif(p_entry ->> 'student_subject_id', '')::uuid;
    v_paper           := nullif(p_entry ->> 'paper_id', '')::uuid;
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
      (student_id, student_subject_id, paper_id, type,
       status, occurred_date, created_by)
    values
      (p_student, v_student_subject, v_paper, v_type,
       'logged', coalesce(v_occurred, current_date), (select auth.uid()))
    returning id into v_assessment_id;
  end if;

  -- chapter_ids is optional on both entry shapes — a paper that names no
  -- chapter at all is exactly as valid today as it was under the old scalar
  -- column, and set_assessment_chapters() treats an empty/absent array as
  -- "no chapters" rather than an error.
  select array_agg(nullif(value, '')::uuid)
    into v_chapter_ids
    from jsonb_array_elements_text(coalesce(p_entry -> 'chapter_ids', '[]'::jsonb)) as value;

  perform public.set_assessment_chapters(v_assessment_id, v_chapter_ids);

  insert into public.results
    (assessment_id, student_id, raw_obtained, raw_total, paper_missing,
     entry_mode, verified_by, name_mismatch, parsed_student_name, ocr_confidence)
  values
    (v_assessment_id, p_student, v_obtained, v_total,
     coalesce((p_entry ->> 'paper_missing')::bool, false),
     v_entry_mode, (select auth.uid()), v_name_mismatch, v_parsed_name, v_ocr_confidence)
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
