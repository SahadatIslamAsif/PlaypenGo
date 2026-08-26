-- 0011 — commit_routine_grid() and update_routine_period(): the tutor's write
-- path onto the routine (SPEC.md §3.3, §5.1, §8)
--
-- Same shape, and the same reasoning, as 0009. 0010 left writes on
-- routines/routine_periods student-only at the table level, because §3.3 grants
-- tutors nothing beyond assessments/results/result_images and a policy wide
-- enough to let a tutor type one student's routine would let them rewrite every
-- linked student's. These are the scoped paths instead: SECURITY DEFINER, so
-- they are not subject to those policies, each doing its own authorization
-- check first — `p_student = auth.uid() OR is_tutor_of(p_student)`.
--
-- Two functions rather than one because §8's routine screen has two shapes. A
-- routine is SET UP as a whole grid (and, from Phase 5, reviewed as a whole
-- grid after §5.1's parse fills it), which wants one atomic commit. A routine
-- already in force gets corrected one cell at a time — a subject moves period,
-- a teacher is spelled properly — and re-committing forty cells to change one
-- would be both wasteful and a needless chance to clobber a concurrent edit.

-- ------------------------------------------------------- alias capture ---
--
-- §5.1's post-parse rule: "When the user picks, write the pair into
-- subject_aliases so the same short form resolves automatically next time —
-- including when it appears on an exam paper header."
--
-- It lives here, inside the write path, for two reasons. subject_aliases_insert
-- in 0008 requires `student_id = auth.uid()`, so a tutor correcting a cell
-- cannot record the alias through the table policy at all. And the alias is a
-- side-effect of the correction, not a separate user action — if the correction
-- commits, the alias must commit with it.
--
-- Deliberately NOT granted to `authenticated`. Its callers below are definer
-- functions running as the owner, so they reach it; a client cannot. That keeps
-- alias writing reachable only through an actual correction.
create or replace function public.capture_routine_alias(
  p_student uuid,
  p_subject uuid,
  p_raw     text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_alias   text := nullif(btrim(p_raw), '');
  v_display text;
begin
  if p_subject is null or v_alias is null then
    return false;
  end if;

  select ss.display_name into v_display
    from public.student_subjects ss
   where ss.id = p_subject and ss.student_id = p_student;

  -- Not an alias, just the subject's own name typed out.
  if v_display is null or lower(v_alias) = lower(v_display) then
    return false;
  end if;

  -- A correction wins over whatever the short form used to mean. If the student
  -- decides 'Phy' is Physics after all, that is the mapping the next parse gets.
  insert into public.subject_aliases
    (alias_text, student_subject_id, source, student_id)
  values (v_alias, p_subject, 'routine', p_student)
  on conflict (student_id, lower(alias_text)) where student_id is not null
  do update set student_subject_id = excluded.student_subject_id,
                source             = 'routine';

  return true;
end;
$fn$;

-- --------------------------------------------------- commit_routine_grid ---
--
-- The whole-grid path. Idempotent by construction: the routine row is written
-- at an id the client chose, and every period upserts against
-- `unique (routine_id, day_of_week, period_no)` from 0010, so committing the
-- same grid twice is a no-op rather than a duplicate week.
--
-- The grid is authoritative — a period that has left the payload is deleted,
-- which is how removing a period column from the editor actually takes effect.
create or replace function public.commit_routine_grid(
  p_student uuid,
  p_grid    jsonb,
  p_session text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid             uuid := (select auth.uid());
  v_routine_id      uuid;
  v_image_path      text := nullif(btrim(p_grid ->> 'image_path'), '');
  v_period          jsonb;
  v_day             int;
  v_period_no       int;
  v_raw             text;
  v_subject_id      uuid;
  v_periods_written int := 0;
  v_aliases_written int := 0;
  v_removed         int := 0;
begin
  if v_uid is null then
    raise exception 'Sign in to save a routine.' using errcode = 'insufficient_privilege';
  end if;

  -- The one authorization check every write below relies on. Not a table
  -- policy: a definer function so a tutor's routine reach stops exactly here,
  -- instead of becoming a standing INSERT/UPDATE grant on every linked
  -- student's timetable.
  if not (p_student = v_uid or public.is_tutor_of(p_student)) then
    raise exception 'You are not authorised to edit this student''s routine.'
      using errcode = 'insufficient_privilege';
  end if;

  if nullif(btrim(p_session), '') is null then
    raise exception 'A session label is required.' using errcode = 'check_violation';
  end if;

  if jsonb_typeof(p_grid -> 'periods') is distinct from 'array' then
    raise exception 'The routine must include a periods array.'
      using errcode = 'check_violation';
  end if;

  v_routine_id := nullif(btrim(p_grid ->> 'routine_id'), '')::uuid;
  if v_routine_id is null then
    v_routine_id := gen_random_uuid();
  end if;

  -- The client picks the routine id so it can name the storage path before the
  -- row exists. That means it could also name someone else's row, and the
  -- caller may legitimately be a tutor with several students. Check the owner
  -- explicitly rather than letting an ON CONFLICT silently rewrite it.
  if exists (
    select 1 from public.routines r
     where r.id = v_routine_id and r.student_id <> p_student
  ) then
    raise exception 'That routine belongs to another student.'
      using errcode = 'insufficient_privilege';
  end if;

  -- §3.2's is_active: the previous routine is retired, never deleted, so the
  -- periods an earlier assessment was predicted against stay readable.
  update public.routines
     set is_active = false
   where student_id    = p_student
     and session_label = p_session
     and is_active
     and id <> v_routine_id;

  insert into public.routines (id, student_id, session_label, image_path, is_active)
  values (v_routine_id, p_student, p_session, v_image_path, true)
  on conflict (id) do update
     -- A commit with no photo must not wipe the photo an earlier commit stored.
     set image_path    = coalesce(excluded.image_path, public.routines.image_path),
         session_label = excluded.session_label,
         is_active     = true;

  for v_period in select * from jsonb_array_elements(p_grid -> 'periods')
  loop
    v_day       := (v_period ->> 'day_of_week')::int;
    v_period_no := (v_period ->> 'period_no')::int;

    if v_day is null or v_day < 0 or v_day > 4 then
      raise exception 'Routine days run Sunday to Thursday only.'
        using errcode = 'check_violation';
    end if;

    if v_period_no is null or v_period_no < 1 or v_period_no > 12 then
      raise exception 'Period numbers run from 1 to 12.' using errcode = 'check_violation';
    end if;

    v_raw        := nullif(btrim(v_period ->> 'raw_text'), '');
    v_subject_id := nullif(btrim(v_period ->> 'student_subject_id'), '')::uuid;

    -- 0010's composite FK already makes a cross-student subject impossible;
    -- catching it here turns a raw 23503 into a sentence a person can read.
    if v_subject_id is not null and not exists (
      select 1 from public.student_subjects ss
       where ss.id = v_subject_id and ss.student_id = p_student
    ) then
      raise exception 'That subject does not belong to this student.'
        using errcode = 'check_violation';
    end if;

    insert into public.routine_periods
      (routine_id, student_id, day_of_week, period_no, start_time, end_time,
       raw_text, teacher_raw, student_subject_id, is_academic)
    values (
      v_routine_id, p_student, v_day, v_period_no,
      nullif(btrim(v_period ->> 'start_time'), '')::time,
      nullif(btrim(v_period ->> 'end_time'), '')::time,
      v_raw,
      nullif(btrim(v_period ->> 'teacher_raw'), ''),
      v_subject_id,
      coalesce((v_period ->> 'is_academic')::bool, true)
    )
    on conflict (routine_id, day_of_week, period_no) do update
       set start_time         = excluded.start_time,
           end_time           = excluded.end_time,
           raw_text           = excluded.raw_text,
           teacher_raw        = excluded.teacher_raw,
           student_subject_id = excluded.student_subject_id,
           is_academic        = excluded.is_academic;

    v_periods_written := v_periods_written + 1;

    if public.capture_routine_alias(p_student, v_subject_id, v_raw) then
      v_aliases_written := v_aliases_written + 1;
    end if;
  end loop;

  -- The submitted grid is the routine. Anything left over is a period the
  -- editor removed.
  delete from public.routine_periods rp
   where rp.routine_id = v_routine_id
     and not exists (
       select 1 from jsonb_array_elements(p_grid -> 'periods') e
        where (e ->> 'day_of_week')::int = rp.day_of_week
          and (e ->> 'period_no')::int   = rp.period_no
     );
  get diagnostics v_removed = row_count;

  return jsonb_build_object(
    'routine_id',       v_routine_id,
    'periods_committed', v_periods_written,
    'periods_removed',   v_removed,
    'aliases_captured',  v_aliases_written
  );
end;
$fn$;

-- ------------------------------------------------- update_routine_period ---
--
-- The single-cell path, for a routine already in force. `p_patch` is read key
-- by key with `?` rather than merged wholesale, so an absent key leaves the
-- column alone and an explicit null clears it — the editor needs both, since
-- "I have not touched the teacher" and "there is no teacher" are different
-- statements about the same cell.
create or replace function public.update_routine_period(
  p_period uuid,
  p_patch  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid        uuid := (select auth.uid());
  v_student    uuid;
  v_raw        text;
  v_subject_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in to edit a routine.' using errcode = 'insufficient_privilege';
  end if;

  if jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'The edit must be an object.' using errcode = 'check_violation';
  end if;

  select rp.student_id into v_student
    from public.routine_periods rp
   where rp.id = p_period;

  if v_student is null then
    raise exception 'That period is no longer in the routine.' using errcode = 'no_data_found';
  end if;

  if not (v_student = v_uid or public.is_tutor_of(v_student)) then
    raise exception 'You are not authorised to edit this student''s routine.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_patch ? 'student_subject_id' then
    v_subject_id := nullif(btrim(p_patch ->> 'student_subject_id'), '')::uuid;
    if v_subject_id is not null and not exists (
      select 1 from public.student_subjects ss
       where ss.id = v_subject_id and ss.student_id = v_student
    ) then
      raise exception 'That subject does not belong to this student.'
        using errcode = 'check_violation';
    end if;
  end if;

  update public.routine_periods rp
     set raw_text = case when p_patch ? 'raw_text'
                         then nullif(btrim(p_patch ->> 'raw_text'), '')
                         else rp.raw_text end,
         teacher_raw = case when p_patch ? 'teacher_raw'
                            then nullif(btrim(p_patch ->> 'teacher_raw'), '')
                            else rp.teacher_raw end,
         student_subject_id = case when p_patch ? 'student_subject_id'
                                   then nullif(btrim(p_patch ->> 'student_subject_id'), '')::uuid
                                   else rp.student_subject_id end,
         is_academic = case when p_patch ? 'is_academic'
                            then coalesce((p_patch ->> 'is_academic')::bool, true)
                            else rp.is_academic end,
         start_time = case when p_patch ? 'start_time'
                           then nullif(btrim(p_patch ->> 'start_time'), '')::time
                           else rp.start_time end,
         end_time = case when p_patch ? 'end_time'
                         then nullif(btrim(p_patch ->> 'end_time'), '')::time
                         else rp.end_time end
   where rp.id = p_period
  returning rp.raw_text, rp.student_subject_id into v_raw, v_subject_id;

  return jsonb_build_object(
    'period_id',      p_period,
    'alias_captured', public.capture_routine_alias(v_student, v_subject_id, v_raw)
  );
end;
$fn$;

-- ------------------------------------------------------------- privileges ---
--
-- Same posture as issue_link_code()/redeem_link_code()/commit_syllabus_tree():
-- authenticated only, nothing for anon. capture_routine_alias() is stricter
-- still — it is reached only from the two functions above, never from a client.

revoke execute on function public.capture_routine_alias(uuid, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.commit_routine_grid(uuid, jsonb, text)
  from public, anon;
revoke execute on function public.update_routine_period(uuid, jsonb)
  from public, anon;

grant execute on function public.commit_routine_grid(uuid, jsonb, text) to authenticated;
grant execute on function public.update_routine_period(uuid, jsonb)     to authenticated;
