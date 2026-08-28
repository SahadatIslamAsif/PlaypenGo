-- 0020 — the alert window lands on `assessments` (SPEC.md §3.2, §7.3, §7.5)
--
-- §3.2 already describes this schema; the database has never had it. That gap
-- is the reason to close it now rather than in Phase 6: a spec that describes
-- columns which do not exist is worse than one that says nothing, because the
-- next person reads it and believes it.
--
-- Three changes, and the third is the one with teeth.
--
--   1. `window_closed_at` / `window_close_reason` arrive. §3.2: closing "is a
--      fact about the window as a whole, not about any one occurrence", which
--      is why they live here and not on `alerts`.
--
--   2. `predicted_for_date` goes. It held the old single-guess model's one
--      date per CWM. §7.3 replaced that model outright — a CWM's occurrence
--      dates live as `alerts.target_date` rows, one per occurrence, and there
--      is no single date left to keep.
--
--   3. Both triggers that touch assessment lifecycle are repaired around it.
--      This is not bookkeeping: 0016 deliberately deferred the predicted case
--      ("Phase 6 gets to make that call, with a real writer to test it
--      against"), and leaving that deferral in place while adding the columns
--      would produce a delete path that destroys the very window it should
--      reopen.
--
-- Phase 5 writes no `predicted` CWM — opening windows is Phase 6's engine. The
-- close path is wired now anyway, so that phase only has to open them.

-- ---------------------------------------------------------- window columns ---

alter table public.assessments
  add column window_closed_at    timestamptz,
  add column window_close_reason text;

-- §7.5's four reasons, in full. `ct_cancelled` is here because a
-- one-occurrence CT window has no "exhausted" state of its own.
alter table public.assessments
  add constraint assessments_window_close_reason_check
  check (window_close_reason in
          ('result_logged', 'two_no_in_a_row', 'window_exhausted', 'ct_cancelled'));

-- A reason without a time is a half-written close, and a time without a reason
-- is a close nobody can explain. Both or neither.
alter table public.assessments
  add constraint assessments_window_close_pairing_check
  check ((window_closed_at is null) = (window_close_reason is null));

-- ------------------------------------------------------ predicted_for_date ---
--
-- 0013 wrote `check (predicted_for_date is null or type = 'CWM')` inline, so
-- it carries a system-generated name and there is nothing readable to drop by
-- hand. DROP COLUMN takes any constraint that references the column with it,
-- which is the whole of the cleanup. 0014's suite asserted that constraint
-- ("predicted_for_date is CWM-only") and now asserts the window columns
-- instead.

alter table public.assessments
  drop column predicted_for_date;

-- ----------------------------------------- results_mark_assessment_logged() ---
--
-- 0013 made "a result implies a logged assessment" a database fact. §7.5 adds
-- a second fact to the same moment: a result logged against an assessment that
-- was still being watched closes its window, with reason `result_logged`.
--
-- Doing it here rather than in each caller is the argument 0013 already made,
-- and it is worth more now than it was then — §5.3's scan confirm, the manual
-- entry form and Phase 6's own writers all reach this trigger, and only one of
-- them would otherwise remember.
--
-- Two guards decide whether there was a window to close at all:
--
--   * `a.status <> 'logged'` — a row inserted straight at 'logged' was created
--     to hold this result and never had a window. log_manual_result() is
--     rewritten below to do exactly that, and §5.3's scan confirm does the
--     same. A row that was 'predicted', 'scheduled' or 'occurred' had a life
--     before this result, and that life is what closes.
--   * `a.window_closed_at is null` — a window already closed keeps the reason
--     it closed for. A late-uploaded paper arriving after `two_no_in_a_row`
--     records the result without rewriting why the app had stopped asking.
--
-- The right-hand side of an UPDATE sees the row's pre-update values, so
-- `a.status` below is the status the row held before this statement set it to
-- 'logged'.

create or replace function public.results_mark_assessment_logged()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  update public.assessments a
     set status        = 'logged',
         occurred_date = coalesce(a.occurred_date, a.scheduled_date, current_date),
         window_closed_at = case
           when a.status <> 'logged' and a.window_closed_at is null
             then now()
           else a.window_closed_at
         end,
         window_close_reason = case
           when a.status <> 'logged' and a.window_closed_at is null
             then 'result_logged'
           else a.window_close_reason
         end
   where a.id = new.assessment_id;
  return null;
end;
$fn$;

-- -------------------------------------- results_reset_assessment_on_delete() ---
--
-- 0016 split on "does the assessment have an identity independent of this one
-- result", and left a third case explicitly unanswered: a predicted CWM, whose
-- writer did not exist yet. It still does not, but the column that identifies
-- one does, so the case can be answered rather than deferred a second time —
-- and it has to be, because 0016's `else` branch DELETES, which for a window
-- row would destroy the very thing that was watching for the paper.
--
-- The three cases, in the order they are tested:
--
--   * `scheduled_date is not null` — a CT the student put on the calendar.
--     0016's reasoning, unchanged: revert to 'scheduled' and clear
--     occurred_date, the exact inverse of the INSERT trigger's coalesce. The
--     window reopens with it; the CT is once again a date being watched.
--   * `window_closed_at is not null` — no scheduled_date, but something closed
--     a window here, which under the guards above can only mean the row
--     predated its result. Revert to 'predicted' and reopen.
--   * otherwise — created to hold this result, by log_manual_result() or
--     §5.3's scan confirm. Nothing else refers to it; it goes.
--
-- Deliberately not preserved: a window row that reached 'occurred' through
-- §7.6's Yes tap reverts to 'predicted', not to 'occurred'. Restoring the
-- confirmation would mean restoring its pending-result placeholder too, and
-- that placeholder is Phase 6's to define. This is 0016's deferral again,
-- narrowed to the one case that still has no writer.

create or replace function public.results_reset_assessment_on_delete()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if exists (
    select 1 from public.assessments a
     where a.id = old.assessment_id and a.scheduled_date is not null
  ) then
    update public.assessments
       set status              = 'scheduled',
           occurred_date       = null,
           window_closed_at    = null,
           window_close_reason = null
     where id = old.assessment_id;

  elsif exists (
    select 1 from public.assessments a
     where a.id = old.assessment_id and a.window_closed_at is not null
  ) then
    update public.assessments
       set status              = 'predicted',
           occurred_date       = null,
           window_closed_at    = null,
           window_close_reason = null
     where id = old.assessment_id;

  else
    delete from public.assessments where id = old.assessment_id;
  end if;

  return null;
end;
$fn$;

-- -------------------------------------------------------- log_manual_result ---
--
-- 0017 verbatim but for one literal: the assessment it creates is inserted at
-- status 'logged' rather than 'occurred'. That value was always transient —
-- the INSERT on `results` fires results_mark_assessment_logged() microseconds
-- later and overwrites it — but it is what the trigger above now reads to
-- decide whether a window existed. A row created to hold a result must not
-- claim to have been watched.

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
