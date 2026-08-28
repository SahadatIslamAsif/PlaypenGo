-- 0019 — the routine is the student's too (SPEC.md §3.3)
--
-- 0018 closed the tutor's table-level writes. This closes the two that were
-- never table-level: `commit_routine_grid()` and `update_routine_period()`
-- are SECURITY DEFINER, so RLS never sees them and the guard inside each
-- function body is the whole authorization story. Narrowing the policies in
-- 0018 did nothing to these.
--
-- 0010's header argued its tutor storage grant hard, and the argument was
-- sound for the spec it was written against: "0011 already lets a tutor
-- commit a routine; the photo has to reach storage from the browser that took
-- it." Both halves of that are now false — the tutor does not commit a
-- routine, so no photo of theirs needs to reach storage. §3.3's "No INSERT
-- anywhere" is unqualified, and a standing storage INSERT is an INSERT.
--
-- `commit_syllabus_tree()` (0009) is deliberately NOT narrowed alongside
-- these, and the asymmetry is the spec's, not an oversight. §4.2 names the
-- tutor outright — "tutor or student uploads PDF" — so the syllabus seeder is
-- a sanctioned exception with a written reason: it runs once a semester, on a
-- document the school issued, and it is the single biggest reduction in setup
-- effort for a fourteen-subject tree. Nothing in §5.1 says who photographs
-- the routine, so the routine falls to §3.3's default and the student keeps
-- it. If a future revision names the tutor there too, this migration is the
-- one to revert.
--
-- Both function bodies below are 0011 verbatim apart from their guard, which
-- becomes 0018's is_owner_student(). Reproduced in full because Postgres has
-- no way to replace part of a function.

-- ------------------------------------------------------- storage: routines ---
--
-- Upload returns to the student alone, matching the update and delete
-- policies 0010 already kept with them. The select policy is untouched: a
-- guardian and a tutor still see the photo the grid was typed from.

drop policy if exists routines_storage_insert on storage.objects;
create policy routines_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'routines'
    and public.storage_owner(name) = (select auth.uid())
    and public.my_role() = 'student'
  );

-- ------------------------------------------------------ commit_routine_grid ---

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

  -- The one authorization check every write below relies on. Still a definer
  -- function rather than a table policy — the reason has changed, not the
  -- shape. 0011 wrote it to stop a tutor's routine reach from becoming a
  -- standing grant on every linked student's timetable; §3.3's revision
  -- removed the reach altogether, so what it now confines is the student's
  -- own write to exactly this step.
  if not public.is_owner_student(p_student) then
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

-- ---------------------------------------------------- update_routine_period ---

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

  if not public.is_owner_student(v_student) then
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
