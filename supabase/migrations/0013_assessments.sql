-- 0013 — assessments and results (SPEC.md §3.2, §3.3, §6)
--
-- The phase the app exists for. §6: "The teacher always writes the raw mark on
-- the paper. Conversion happens only in the school portal at semester end. The
-- app therefore does the conversion itself, in real time — this is the core
-- reason the app exists."
--
-- Two structural decisions carry most of the weight here.
--
-- 1. THE CONVERSION IS A GENERATED COLUMN, not application code. CLAUDE.md
--    states the two formulas as a hard rule; expressed as GENERATED ALWAYS ...
--    STORED they stop being a rule someone has to remember and become one no
--    client can get wrong — not a server action, not Phase 5's scan path, not a
--    hand-written UPDATE the night before a parent meeting. `converted_scale`
--    is stored alongside, so a result always records the scale it was computed
--    against rather than leaving it implied by a formula that may change.
--
-- 2. THIS IS THE ONLY PLACE A TUTOR WRITES THROUGH AN ORDINARY POLICY. §3.3:
--    "Tutors: SELECT on all linked students; INSERT/UPDATE on assessments,
--    results, result_images only (so they can log papers during sessions).
--    Cannot delete student data." Everywhere else — the subject tree in 0009,
--    the routine in 0011 — a tutor reaches the data through a scoped definer
--    RPC because no policy could express "only during this step". Here the
--    spec grants the verbs outright, so `can_log_for()` finally has a caller.
--
-- `result_images` (§3.2) is deliberately NOT created here. It has a storage
-- bucket, and 0006's rule — followed by 0010 — is that a bucket ships in the
-- same migration as its policies. It belongs to Phase 5 alongside the
-- exam-script bucket, not to a migration that would leave it empty and
-- unprotected by anything but table RLS.

-- ------------------------------------------------- can_log_for(), repaired ---
--
-- 0003 wrote this as `p_student = auth.uid() or is_tutor_of(p_student)`, and it
-- has had no caller since — 0006's header says so explicitly. That predicate is
-- exactly the guardian-own-id hole 0012 spent a whole migration closing on six
-- other tables: a guardian passing their OWN id satisfies the first clause.
--
-- It has never been exploitable because nothing called it. Wiring it up
-- unchanged would reintroduce the bug on the two tables that hold the marks.
-- Repair it before its first use, on the same terms 0012 established.

create or replace function public.can_log_for(p_student uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (p_student = (select auth.uid()) and public.my_role() = 'student')
      or public.is_tutor_of(p_student);
$$;

-- -------------------------------------------------------------- assessments ---

create table public.assessments (
  id                 uuid primary key default gen_random_uuid(),
  student_id         uuid not null references public.profiles (id) on delete cascade,
  student_subject_id uuid not null,
  paper_id           uuid,
  chapter_id         uuid,
  -- §0: CT is announced in class; CWM is effectively a surprise quiz. Semester
  -- exams are out of scope (§10 item 3) and must not be folded in here.
  type               text not null check (type in ('CT', 'CWM')),
  status             text not null default 'scheduled'
                     check (status in ('predicted', 'scheduled', 'occurred',
                                       'logged', 'cancelled')),
  -- §3.2 annotates this "CT only"; the check is that annotation enforced.
  scheduled_date     date,
  -- §7.3 computes this for CWMs from the routine. Phase 6 fills it.
  predicted_for_date date,
  occurred_date      date,
  created_by         uuid not null references public.profiles (id),
  created_at         timestamptz not null default now(),

  check (scheduled_date is null or type = 'CT'),
  check (predicted_for_date is null or type = 'CWM'),

  unique (id, student_id),
  -- The anti-drift idiom from 0005: an assessment can never name another
  -- student's subject, paper or chapter, whatever a policy says.
  foreign key (student_subject_id, student_id)
    references public.student_subjects (id, student_id) on delete cascade,
  -- Deleting a paper or chapter must orphan the link, never the assessment —
  -- a logged mark outlives the syllabus row it was filed under. The column
  -- list is required so student_id is not nulled with it (PG 15+).
  foreign key (paper_id, student_id)
    references public.subject_papers (id, student_id) on delete set null (paper_id),
  foreign key (chapter_id, student_id)
    references public.chapters (id, student_id) on delete set null (chapter_id)
);

-- "Coming up" (§8) and the digest's Tomorrow/Day after sections (§7.4).
create index assessments_upcoming_idx
  on public.assessments (student_id, scheduled_date)
  where status in ('scheduled', 'predicted');

create index assessments_student_status_idx on public.assessments (student_id, status);
create index assessments_subject_idx        on public.assessments (student_subject_id);
-- The CT-date chip on a chapter row (§8: "Assign / edit CT date on any chapter").
create index assessments_chapter_idx on public.assessments (chapter_id) where chapter_id is not null;

-- ------------------------------------------------------------------ results ---

create table public.results (
  id              uuid primary key default gen_random_uuid(),
  -- §3.2: one result per assessment, never one per page (§5.3).
  assessment_id   uuid not null unique,
  student_id      uuid not null,

  raw_obtained    numeric not null check (raw_obtained >= 0),
  raw_total       numeric not null check (raw_total > 0),
  -- NOT constrained to raw_obtained <= raw_total. Teachers do award bonus
  -- marks, and a 16/15 the app refuses to record is worse than one it records
  -- honestly.

  -- §6: CWM scales to 15, CT to 25. Set by the trigger below from the parent's
  -- type, never by the client. Stored rather than implied so a result stays
  -- explainable if §10 item 4's assumption about 25 ever turns out to vary.
  converted_scale numeric not null check (converted_scale > 0),

  -- §6, as arithmetic Postgres owns:
  --     percentage = raw_obtained / raw_total * 100
  --     converted  = round(raw_obtained / raw_total * scale, 1)
  -- "One decimal place, as the school does."
  percentage numeric generated always as
    (round(raw_obtained / raw_total * 100, 1)) stored,
  converted  numeric generated always as
    (round(raw_obtained / raw_total * converted_scale, 1)) stored,

  -- §5.3's manual fallback: "a `Paper not returned` checkbox". The guardian
  -- view shows a soft badge for these.
  paper_missing   bool not null default false,
  entry_mode      text not null default 'manual' check (entry_mode in ('ocr', 'manual')),
  -- §5 per-field confidence. Null until Phase 5.
  ocr_confidence  jsonb,
  -- §5.3: "who confirmed the modal".
  verified_by     uuid references public.profiles (id),
  logged_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),

  unique (id, student_id),
  foreign key (assessment_id, student_id)
    references public.assessments (id, student_id) on delete cascade
);

create index results_student_logged_idx on public.results (student_id, logged_at desc);

-- ----------------------------------------------------------------- triggers ---

-- The scale is derived from the assessment, never accepted from the caller, so
-- a CWM cannot be stored against 25 even by a direct INSERT that names it.
create or replace function public.results_set_scale()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_type text;
begin
  select a.type into v_type
    from public.assessments a
   where a.id = new.assessment_id;

  if v_type is null then
    raise exception 'That assessment does not exist.'
      using errcode = 'foreign_key_violation';
  end if;

  new.converted_scale := case v_type when 'CT' then 25 else 15 end;
  return new;
end;
$fn$;

create trigger results_set_scale
  before insert or update on public.results
  for each row execute function public.results_set_scale();

-- A result implies a logged assessment. Making it a database fact rather than
-- something each caller remembers is the same reasoning as touch_chapter_status
-- in 0005: §7.5 closes alerts when a result is logged, and an assessment left
-- at 'scheduled' with a mark against it would nag forever.
create or replace function public.results_mark_assessment_logged()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  update public.assessments a
     set status        = 'logged',
         occurred_date = coalesce(a.occurred_date, a.scheduled_date,
                                  a.predicted_for_date, current_date)
   where a.id = new.assessment_id;
  return null;
end;
$fn$;

create trigger results_mark_assessment_logged
  after insert on public.results
  for each row execute function public.results_mark_assessment_logged();

-- Changing a type after a mark is filed would silently re-scale it — a CWM
-- logged at 7.5/15 would become 12.5/25 on the next touch of the row. Freeze
-- the type instead, in the lock-identity idiom 0007 already uses for links.
create or replace function public.assessments_lock_type()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.type is distinct from old.type
     and exists (select 1 from public.results r where r.assessment_id = old.id)
  then
    raise exception 'Delete the result before changing whether this is a CT or a CWM.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

create trigger assessments_lock_type
  before update on public.assessments
  for each row execute function public.assessments_lock_type();

-- ---------------------------------------------------------------------- RLS ---

alter table public.assessments enable row level security;
alter table public.results     enable row level security;

-- Read is the usual three: the student, their approved guardian, their tutor.
create policy assessments_select on public.assessments
  for select to authenticated
  using (public.can_read_student(student_id));

-- §3.3's tutor grant, and the only table-level one in the project.
create policy assessments_insert on public.assessments
  for insert to authenticated
  with check (public.can_log_for(student_id));

create policy assessments_update on public.assessments
  for update to authenticated
  using (public.can_log_for(student_id))
  with check (public.can_log_for(student_id));

-- "Cannot delete student data" — the student alone, on 0012's terms.
create policy assessments_delete on public.assessments
  for delete to authenticated
  using (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  );

create policy results_select on public.results
  for select to authenticated
  using (public.can_read_student(student_id));

create policy results_insert on public.results
  for insert to authenticated
  with check (public.can_log_for(student_id));

create policy results_update on public.results
  for update to authenticated
  using (public.can_log_for(student_id))
  with check (public.can_log_for(student_id));

create policy results_delete on public.results
  for delete to authenticated
  using (
    student_id = (select auth.uid())
    and (select public.my_role()) = 'student'
  );

-- --------------------------------------------------------------- privileges ---

revoke all on public.assessments, public.results from authenticated;

grant select, insert, update, delete on public.assessments to authenticated;
grant select, insert, update, delete on public.results     to authenticated;
