-- 0007 — policies: profiles, codes, links (SPEC.md §1, §3.3)
--
-- Predicates route through the 0003 helpers, which are SECURITY DEFINER and so
-- do not re-enter the policy they are evaluated inside. `(select auth.uid())`
-- throughout, per the 0003 header: the subselect is hoisted to an InitPlan and
-- evaluated once per statement rather than once per row.

-- ----------------------------------------------------------- extra helper ---
--
-- Added here, not in 0003, because 0003 is already committed and an applied
-- migration is immutable.
--
-- §1 step 4 makes the tutor the approver of guardian links, so the approval
-- queue must show the guardian's name — but at that moment the link is still
-- `pending`, and every 0003 helper keys on `approved`. Without this the queue
-- renders a row the tutor cannot identify and is asked to approve blind.
-- Scoped to guardians holding a pending link to a student the caller already
-- tutors; it exposes nothing else.
create or replace function public.is_pending_guardian_for_my_student(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from public.guardian_links gl
      join public.tutor_links tl on tl.student_id = gl.student_id
     where gl.guardian_id = p_other
       and gl.status      = 'pending'
       and tl.tutor_id    = (select auth.uid())
       and tl.status      = 'approved'
  );
$fn$;

revoke execute on function public.is_pending_guardian_for_my_student(uuid)
  from public, anon;
grant execute on function public.is_pending_guardian_for_my_student(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------- profiles ---

-- Own row, anyone approved-linked in either direction, and the pending guardian
-- above.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or public.shares_link_with(id)
    or public.is_pending_guardian_for_my_student(id)
  );

-- Own row only. `role`, `id` and `email` are held immutable by the
-- profiles_lock_privileged_columns trigger of 0002 — without that trigger this
-- policy is a privilege-escalation path, since a student could rewrite their own
-- row to 'tutor' and then approve their own guardian links.
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No INSERT policy: rows are written only by handle_new_user() at signup.
-- No DELETE policy: profiles cascade from auth.users.

-- --------------------------------------------------------- tutor_allowlist ---

-- No policies at all, as the 0002 comment states. It decides who may hold a
-- tutor account, and it is read only by handle_new_user(), which is definer.
-- Reachable otherwise only by service_role.

-- ------------------------------------------------------------- link_codes ---

-- The owner reads their own live code to display it (§8, Settings: "family
-- code"). Nobody reads anyone else's, which is what keeps a six-character code
-- unguessable over PostgREST — a redeemer never selects from this table, they
-- hand a candidate to redeem_link_code() and get yes or no.
create policy link_codes_select_own on public.link_codes
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- No INSERT/UPDATE/DELETE policies: issue_link_code() and redeem_link_code()
-- are the only writers and both are definer.

-- ----------------------------------------------------- link_code_attempts ---

-- No policies. A throttle counter the throttled party can read tells them how
-- much budget is left; one they can delete is not a throttle at all.

-- ------------------------------------------------------------------ links ---

-- Both parties see the link, and the tutor sees links for students they tutor —
-- including `pending` ones, which is the approval queue of §1 step 4.
create policy guardian_links_select on public.guardian_links
  for select to authenticated
  using (
    guardian_id = (select auth.uid())
    or student_id = (select auth.uid())
    or public.is_tutor_of(student_id)
  );

-- §1 step 4: approval is the tutor's, and only the tutor's.
--
-- The student is deliberately NOT given update here, though §3.3's "students:
-- full CRUD where student_id = auth.uid()" read literally would allow it. A
-- student who can revoke their guardian's link can switch off the transparency
-- the product exists to provide (§1: "Full transparency — no filtering of bad
-- marks"). Revocation is a tutor action.
create policy guardian_links_update_tutor on public.guardian_links
  for update to authenticated
  using (public.is_tutor_of(student_id))
  with check (public.is_tutor_of(student_id));

-- No INSERT policy: redeem_link_code() creates the pending row.
-- No DELETE policy: links are revoked by status, never deleted, so the record of
-- who approved what survives.

create policy tutor_links_select on public.tutor_links
  for select to authenticated
  using (
    tutor_id = (select auth.uid())
    or student_id = (select auth.uid())
  );

-- Either party may end a tutoring relationship; neither may create one here
-- (redeem_link_code() does that, and §1 step 5 makes the student typing the code
-- the consent). Transitions are further constrained by the trigger below.
create policy tutor_links_update_either on public.tutor_links
  for update to authenticated
  using (
    tutor_id = (select auth.uid())
    or student_id = (select auth.uid())
  )
  with check (
    tutor_id = (select auth.uid())
    or student_id = (select auth.uid())
  );

-- --------------------------------------------------------------- integrity ---

-- A row-level policy is re-checked against the NEW row, so an UPDATE that also
-- rewrites the row's identity can satisfy the policy while pointing somewhere
-- else: a tutor of students A and B could move A's guardian link onto B, and a
-- student could repoint a tutor link at another student. The columns that decide
-- who a link is about are therefore immutable, in the same trigger idiom 0002
-- already uses for profiles.
-- One function per table, not one shared function switching on tg_table_name:
-- NEW/OLD are bound to the calling table's rowtype, so a shared body
-- referencing `new.tutor_id` fails to plan at all when invoked for
-- guardian_links (no such column) — AND short-circuiting on tg_table_name
-- does not save it, because the whole IF condition is planned as one SQL
-- expression against the bound rowtype before it is ever evaluated.
create or replace function public.guardian_links_lock_identity()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  if new.guardian_id is distinct from old.guardian_id
     or new.student_id is distinct from old.student_id
  then
    raise exception 'A link cannot be moved to a different person.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Revocation is one-way. Restoring a link goes back through a fresh code, so
  -- consent is re-given rather than silently reinstated.
  if old.status = 'revoked' and new.status is distinct from 'revoked' then
    raise exception 'Ask for a new code to restore this link.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

create or replace function public.tutor_links_lock_identity()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  if new.tutor_id is distinct from old.tutor_id
     or new.student_id is distinct from old.student_id
  then
    raise exception 'A link cannot be moved to a different person.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Revocation is one-way. Restoring a link goes back through a fresh code, so
  -- consent is re-given rather than silently reinstated.
  if old.status = 'revoked' and new.status is distinct from 'revoked' then
    raise exception 'Ask for a new code to restore this link.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

create trigger guardian_links_lock_identity
  before update on public.guardian_links
  for each row execute function public.guardian_links_lock_identity();

create trigger tutor_links_lock_identity
  before update on public.tutor_links
  for each row execute function public.tutor_links_lock_identity();

-- -------------------------------------------------------------- privileges ---
--
-- 0006 revoked everything from anon and left authenticated's Supabase defaults
-- in place. Narrow those to the verbs that have a policy above: a table with
-- INSERT granted but no INSERT policy fails with a policy error, which reads to
-- a caller as "this might succeed with different data". Without the grant it
-- fails as "not permitted", which is the truth.

revoke all on public.profiles, public.link_codes, public.link_code_attempts,
              public.guardian_links, public.tutor_links, public.tutor_allowlist
  from authenticated;

grant select, update on public.profiles        to authenticated;
grant select         on public.link_codes      to authenticated;
grant select, update on public.guardian_links  to authenticated;
grant select, update on public.tutor_links     to authenticated;
