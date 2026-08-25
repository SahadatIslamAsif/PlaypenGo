-- 0004 — link code RPCs (SPEC.md §1 steps 2-5)
--
-- link_codes has no INSERT policy and no SELECT policy for anyone but the owner.
-- Codes are issued and redeemed only through these two definer functions, so a
-- code can never be enumerated over PostgREST — the redeemer never queries the
-- table, they hand a candidate string to a function that answers yes or no.

-- Issue (or re-issue) the caller's link code.
--   student -> a 'guardian' code, the family code of §1 step 2
--   tutor   -> a 'tutor' code, which a student redeems (§1 step 5)
create or replace function public.issue_link_code()
returns public.link_codes
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  -- 32 characters, no O/0/I/1 (§1 step 2). Exactly 32 matters: 256 is divisible
  -- by 32, so the byte -> character mapping below has no modulo bias.
  c_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_uid      uuid := (select auth.uid());
  v_role     text;
  v_kind     text;
  v_code     text;
  v_row      public.link_codes;
  v_attempt  int := 0;
  i          int;
begin
  if v_uid is null then
    raise exception 'Sign in to create a code.' using errcode = 'insufficient_privilege';
  end if;

  select p.role into v_role from public.profiles p where p.id = v_uid;

  v_kind := case v_role
              when 'student' then 'guardian'
              when 'tutor'   then 'tutor'
            end;

  if v_kind is null then
    raise exception 'Only students and tutors can create a link code.'
      using errcode = 'insufficient_privilege';
  end if;

  -- One live code per owner. Re-issuing retires the old one.
  update public.link_codes
     set revoked_at = now()
   where owner_id   = v_uid
     and kind       = v_kind
     and used_at    is null
     and revoked_at is null;

  loop
    v_attempt := v_attempt + 1;
    v_code := '';

    for i in 1..6 loop
      v_code := v_code
        || substr(c_alphabet,
                  1 + (get_byte(extensions.gen_random_bytes(1), 0) % 32),
                  1);
    end loop;

    begin
      insert into public.link_codes (code, owner_id, kind, expires_at)
      values (v_code, v_uid, v_kind, now() + interval '7 days')  -- §1 step 2: 7 days
      returning * into v_row;
      exit;
    exception when unique_violation then
      if v_attempt >= 20 then
        raise;
      end if;
    end;
  end loop;

  return v_row;
end;
$fn$;

-- Redeem someone else's code. Single use, 7-day expiry, throttled.
--
-- Returns {kind, counterpart_name, status} so the confirmation screen can say
-- who was linked and whether it still needs approval.
create or replace function public.redeem_link_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid     uuid := (select auth.uid());
  v_role    text;
  v_norm    text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_row     public.link_codes;
  v_fails   int;
  v_status  text;
  v_name    text;
begin
  if v_uid is null then
    raise exception 'Sign in to use a code.' using errcode = 'insufficient_privilege';
  end if;

  select p.role into v_role from public.profiles p where p.id = v_uid;

  select count(*) into v_fails
    from public.link_code_attempts a
   where a.actor_id     = v_uid
     and a.succeeded    = false
     and a.attempted_at > now() - interval '1 hour';

  if v_fails >= 10 then
    raise exception 'Too many incorrect codes. Try again in an hour.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_row
    from public.link_codes lc
   where lc.code       = v_norm
     and lc.used_at    is null
     and lc.revoked_at is null
     and lc.expires_at > now();

  if not found then
    insert into public.link_code_attempts (actor_id, attempted_code, succeeded)
    values (v_uid, v_norm, false);
    raise exception 'That code is not valid. Check it and try again.'
      using errcode = 'no_data_found';
  end if;

  if v_row.owner_id = v_uid then
    insert into public.link_code_attempts (actor_id, attempted_code, succeeded)
    values (v_uid, v_norm, false);
    raise exception 'That is your own code.' using errcode = 'check_violation';
  end if;

  if v_row.kind = 'guardian' then
    if v_role <> 'guardian' then
      insert into public.link_code_attempts (actor_id, attempted_code, succeeded)
      values (v_uid, v_norm, false);
      raise exception 'Only a guardian account can use a family code.'
        using errcode = 'insufficient_privilege';
    end if;

    -- §1 step 4: the link starts pending and shows the guardian nothing until a
    -- tutor approves it.
    insert into public.guardian_links as gl (guardian_id, student_id, status)
    values (v_uid, v_row.owner_id, 'pending')
        on conflict (guardian_id, student_id) do update
       set status = 'pending', approved_by = null, approved_at = null
     where gl.status = 'revoked'
    returning gl.status into v_status;

  else
    if v_role <> 'student' then
      insert into public.link_code_attempts (actor_id, attempted_code, succeeded)
      values (v_uid, v_norm, false);
      raise exception 'Only a student account can use a tutor code.'
        using errcode = 'insufficient_privilege';
    end if;

    -- The student typing the tutor's code IS the consent, so there is no third
    -- party left to approve it — unlike a guardian link, which the tutor gates.
    insert into public.tutor_links as tl (tutor_id, student_id, status)
    values (v_row.owner_id, v_uid, 'approved')
        on conflict (tutor_id, student_id) do update
       set status = 'approved'
     where tl.status <> 'approved'
    returning tl.status into v_status;
  end if;

  -- An already-live link returns no row from the conflict clause; read it back.
  if v_status is null then
    if v_row.kind = 'guardian' then
      select gl.status into v_status
        from public.guardian_links gl
       where gl.guardian_id = v_uid and gl.student_id = v_row.owner_id;
    else
      select tl.status into v_status
        from public.tutor_links tl
       where tl.tutor_id = v_row.owner_id and tl.student_id = v_uid;
    end if;
  end if;

  update public.link_codes
     set used_at = now(), used_by = v_uid
   where id = v_row.id;

  insert into public.link_code_attempts (actor_id, attempted_code, succeeded)
  values (v_uid, v_norm, true);

  select p.full_name into v_name from public.profiles p where p.id = v_row.owner_id;

  return jsonb_build_object(
    'kind',             v_row.kind,
    'counterpart_name', v_name,
    'status',           coalesce(v_status, 'pending')
  );
end;
$fn$;

revoke execute on function public.issue_link_code(), public.redeem_link_code(text)
  from public, anon;

grant execute on function public.issue_link_code(), public.redeem_link_code(text)
  to authenticated;
