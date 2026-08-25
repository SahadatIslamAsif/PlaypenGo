-- 0002 — identity, link codes, links (SPEC.md §1, §3.2)
--
-- DEVIATIONS from §3.2, deliberate:
--   * `family_codes` is generalised to `link_codes`. §1 step 5 requires the tutor
--     link to work by the same code mechanism, but §3.2's family_codes is
--     hardcoded to a student_id. One table, one issue RPC, one redeem RPC, one
--     expiry rule, two kinds.
--   * `tutor_allowlist` is new. Without it `role` is chosen by the client at
--     signup, so anyone could self-declare as tutor and then approve their own
--     guardian links (§1 step 4).

-- ---------------------------------------------------------------- profiles ---

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  role          text not null check (role in ('student', 'guardian', 'tutor')),
  full_name     text not null,
  email         text not null,
  class_level   int check (class_level between 1 and 12),
  section       text,
  school        text not null default 'Playpen',
  session_label text,
  timezone      text not null default 'Asia/Dhaka',
  created_at    timestamptz not null default now(),

  -- §1 step 1: a student chooses class level and section at signup.
  constraint profiles_student_needs_class
    check (role <> 'student' or class_level is not null)
);

create index profiles_role_idx on public.profiles (role);

comment on table public.profiles is
  'One row per auth.users row, written only by handle_new_user(). Role is immutable after signup.';

-- --------------------------------------------------------- tutor allowlist ---

-- RLS on, zero policies: reachable only by service_role and the definer trigger
-- below. Nothing in the client can read or extend it.
create table public.tutor_allowlist (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);

-- §1: the tutor is the app owner and there is exactly one in v1. Change this
-- address, or insert more rows, to authorise another tutor account.
insert into public.tutor_allowlist (email, note)
values ('tutor.a@example.test', 'App owner — the single tutor in v1 (SPEC.md §1).');

-- ------------------------------------------------------------- link codes ---

create table public.link_codes (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('guardian', 'tutor')),
  expires_at timestamptz not null,
  used_at    timestamptz,
  used_by    uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),

  -- §1 step 2: six characters, ambiguity-free alphabet, no O/0/I/1.
  constraint link_codes_shape
    check (code ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$')
);

-- One live code per owner per kind. Re-issuing revokes the previous code rather
-- than leaving two valid codes in circulation.
create unique index link_codes_one_live_per_owner
  on public.link_codes (owner_id, kind)
  where used_at is null and revoked_at is null;

-- Throttling store for redeem_link_code(). A guessable six-character code that
-- gates a child's grades must not be brute-forceable over PostgREST.
create table public.link_code_attempts (
  id             uuid primary key default gen_random_uuid(),
  actor_id       uuid not null references public.profiles (id) on delete cascade,
  attempted_code text,
  succeeded      bool not null default false,
  attempted_at   timestamptz not null default now()
);

create index link_code_attempts_actor_idx
  on public.link_code_attempts (actor_id, attempted_at desc);

-- ------------------------------------------------------------------ links ---

create table public.guardian_links (
  id          uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references public.profiles (id) on delete cascade,
  student_id  uuid not null references public.profiles (id) on delete cascade,
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'revoked')),
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (guardian_id, student_id),
  check (guardian_id <> student_id)
);

create index guardian_links_student_idx on public.guardian_links (student_id, status);
create index guardian_links_guardian_idx on public.guardian_links (guardian_id, status);

create table public.tutor_links (
  id          uuid primary key default gen_random_uuid(),
  tutor_id    uuid not null references public.profiles (id) on delete cascade,
  student_id  uuid not null references public.profiles (id) on delete cascade,
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'revoked')),
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (tutor_id, student_id),
  check (tutor_id <> student_id)
);

create index tutor_links_student_idx on public.tutor_links (student_id, status);
create index tutor_links_tutor_idx on public.tutor_links (tutor_id, status);

-- --------------------------------------------------------------- triggers ---

-- Signup. Raises rather than silently defaulting: a profile with the wrong role
-- is worse than a failed signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_role        text := coalesce(new.raw_user_meta_data ->> 'role', '');
  v_full_name   text := nullif(btrim(new.raw_user_meta_data ->> 'full_name'), '');
  v_section     text := nullif(btrim(new.raw_user_meta_data ->> 'section'), '');
  v_session     text := nullif(btrim(new.raw_user_meta_data ->> 'session_label'), '');
  v_class_level int;
begin
  if v_role not in ('student', 'guardian', 'tutor') then
    raise exception 'Choose a role of student, guardian, or tutor to sign up.'
      using errcode = 'check_violation';
  end if;

  if v_full_name is null then
    raise exception 'Enter your full name to sign up.'
      using errcode = 'check_violation';
  end if;

  if v_role = 'tutor'
     and not exists (
       select 1 from public.tutor_allowlist a
        where lower(a.email) = lower(new.email)
     )
  then
    raise exception 'This email is not approved for a tutor account.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_role = 'student' then
    begin
      v_class_level := (new.raw_user_meta_data ->> 'class_level')::int;
    exception when others then
      v_class_level := null;
    end;

    if v_class_level is null then
      raise exception 'Choose your class level to sign up.'
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.profiles
    (id, role, full_name, email, class_level, section, session_label)
  values
    (new.id, v_role, v_full_name, new.email, v_class_level, v_section, v_session);

  return new;
end;
$fn$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role is immutable. Without this the self-update policy on profiles is a
-- privilege-escalation path: a student edits their own row to 'tutor' and can
-- then approve guardian links. SECURITY INVOKER on purpose — the check reads
-- current_user, which a definer function would report as the table owner.
create or replace function public.profiles_lock_privileged_columns()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Role cannot be changed.' using errcode = 'insufficient_privilege';
  end if;

  if new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'Sign-in details cannot be changed here.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$fn$;

create trigger profiles_lock_privileged_columns
  before update on public.profiles
  for each row execute function public.profiles_lock_privileged_columns();

-- Approval is stamped server-side so the approver cannot be forged by whoever
-- issues the UPDATE.
create or replace function public.stamp_link_approval()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.status is distinct from old.status then
    if new.status = 'approved' then
      new.approved_by := (select auth.uid());
      new.approved_at := now();
    else
      new.approved_by := null;
      new.approved_at := null;
    end if;
  end if;
  return new;
end;
$fn$;

create trigger stamp_link_approval
  before update on public.guardian_links
  for each row execute function public.stamp_link_approval();

create trigger stamp_link_approval
  before update on public.tutor_links
  for each row execute function public.stamp_link_approval();
