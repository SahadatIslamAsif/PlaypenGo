-- 0018 — the tutor stops writing (ARCHITECTURE.md §1, §3.3)
--
-- 0013's header called `can_log_for()` "THE ONLY PLACE A TUTOR WRITES THROUGH
-- AN ORDINARY POLICY", and that was right for the spec it was written against.
-- §3.3 has since been revised. The tutor no longer logs papers during a
-- session; the student does, from their own phone. What the tutor keeps is:
--
--     SELECT on all linked students, plus UPDATE on `results` only.
--
-- The distinction the revision turns on is that correcting a wrong mark
-- beside the student is a different act from creating one. A tutor who can
-- only correct cannot invent a result, cannot invent the assessment under it,
-- and cannot quietly become the person the record comes from. That is worth
-- more than the convenience the old grant bought.
--
-- `can_log_for()` cannot simply be narrowed in place, because the two things
-- it currently expresses are no longer the same predicate. It splits:
--
--   * `is_owner_student()`  — the student, acting on their own data. Every
--     INSERT/UPDATE/DELETE on assessments, results and assessment_chapters.
--   * `can_correct_result()` — the student or their approved tutor. Exactly
--     one policy uses it: results_update.
--
-- Naming them for what they permit rather than for who calls them is the
-- point of the split. `can_log_for` read as "may log", and the tutor may not.

-- --------------------------------------------------------- is_owner_student ---
--
-- The student themselves, and only while they are actually a student. The
-- role test is not redundant with the uid test: a tutor or guardian passing
-- their own id would otherwise satisfy `p_student = auth.uid()` and write
-- rows owned by nobody's student. 0012 makes the same argument for the
-- subject tree and the routine, inline; here it earns a name because five
-- policies need it.
create or replace function public.is_owner_student(p_student uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_student = (select auth.uid())
     and public.my_role() = 'student';
$$;

-- ------------------------------------------------------ can_correct_result ---
--
-- §3.3's sole tutor write. The student, or an approved tutor of that student.
-- A guardian is absent by construction, as everywhere else.
create or replace function public.can_correct_result(p_student uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_owner_student(p_student)
      or public.is_tutor_of(p_student);
$$;

revoke execute on function
    public.is_owner_student(uuid),
    public.can_correct_result(uuid)
  from public, anon;

grant execute on function
    public.is_owner_student(uuid),
    public.can_correct_result(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------- policies ---
--
-- Dropped and recreated rather than altered: a policy's USING/WITH CHECK
-- cannot be swapped in place, and 0012 already established that re-stating
-- the whole policy is how this repo narrows one.

-- assessments — creating and rescheduling a CT is the student's act.
drop policy if exists assessments_insert on public.assessments;
create policy assessments_insert on public.assessments
  for insert to authenticated
  with check (public.is_owner_student(student_id));

drop policy if exists assessments_update on public.assessments;
create policy assessments_update on public.assessments
  for update to authenticated
  using (public.is_owner_student(student_id))
  with check (public.is_owner_student(student_id));

-- results — INSERT narrows to the student; UPDATE is the one door left open.
drop policy if exists results_insert on public.results;
create policy results_insert on public.results
  for insert to authenticated
  with check (public.is_owner_student(student_id));

-- §3.3, in full: "plus UPDATE on `results` only - correcting a wrong mark
-- beside the student is a different act from creating one." The USING side
-- admits the tutor to the rows they may correct; the WITH CHECK side stops
-- them moving a row onto a student they do not tutor.
drop policy if exists results_update on public.results;
create policy results_update on public.results
  for update to authenticated
  using (public.can_correct_result(student_id))
  with check (public.can_correct_result(student_id));

-- assessment_chapters — 0017 argued its tutor DELETE was safe because it
-- "preserves the tutor's existing" reach. That reach is gone, and with it the
-- argument. Both verbs become the student's.
drop policy if exists assessment_chapters_insert on public.assessment_chapters;
create policy assessment_chapters_insert on public.assessment_chapters
  for insert to authenticated
  with check (public.is_owner_student(student_id));

drop policy if exists assessment_chapters_delete on public.assessment_chapters;
create policy assessment_chapters_delete on public.assessment_chapters
  for delete to authenticated
  using (public.is_owner_student(student_id));

-- The DELETE policies on assessments and results already read
-- `student_id = auth.uid() and my_role() = 'student'` inline (0013), which is
-- what is_owner_student() now says. Rewriting them through the function keeps
-- one definition of "the student, acting on their own data" in the schema.
drop policy if exists assessments_delete on public.assessments;
create policy assessments_delete on public.assessments
  for delete to authenticated
  using (public.is_owner_student(student_id));

drop policy if exists results_delete on public.results;
create policy results_delete on public.results
  for delete to authenticated
  using (public.is_owner_student(student_id));

-- ------------------------------------------------------ can_log_for is gone ---
--
-- Dropped last: nothing may reference it by the time it goes. 0003 created it
-- with no caller, 0013 redefined it and gave it four, and 0018 removes the
-- last of them. `log_manual_result()` and `set_assessment_chapters()` are
-- SECURITY INVOKER and never named it — they inherit the policies above, so
-- narrowing the policies narrows the RPCs with no change to either.
drop function if exists public.can_log_for(uuid);
