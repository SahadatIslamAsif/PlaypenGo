-- 0012 — close the guardian write gap on the student's own tables
-- (CLAUDE.md "Guardians are read-only"; SPEC.md §1, §3.3)
--
-- 0008 and 0010 wrote every write predicate on the student-owned tables as
-- `student_id = (select auth.uid())`. That denies the threat those suites were
-- written against — a guardian writing rows ABOUT their student — and 0009 and
-- 0011 both assert it does. It does not deny a guardian writing a row about
-- THEMSELVES: `student_id = auth.uid()` is satisfied when a guardian supplies
-- their own id.
--
-- The rows that produces are inert. `student_id` on a guardian's row matches no
-- guardian_link, so nothing in the app or the digest ever selects them, and no
-- other family can see them. It is a junk-data path, not a disclosure one.
--
-- It is still worth closing, because the rule the product states has no
-- exceptions in it. CLAUDE.md: "Guardians are read-only. No insert, update, or
-- delete policy on any table, and no edit affordance in their UI." A predicate
-- that admits one shape of guardian write does not implement that sentence, and
-- the next person to read these policies would reasonably conclude guardians
-- were considered and allowed.
--
-- WHY ALL THREE VERBS, when only INSERT is reachable today. With INSERT closed
-- there is no guardian-owned row left for UPDATE or DELETE to reach, so those
-- two are defence in depth rather than a fix. They are included anyway because
-- the alternative is a table whose INSERT says "students only" and whose UPDATE
-- says something weaker, which reads as a deliberate distinction. There isn't
-- one. The rule is that these tables are the student's.
--
-- WHY NOT THE IDENTITY TABLES. 0007's tables need no change: profiles,
-- link_codes, link_code_attempts, guardian_links and tutor_links have no INSERT
-- policy at all, and their writers (handle_new_user, issue_link_code,
-- redeem_link_code) are all SECURITY DEFINER.
--
-- WHY THE TUTOR IS UNAFFECTED. commit_syllabus_tree() (0009) and
-- commit_routine_grid()/update_routine_period() (0011) are SECURITY DEFINER and
-- run as the function owner. 0006 deliberately did not use FORCE ROW LEVEL
-- SECURITY, so the owner is not subject to these policies at all — the RPCs do
-- not see this change, and 0010's and 0012's suites still pass unmodified.
--
-- WHY `(select public.my_role())` AND NOT A BARE CALL. Same reason 0003 gives
-- for `(select auth.uid())`: the subselect is hoisted to an InitPlan and
-- evaluated once per statement instead of once per row. my_role() is already
-- STABLE SECURITY DEFINER and does not re-enter the profiles policy.

-- Postgres has no CREATE OR REPLACE POLICY, so each is dropped and rewritten.
-- Names are preserved exactly, because 0011's structural assertions and any
-- future \d output key on them.

-- ------------------------------------------------------- student_subjects ---

drop policy student_subjects_insert on public.student_subjects;
drop policy student_subjects_update on public.student_subjects;
drop policy student_subjects_delete on public.student_subjects;

create policy student_subjects_insert on public.student_subjects
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  );

create policy student_subjects_update on public.student_subjects
  for update to authenticated
  using (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  )
  with check (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  );

create policy student_subjects_delete on public.student_subjects
  for delete to authenticated
  using (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  );

-- ---------------------------------------------------------- subject_papers ---

drop policy subject_papers_insert on public.subject_papers;
drop policy subject_papers_update on public.subject_papers;
drop policy subject_papers_delete on public.subject_papers;

create policy subject_papers_insert on public.subject_papers
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  );

create policy subject_papers_update on public.subject_papers
  for update to authenticated
  using (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  )
  with check (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  );

create policy subject_papers_delete on public.subject_papers
  for delete to authenticated
  using (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  );

-- ----------------------------------------------------------------- chapters ---

drop policy chapters_insert on public.chapters;
drop policy chapters_update on public.chapters;
drop policy chapters_delete on public.chapters;

create policy chapters_insert on public.chapters
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  );

-- Still the 0/80/100 progress taps of §8, and status_updated_at is still set by
-- the touch_chapter_status trigger of 0005 rather than by the client.
create policy chapters_update on public.chapters
  for update to authenticated
  using (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  )
  with check (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  );

create policy chapters_delete on public.chapters
  for delete to authenticated
  using (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  );

-- ---------------------------------------------------------- subject_aliases ---
--
-- The one place a guardian could previously have written a row that another
-- policy would later read back: subject_aliases_select exposes rows where
-- `student_id is null` to everyone signed in. A guardian still could not reach
-- that — the insert predicate required student_id = auth.uid(), and null is not
-- equal to anything — so no global alias was ever writable. Their own-id rows
-- were readable only by themselves and their own student's circle.

drop policy subject_aliases_insert on public.subject_aliases;
drop policy subject_aliases_update on public.subject_aliases;
drop policy subject_aliases_delete on public.subject_aliases;

create policy subject_aliases_insert on public.subject_aliases
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  );

create policy subject_aliases_update on public.subject_aliases
  for update to authenticated
  using (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  )
  with check (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  );

create policy subject_aliases_delete on public.subject_aliases
  for delete to authenticated
  using (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  );

-- ----------------------------------------------------------------- routines ---

drop policy routines_insert on public.routines;
drop policy routines_update on public.routines;
drop policy routines_delete on public.routines;

create policy routines_insert on public.routines
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  );

create policy routines_update on public.routines
  for update to authenticated
  using (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  )
  with check (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  );

create policy routines_delete on public.routines
  for delete to authenticated
  using (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  );

-- ---------------------------------------------------------- routine_periods ---

drop policy routine_periods_insert on public.routine_periods;
drop policy routine_periods_update on public.routine_periods;
drop policy routine_periods_delete on public.routine_periods;

create policy routine_periods_insert on public.routine_periods
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  );

create policy routine_periods_update on public.routine_periods
  for update to authenticated
  using (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  )
  with check (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  );

create policy routine_periods_delete on public.routine_periods
  for delete to authenticated
  using (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  );

-- SELECT policies are untouched throughout. Guardians read, and §1's "full
-- transparency — no filtering of bad marks" depends on that staying true.
