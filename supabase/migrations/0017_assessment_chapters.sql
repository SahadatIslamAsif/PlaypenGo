-- 0017 — assessment_chapters: one assessment, many chapters (ARCHITECTURE.md §3.2, §5.3, §8)
--
-- Real-world correction from the tutor: a CT routinely spans 2-3 chapters in
-- one paper with ONE combined mark, never separate marks per chapter.
-- `assessments.chapter_id` (0013) is a single nullable uuid, so the app could
-- only ever record one of them and silently dropped the rest.
--
-- This is the same shape 0013 already used for the assessment-to-result
-- relationship inverted: there `results.assessment_id uuid not null unique`
-- enforces one result per assessment; here one assessment can have several
-- chapter links, so the uniqueness moves to the pair.

-- ------------------------------------------------------- assessment_chapters ---
--
-- The anti-drift idiom from 0005: `assessments` already carries
-- `unique (id, student_id)` (0013) and so does `chapters` (0005), so the
-- composite FK on each side means a link can never cross a student, whatever
-- a policy says.

create table public.assessment_chapters (
  id            uuid primary key default gen_random_uuid(),
  assessment_id uuid not null,
  chapter_id    uuid not null,
  student_id    uuid not null,
  created_at    timestamptz not null default now(),

  unique (assessment_id, chapter_id),

  -- Deleting the assessment takes its links with it — there is nothing left
  -- for a link to mean once its assessment is gone. Deleting a chapter takes
  -- only the LINK, not the assessment: 0013's chapter_id FK used
  -- `on delete set null` for exactly this reason ("a logged mark outlives the
  -- syllabus row it was filed under"). Cascading the link row here is that
  -- same outcome restated for a many-to-many shape — the chapter goes, the
  -- link goes, the assessment and any result on it stay untouched.
  foreign key (assessment_id, student_id)
    references public.assessments (id, student_id) on delete cascade,
  foreign key (chapter_id, student_id)
    references public.chapters (id, student_id) on delete cascade
);

create index assessment_chapters_chapter_idx on public.assessment_chapters (chapter_id);
create index assessment_chapters_student_idx on public.assessment_chapters (student_id);

-- ------------------------------------------------------------------ backfill ---

insert into public.assessment_chapters (assessment_id, chapter_id, student_id)
select id, chapter_id, student_id
  from public.assessments
 where chapter_id is not null;

drop index if exists public.assessments_chapter_idx;
alter table public.assessments drop column chapter_id;

-- ---------------------------------------------------------------------- RLS ---

alter table public.assessment_chapters enable row level security;

create policy assessment_chapters_select on public.assessment_chapters
  for select to authenticated
  using (public.can_read_student(student_id));

create policy assessment_chapters_insert on public.assessment_chapters
  for insert to authenticated
  with check (public.can_log_for(student_id));

-- No UPDATE policy: a link row has nothing updatable. Changing the set of
-- chapters an assessment covers is delete + insert, both below.
--
-- DELETE is gated on can_log_for(), the same predicate as INSERT, not
-- student-only the way 0013's assessments_delete/results_delete are. That
-- looks like it contradicts §3.3's "tutor... cannot delete student data," but
-- it does not: under the single-chapter_id column a tutor could already
-- retarget a chapter with `update assessments set chapter_id = ...`, which
-- assessments_update already permits via can_log_for(). Splitting that column
-- into rows makes retargeting an INSERT+DELETE pair instead of an UPDATE —
-- gating DELETE here on can_log_for() preserves the tutor's existing
-- capability exactly. Gating it student-only would be a silent regression: a
-- tutor could no longer correct a chapter they mis-picked seconds earlier
-- during a session. §3.3's delete restriction protects marks and history; a
-- link row is neither.
create policy assessment_chapters_delete on public.assessment_chapters
  for delete to authenticated
  using (public.can_log_for(student_id));

revoke all on public.assessment_chapters from authenticated;

grant select, insert, delete on public.assessment_chapters to authenticated;

-- --------------------------------------------------------- set_assessment_chapters ---
--
-- Its reason to exist is atomicity, the same argument 0014's log_manual_result
-- makes for itself: replacing a set of chapter links is a DELETE followed by
-- an INSERT, and two client round trips can leave an assessment with no
-- chapters at all if the first succeeds and the second never arrives.
-- SECURITY INVOKER, same as log_manual_result — the policies above are what
-- authorize every statement inside it, not this function.

create or replace function public.set_assessment_chapters(
  p_assessment uuid,
  p_chapters   uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_student_id uuid;
begin
  select student_id into v_student_id
    from public.assessments
   where id = p_assessment;

  if v_student_id is null then
    raise exception 'That assessment could not be found.'
      using errcode = 'no_data_found';
  end if;

  delete from public.assessment_chapters where assessment_id = p_assessment;

  insert into public.assessment_chapters (assessment_id, chapter_id, student_id)
  select p_assessment, c, v_student_id
    from unnest(coalesce(p_chapters, '{}'::uuid[])) as c;
end;
$fn$;

revoke execute on function public.set_assessment_chapters(uuid, uuid[]) from public, anon;
grant execute on function public.set_assessment_chapters(uuid, uuid[]) to authenticated;

-- ------------------------------------------------------------ log_manual_result ---
--
-- Same function, same signature, replacing 0014's body: the single scalar
-- `chapter_id` field the form used to send becomes a `chapter_ids` array, and
-- linking them is one more insert inside the same atomic function. Everything
-- else — the two entry shapes, the atomicity argument, the "no second
-- authorization surface" note — is unchanged from 0014's header, which still
-- applies and is not repeated here.

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
       'occurred', coalesce(v_occurred, current_date), (select auth.uid()))
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
