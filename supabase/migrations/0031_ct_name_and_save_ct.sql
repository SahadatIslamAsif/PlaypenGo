-- 0031 — assessments.name and save_ct() (ARCHITECTURE.md §3.2, §7.5, §8)
--
-- A CT stops belonging to any single chapter once it can span several
-- (0017's assessment_chapters), so the "CT date" it used to carry pinned to
-- one chapter row is moving up to the subject. Once the CT section on
-- Results lists every CT for a subject flat, "the CT scheduled for
-- 2026-09-10" is no longer enough to tell two of them apart on the same
-- subject — a name is what a student actually calls it in conversation
-- ("CT 2", or whatever they type), and this migration is where it starts
-- being stored rather than reconstructed from a date.
--
-- Nullable, no default: log_manual_result() (0027) inserts both CT and CWM
-- rows at 'logged' with no name in its entry shape, and a not-null default
-- would stamp a label the student never chose onto every scan-confirmed row.
-- CT-only mirrors the existing `scheduled_date is null or type = 'CT'` idiom
-- from 0013. No uniqueness constraint: Math D and Add Math share one
-- student_subject_id (§4.2), so "CT 1" legitimately occurs twice per subject,
-- and nothing joins on the name.

alter table public.assessments add column name text;

alter table public.assessments
  add constraint assessments_name_ct_only_check
  check (name is null or type = 'CT');

alter table public.assessments
  add constraint assessments_name_shape_check
  check (name is null or (name = btrim(name) and length(name) between 1 and 60));

-- ------------------------------------------------------------------ backfill ---
--
-- Every existing CT gets "CT N", numbered within (student_id,
-- student_subject_id) — the same partition Math D/Add Math already keep
-- separate everywhere else. Ordered by the date the test actually happened
-- or is due, not by row creation order: a CT entered into the app out of
-- order (a postponed one re-saved after a later one was already scheduled,
-- say) must still read "CT 1, CT 2" in the order a student would say them
-- aloud. `created_at, id` breaks ties only when no date exists yet.
--
-- Cancelled CTs consume a number rather than being skipped or renumbered
-- afterward — §8's cancel path leaves the row in place, and renumbering
-- around it would silently turn a student's "CT 3" into "CT 2" the next time
-- any CT in that subject is touched.
--
-- This has to run before save_ct() exists below: save_ct() and the UI both
-- assume the numbering already reflects the current population, so a new
-- CT's default name ("CT " || count+1) is never computed against a subject
-- that secretly still has zero named rows.

with numbered as (
  select id,
         row_number() over (
           partition by student_id, student_subject_id
           order by coalesce(scheduled_date, occurred_date,
                              (created_at at time zone 'Asia/Dhaka')::date),
                    created_at, id
         ) as n
    from public.assessments
   where type = 'CT'
)
update public.assessments a
   set name = 'CT ' || numbered.n
  from numbered
 where a.id = numbered.id;

-- --------------------------------------------------------------- save_ct() ---
--
-- Modelled on log_manual_result() (0014, 0017, 0027): one p_entry jsonb
-- shape, one atomic insert-or-update plus set_assessment_chapters() call, the
-- same policy-gated SELECT-then-404 pattern so a foreign assessment id finds
-- no row rather than leaking whose it is. SECURITY INVOKER — the ordinary
-- assessments_insert/assessments_update policies (0018: is_owner_student(),
-- student-only) are what authorize every write here, exactly as they already
-- authorize assignCTDate()'s direct table writes today. This function does
-- not widen who may schedule a CT; it only makes "insert or update, plus its
-- chapter links, in one call" atomic the way log_manual_result() already is
-- for a logged result.
--
-- It deliberately does not compute "CT N" itself. The schedule sheet shows
-- the proposed name before saving, computed client-side from the subject's
-- already-loaded CT list; a second implementation of that count in SQL is a
-- second thing that can disagree with what the student was shown.
--
-- The one piece of behaviour beyond a straight port of assignCTDate(): when
-- re-dating a CT that is not already logged/occurred, it reopens the CT's
-- window. This fixes a live bug, not a new feature. 0026's
-- assessments_close_window_on_cancel() trigger closes a window on the
-- transition into 'cancelled' and has no inverse; assignCTDate()'s UPDATE
-- branch set status back to 'scheduled' on a postpone but never touched
-- window_closed_at/window_close_reason. advanceWindows() (§7.3) filters on
-- `window_closed_at is null`, so a cancelled-then-rescheduled CT — or one
-- postponed after its own window closed some other way — stayed live in the
-- UI while being permanently invisible to the notification engine: it would
-- never alert again. A CT already at 'logged' or 'occurred' keeps its status
-- and its closed window untouched — renaming a logged test is not
-- rescheduling it, and §7.5's "result_logged" close reason must not be
-- silently overwritten by a rename that happens to also touch the date.

create or replace function public.save_ct(
  p_student uuid,
  p_entry   jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_assessment_id   uuid;
  v_student_subject uuid;
  v_name            text;
  v_date            date;
  v_chapter_ids     uuid[];
  v_status          text;
begin
  v_name := nullif(btrim(p_entry ->> 'name'), '');
  v_date := nullif(p_entry ->> 'scheduled_date', '')::date;

  if v_date is null then
    raise exception 'Choose a date for the test.' using errcode = 'check_violation';
  end if;

  v_assessment_id := nullif(p_entry ->> 'assessment_id', '')::uuid;

  if v_assessment_id is not null then
    -- Same shape as log_manual_result()'s attach branch: the SELECT is
    -- policy-gated (assessments_select, §3.3's usual three), so a
    -- mismatched or foreign id simply finds no row rather than leaking
    -- whose it is. Scoped to type = 'CT' too — this function never edits a
    -- CWM.
    select a.id, a.status into v_assessment_id, v_status
      from public.assessments a
     where a.id = v_assessment_id and a.student_id = p_student and a.type = 'CT';

    if v_assessment_id is null then
      raise exception 'That test could not be found for this student.'
        using errcode = 'no_data_found';
    end if;

    update public.assessments
       set name                = coalesce(v_name, name),
           scheduled_date      = v_date,
           status              = case when v_status in ('logged', 'occurred')
                                       then v_status else 'scheduled' end,
           window_closed_at    = case when v_status in ('logged', 'occurred')
                                       then window_closed_at else null end,
           window_close_reason = case when v_status in ('logged', 'occurred')
                                       then window_close_reason else null end
     where id = v_assessment_id;
  else
    -- No assessment yet: the subject card's "Schedule a CT" trigger is
    -- creating one for the first time.
    v_student_subject := nullif(p_entry ->> 'student_subject_id', '')::uuid;

    if v_student_subject is null then
      raise exception 'Choose a subject.' using errcode = 'check_violation';
    end if;

    insert into public.assessments
      (student_id, student_subject_id, type, status, scheduled_date, name, created_by)
    values
      (p_student, v_student_subject, 'CT', 'scheduled', v_date, v_name, (select auth.uid()))
    returning id into v_assessment_id;
  end if;

  -- chapter_ids is optional in shape (set_assessment_chapters() treats an
  -- empty/absent array as "no chapters" rather than an error) but the UI
  -- always sends at least one — a CT that names nothing to revise is not
  -- the case this whole change exists for.
  select array_agg(nullif(value, '')::uuid)
    into v_chapter_ids
    from jsonb_array_elements_text(coalesce(p_entry -> 'chapter_ids', '[]'::jsonb)) as value;

  perform public.set_assessment_chapters(v_assessment_id, v_chapter_ids);

  return jsonb_build_object('assessment_id', v_assessment_id);
end;
$fn$;

revoke execute on function public.save_ct(uuid, jsonb) from public, anon;
grant execute on function public.save_ct(uuid, jsonb) to authenticated;
