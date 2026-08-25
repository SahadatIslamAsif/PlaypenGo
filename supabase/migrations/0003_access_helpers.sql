-- 0003 — access helpers (SPEC.md §3.3)
--
-- Every policy predicate in 0008 routes through these. Two reasons:
--
--   1. Recursion. A policy on `profiles` that reads `profiles` re-enters its own
--      policy. SECURITY DEFINER breaks the cycle by running the lookup as the
--      function owner, outside RLS.
--   2. Planning. An inlined EXISTS repeated across forty policies is forty
--      subqueries the planner re-derives. One STABLE function is cached per
--      statement.
--
-- `set search_path = ''` on every one: a definer function with a mutable search
-- path is a privilege-escalation primitive. Everything is schema-qualified.
--
-- `(select auth.uid())` rather than bare `auth.uid()` is deliberate throughout —
-- the subselect form is hoisted to an InitPlan and evaluated once per statement
-- instead of once per row.

-- Caller's role, without recursing through the profiles policy.
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = (select auth.uid());
$$;

-- An approved guardian link, caller -> student. Pending links grant nothing:
-- §1 step 4 gates visibility on tutor approval.
create or replace function public.is_guardian_of(p_student uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.guardian_links gl
     where gl.guardian_id = (select auth.uid())
       and gl.student_id  = p_student
       and gl.status      = 'approved'
  );
$$;

create or replace function public.is_tutor_of(p_student uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.tutor_links tl
     where tl.tutor_id   = (select auth.uid())
       and tl.student_id = p_student
       and tl.status     = 'approved'
  );
$$;

-- The read predicate for every student-scoped table: the student themselves,
-- their approved guardian, or an approved tutor.
create or replace function public.can_read_student(p_student uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_student = (select auth.uid())
      or public.is_guardian_of(p_student)
      or public.is_tutor_of(p_student);
$$;

-- The write predicate for assessments / results / result_images only. §3.3 lets
-- a tutor log papers during a session; it never lets a guardian write anything,
-- and it never appears on the subject tree or the routine.
create or replace function public.can_log_for(p_student uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_student = (select auth.uid())
      or public.is_tutor_of(p_student);
$$;

-- Whether the caller may see another person's profile row: their own student,
-- their own guardian, their own tutor, or the other adult attached to a student
-- they are attached to (a tutor sees the guardian's name on the approval queue).
create or replace function public.shares_link_with(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.guardian_links gl
     where gl.status = 'approved'
       and (   (gl.guardian_id = (select auth.uid()) and gl.student_id  = p_other)
            or (gl.student_id  = (select auth.uid()) and gl.guardian_id = p_other))
  )
  or exists (
    select 1
      from public.tutor_links tl
     where tl.status = 'approved'
       and (   (tl.tutor_id   = (select auth.uid()) and tl.student_id = p_other)
            or (tl.student_id = (select auth.uid()) and tl.tutor_id   = p_other))
  )
  or exists (
    select 1
      from public.tutor_links tl
      join public.guardian_links gl on gl.student_id = tl.student_id
     where tl.status = 'approved'
       and gl.status = 'approved'
       and (   (tl.tutor_id     = (select auth.uid()) and gl.guardian_id = p_other)
            or (gl.guardian_id  = (select auth.uid()) and tl.tutor_id    = p_other))
  );
$$;

-- Storage path -> owning student. Objects are laid out as
-- `<student_id>/<entity_id>/<page>.<ext>`. A malformed path must evaluate to a
-- denied policy, not a failed cast that aborts the statement.
create or replace function public.storage_owner(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return (storage.foldername(p_name))[1]::uuid;
exception when others then
  return null;
end;
$$;

-- Functions default to EXECUTE for PUBLIC, which would include `anon`. Nothing
-- in Phase 1 is reachable without a session.
revoke execute on function
    public.my_role(),
    public.is_guardian_of(uuid),
    public.is_tutor_of(uuid),
    public.can_read_student(uuid),
    public.can_log_for(uuid),
    public.shares_link_with(uuid),
    public.storage_owner(text)
  from public, anon;

grant execute on function
    public.my_role(),
    public.is_guardian_of(uuid),
    public.is_tutor_of(uuid),
    public.can_read_student(uuid),
    public.can_log_for(uuid),
    public.shares_link_with(uuid),
    public.storage_owner(text)
  to authenticated, service_role;
