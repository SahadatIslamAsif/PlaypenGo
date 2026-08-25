-- 0008 — policies: catalogue and the subject tree (SPEC.md §3.1, §3.3)
--
-- This is the migration the 0003 header points at. Every predicate below is one
-- of its helpers.
--
-- The shape is uniform because 0005 denormalised `student_id` onto every child
-- table: read is `can_read_student(student_id)`, write is `student_id =
-- auth.uid()`, with no joins in any predicate. That is the whole payoff of the
-- 0005 deviation — a policy on `chapters` that had to join up through
-- subject_papers to student_subjects would run that join per row, on every read,
-- for the fourteen-subject tree of a Class VIII student.
--
-- WRITES ARE THE STUDENT'S ALONE, and this is worth stating plainly because it
-- contradicts §4.2. §3.3 grants tutors INSERT/UPDATE on `assessments`,
-- `results` and `result_images` — and nothing else. §4.2's syllabus seeder says
-- "tutor or student uploads PDF", and the commit step of that flow writes
-- student_subjects, subject_papers and chapters.
--
-- Those cannot both hold. §3.3 wins here: it is the section marked
-- non-negotiable, and the tighter reading is the safe one to be wrong about —
-- a tutor blocked from seeding a tree is an inconvenience, a tutor able to
-- rewrite a student's syllabus is a data-loss path across unrelated families.
-- Under these policies the Phase 2 seeder is a student-run flow, or a tutor-run
-- flow that commits through a definer RPC with its own checks. FLAGGED for a
-- decision before Phase 2 — see the note in 0009's test for the same pair.

-- ------------------------------------------------------- subjects_catalog ---

-- §3.3: readable by all authenticated users, writable by nobody. The seed is
-- loaded by service_role from seed/subjects.json in Phase 2.
create policy subjects_catalog_select on public.subjects_catalog
  for select to authenticated
  using (true);

-- ------------------------------------------------------- student_subjects ---

create policy student_subjects_select on public.student_subjects
  for select to authenticated
  using (public.can_read_student(student_id));

create policy student_subjects_insert on public.student_subjects
  for insert to authenticated
  with check (student_id = (select auth.uid()));

create policy student_subjects_update on public.student_subjects
  for update to authenticated
  using (student_id = (select auth.uid()))
  with check (student_id = (select auth.uid()));

create policy student_subjects_delete on public.student_subjects
  for delete to authenticated
  using (student_id = (select auth.uid()));

-- ---------------------------------------------------------- subject_papers ---

create policy subject_papers_select on public.subject_papers
  for select to authenticated
  using (public.can_read_student(student_id));

create policy subject_papers_insert on public.subject_papers
  for insert to authenticated
  with check (student_id = (select auth.uid()));

create policy subject_papers_update on public.subject_papers
  for update to authenticated
  using (student_id = (select auth.uid()))
  with check (student_id = (select auth.uid()));

create policy subject_papers_delete on public.subject_papers
  for delete to authenticated
  using (student_id = (select auth.uid()));

-- ----------------------------------------------------------------- chapters ---

create policy chapters_select on public.chapters
  for select to authenticated
  using (public.can_read_student(student_id));

create policy chapters_insert on public.chapters
  for insert to authenticated
  with check (student_id = (select auth.uid()));

-- The 0/80/100 progress taps of §8 are this policy. `status_updated_at` is set
-- by the touch_chapter_status trigger of 0005, not by the client, because §7.3
-- reads it to decide when a CWM becomes likely.
create policy chapters_update on public.chapters
  for update to authenticated
  using (student_id = (select auth.uid()))
  with check (student_id = (select auth.uid()));

create policy chapters_delete on public.chapters
  for delete to authenticated
  using (student_id = (select auth.uid()));

-- ---------------------------------------------------------- subject_aliases ---

-- Global aliases (student_id null) are part of the shipped catalogue and are
-- readable by everyone signed in; student-scoped aliases follow the tree.
create policy subject_aliases_select on public.subject_aliases
  for select to authenticated
  using (
    student_id is null
    or public.can_read_student(student_id)
  );

-- §5.1 grows this table every time a parse is corrected, but only ever in the
-- correcting student's own scope. A student cannot write a global alias: the
-- predicate requires student_id = auth.uid(), and null is not equal to anything.
-- One student's misreading of a routine cell must not reshape every other
-- student's parse.
create policy subject_aliases_insert on public.subject_aliases
  for insert to authenticated
  with check (student_id = (select auth.uid()));

create policy subject_aliases_update on public.subject_aliases
  for update to authenticated
  using (student_id = (select auth.uid()))
  with check (student_id = (select auth.uid()));

create policy subject_aliases_delete on public.subject_aliases
  for delete to authenticated
  using (student_id = (select auth.uid()));

-- -------------------------------------------------------------- privileges ---
--
-- As in 0007: grant only the verbs that have a policy. The catalogue is
-- select-only at the privilege level too, so "writable by nobody" is enforced
-- twice over.

revoke all on public.subjects_catalog, public.student_subjects,
              public.subject_papers, public.chapters, public.subject_aliases
  from authenticated;

grant select on public.subjects_catalog to authenticated;

grant select, insert, update, delete on public.student_subjects to authenticated;
grant select, insert, update, delete on public.subject_papers   to authenticated;
grant select, insert, update, delete on public.chapters         to authenticated;
grant select, insert, update, delete on public.subject_aliases  to authenticated;
