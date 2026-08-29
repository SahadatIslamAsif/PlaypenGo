-- 0023 — attach_scan_job_to_result: §5.3's duplicate offer and "attach paper
-- later", one RPC for both
--
-- Two different screens end up needing the exact same write:
--
--   * Duplicate detection at confirm (§5.3: "match on student + subject +
--     occurred_date + raw score; on a hit, offer attach these images to the
--     existing result rather than rejecting the upload") — the target result
--     is only known once the review screen's own confirm attempt turns up a
--     match, via lib/scans/match.ts's findDuplicateResult.
--   * "Attach paper later" (§5.3: "A manually-logged result therefore accepts
--     images afterwards... leaves confirmed fields alone, fills only what is
--     empty, clears paper_missing, and drops the badge") — the target result
--     is known up front, before the student even opens the camera.
--
-- Both are "take a reviewed scan and file its images against a result that
-- already exists" rather than confirm_scan_job()'s "file them against a
-- result that doesn't exist yet". That's a different enough shape from
-- log_manual_result() (no assessment to create or attach, raw_obtained/
-- raw_total are never touched, chapters only fill a gap rather than replace
-- what's there) that it isn't a caller of confirm_scan_job() or
-- log_manual_result() — it's its own atomic function, following the same
-- SECURITY INVOKER / set_search_path='' shape as both for the same reason:
-- the table policies already say who may update a result or insert a
-- result_images row, so there is one authorization story, not two.

-- ------------------------------------------------------- scan_jobs, widened ---
--
-- target_result_id carries "attach paper later"'s intent through capture and
-- parse, the same reasoning raw_parse itself exists for: "an unconfirmed
-- parse is a row in scan_jobs, not React state... resumable" (0021's header)
-- applies just as much to which result a job is destined for as to what it
-- parsed. It's an *input*, set at job creation; result_id (0021) is the
-- *outcome*, set once attach_scan_job_to_result or confirm_scan_job actually
-- runs — for a job created through this path the two end up equal, but they
-- answer different questions and neither can stand in for the other.

alter table public.scan_jobs
  add column target_result_id uuid;

alter table public.scan_jobs
  add constraint scan_jobs_target_result_id_student_id_fkey
  foreign key (target_result_id, student_id)
  references public.results (id, student_id) on delete set null (target_result_id);

-- ------------------------------------------------------ attach_scan_job_to_result ---

create or replace function public.attach_scan_job_to_result(
  p_job       uuid,
  p_result_id uuid,
  p_entry     jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_student        uuid;
  v_job_status     text;
  v_assessment_id  uuid;
  v_entry_mode     text;
  v_chapters_empty boolean;
  v_chapter_ids    uuid[];
  v_name_mismatch  bool;
  v_parsed_name    text;
  v_ocr_confidence jsonb;
  v_percentage     numeric;
  v_converted      numeric;
  v_images         jsonb;
begin
  -- Same shape as confirm_scan_job()'s own guard, and the same reason: RLS
  -- (scan_jobs_select) already means a job that isn't this caller's own
  -- simply doesn't come back, so "not found" and "not yours" read identically
  -- here, on purpose.
  select sj.student_id, sj.status into v_student, v_job_status
    from public.scan_jobs sj
   where sj.id = p_job;

  if v_student is null then
    raise exception 'That scan could not be found.' using errcode = 'no_data_found';
  end if;

  if v_job_status = 'confirmed' then
    raise exception 'This scan has already been saved.'
      using errcode = 'unique_violation';
  end if;

  if v_job_status not in ('review', 'parsing') then
    raise exception 'This scan is not ready to be saved.'
      using errcode = 'check_violation';
  end if;

  select r.assessment_id, r.entry_mode
    into v_assessment_id, v_entry_mode
    from public.results r
   where r.id = p_result_id and r.student_id = v_student;

  if v_assessment_id is null then
    raise exception 'That result could not be found for this student.'
      using errcode = 'no_data_found';
  end if;

  -- Once a paper is attached the result is no longer "manually logged" —
  -- re-running this against an already-'ocr' result would silently overwrite
  -- a previous scan's evidence with a second one. The UI never offers the
  -- action past that point (§5.3 badge logic); this is the guard behind it.
  if v_entry_mode <> 'manual' then
    raise exception 'This result already has a paper attached.'
      using errcode = 'check_violation';
  end if;

  v_name_mismatch  := coalesce((p_entry ->> 'name_mismatch')::bool, false);
  v_parsed_name    := nullif(p_entry ->> 'parsed_student_name', '');
  v_ocr_confidence := p_entry -> 'ocr_confidence';

  -- "Leaves confirmed fields alone" — raw_obtained/raw_total are absent from
  -- this UPDATE's column list entirely, not merely unset in p_entry. The
  -- three columns below were never set by a manual entry (log_manual_result's
  -- manual path never writes them), so setting them unconditionally from this
  -- scan's own read *is* "fills only what is empty" for these specifically.
  update public.results
     set entry_mode          = 'ocr',
         paper_missing       = false,
         name_mismatch       = v_name_mismatch,
         parsed_student_name = v_parsed_name,
         ocr_confidence      = v_ocr_confidence
   where id = p_result_id
  returning percentage, converted into v_percentage, v_converted;

  -- Chapters are different: a human may already have picked one by hand on
  -- the manual-entry form. The scan's own suggestion is offered only when
  -- there is nothing there yet — never a silent overwrite of a deliberate
  -- choice.
  select not exists (
    select 1 from public.assessment_chapters where assessment_id = v_assessment_id
  ) into v_chapters_empty;

  if v_chapters_empty then
    select array_agg(nullif(value, '')::uuid)
      into v_chapter_ids
      from jsonb_array_elements_text(coalesce(p_entry -> 'chapter_ids', '[]'::jsonb)) as value;

    perform public.set_assessment_chapters(v_assessment_id, v_chapter_ids);
  end if;

  -- Same result_images shape as confirm_scan_job() - one row per page naming
  -- its eventual scripts/ destination, extension carried over from scans/.
  -- No page_no collision to guard against: v_entry_mode = 'manual' just above
  -- already proves this result has never had a page attached before.
  insert into public.result_images (result_id, student_id, storage_path, page_no)
  select
    p_result_id,
    v_student,
    v_student || '/' || p_result_id || '/' || sp.page_no ||
      '.' || substring(sp.storage_path from '\.([^.]+)$'),
    sp.page_no
  from public.scan_pages sp
  where sp.scan_job_id = p_job;

  select jsonb_agg(jsonb_build_object(
           'page_no',   ri.page_no,
           'from_path', sp.storage_path,
           'to_path',   ri.storage_path
         ) order by ri.page_no)
    into v_images
    from public.result_images ri
    join public.scan_pages sp
      on sp.scan_job_id = p_job and sp.page_no = ri.page_no
   where ri.result_id = p_result_id;

  update public.scan_jobs
     set status = 'confirmed', result_id = p_result_id, updated_at = now()
   where id = p_job;

  return jsonb_build_object(
    'assessment_id', v_assessment_id,
    'result_id',     p_result_id,
    'percentage',    v_percentage,
    'converted',     v_converted,
    'scan_job_id',   p_job,
    'images',        v_images
  );
end;
$fn$;

revoke execute on function public.attach_scan_job_to_result(uuid, uuid, jsonb) from public, anon;
grant execute on function public.attach_scan_job_to_result(uuid, uuid, jsonb) to authenticated;
