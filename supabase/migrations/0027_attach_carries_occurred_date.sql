-- 0027 — attaching a result carries its occurred_date through (CLAUDE.md's
-- hard rule; SPEC.md §6: "occurred_date comes from the paper's header, never
-- from logged_at")
--
-- log_manual_result()'s attach branch (`v_assessment_id is not null` — a CT
-- already on the calendar, or a CWM window from §7.3/§7.6) only ever read
-- `p_entry`'s occurred_date in the OTHER branch, the one creating a fresh
-- assessment. Attaching silently dropped it. results_mark_assessment_logged()
-- (0020) then backfills occurred_date with
-- `coalesce(a.occurred_date, a.scheduled_date, current_date)` — and for a
-- predicted CWM, both of those are always null (nothing sets either before a
-- result lands), so every CWM auto-attach fell straight through to
-- current_date: the day the khata was scanned, not the day printed on it.
--
-- A CT attach happened not to show the bug — findCTAttachment (§5.3) only
-- ever attaches on an exact scheduled_date match, so the coalesce's second
-- branch already produced the right date by coincidence. CWM has nothing to
-- fall back on, which is exactly why §10 item 9 (the CWM auto-attach path)
-- had never been run against real data until now: the moment it ran, this is
-- what it produced.
--
-- The fix is entirely in this function. v_occurred moves up so both branches
-- share one read of the entry, and the attach branch now writes it onto the
-- assessment before the results INSERT that fires
-- results_mark_assessment_logged() — so by the time that trigger's own
-- coalesce runs, occurred_date is already set and the trigger's existing
-- logic (unchanged, and correct as written) preserves it rather than falling
-- through to current_date. No caller passes a date on the CT-attach path
-- today, so its behaviour is unchanged; a CWM attach now behaves the way
-- §5.3's "on confirm" always described.

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
  v_ocr_confidence := p_entry -> 'ocr_confidence';
  -- Read once, used by both branches below — the paper's date, whether it is
  -- attaching to an existing assessment or seeding a brand new one.
  v_occurred       := nullif(p_entry ->> 'occurred_date', '')::date;

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

    -- The fix: carry the submitted date onto the assessment before the
    -- results INSERT below fires results_mark_assessment_logged(). A
    -- predicted CWM window has no occurred_date and no scheduled_date to
    -- coalesce to — leaving this unset is exactly what let that trigger's
    -- fallback silently reach current_date. Nothing here if the caller
    -- genuinely supplied no date; the trigger's existing coalesce chain is
    -- still the right fallback for that case, unchanged.
    if v_occurred is not null then
      update public.assessments
         set occurred_date = v_occurred
       where id = v_assessment_id;
    end if;
  else
    -- No assessment yet: the manual-entry form, or a scan with no window to
    -- attach to, is creating both at once.
    v_student_subject := nullif(p_entry ->> 'student_subject_id', '')::uuid;
    v_paper           := nullif(p_entry ->> 'paper_id', '')::uuid;
    v_type            := nullif(p_entry ->> 'type', '');

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
