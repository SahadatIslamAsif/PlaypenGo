-- 0010 — the class routine (ARCHITECTURE.md §3.2, §3.3, §5.1, §7.3)
--
-- The routine is the app's clock. §7.3 resolves a predicted CWM to a calendar
-- date as "the next date on which that subject appears in the routine", so
-- until routine_periods holds rows, the prediction engine of Phase 6 has
-- nothing to aim at and the dashboard has no day to render.
--
-- Same deviation from §3.2 as 0005, for the same reason: `student_id` is
-- carried on routine_periods so its policies never join, and drift is prevented
-- structurally — `routines` carries `unique (id, student_id)` and the child
-- binds `(routine_id, student_id)`, so a period cannot name another student's
-- routine. The optional link to student_subjects is bound the same way.
--
-- 0006's header set two rules this migration has to satisfy: RLS is enabled in
-- the same migration that creates the table (a structural assertion in
-- 0009_rls.test.sql fails otherwise), and the storage bucket ships together
-- with its policies, because a bucket that exists for even one deploy without
-- them is a public archive of a child's exam scripts.
--
-- Writes at the table level are the student's alone, exactly as 0008 left the
-- subject tree. The tutor's scoped write path is 0011's definer RPC.

-- ----------------------------------------------------------------- routines ---

-- One row per uploaded or typed routine. §3.2 keeps the image beside the parse
-- so the grid can always be checked against the paper it came from.
create table public.routines (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.profiles (id) on delete cascade,
  session_label text not null,
  -- Nullable: Phase 3 is manual-entry-first, and a routine typed from the
  -- board is as valid as one photographed. Phase 5 fills it from the scan.
  image_path    text,
  is_active     bool not null default true,
  -- Null while a routine is hand-entered; stamped when §5.1's parse fills it.
  parsed_at     timestamptz,
  created_at    timestamptz not null default now(),

  unique (id, student_id)                   -- composite FK target
);

-- A student has exactly one routine in force per session. Re-committing a
-- routine deactivates the previous one rather than deleting it, so the periods
-- an old assessment was predicted against survive.
create unique index routines_one_active
  on public.routines (student_id, session_label) where is_active;

create index routines_student_idx on public.routines (student_id);

-- ---------------------------------------------------------- routine_periods ---

create table public.routine_periods (
  id                 uuid primary key default gen_random_uuid(),
  routine_id         uuid not null,
  student_id         uuid not null,
  -- §5.1 rule 6: Sunday–Thursday. Friday and Saturday are the weekend and
  -- never appear on a Playpen routine. This constrains the ROUTINE only —
  -- §7.3 deliberately sends alerts on weekend evenings, which is a different
  -- calendar and must not be conflated with this check.
  day_of_week        int not null check (day_of_week between 0 and 4),
  period_no          int not null check (period_no between 1 and 12),
  start_time         time,
  end_time           time,
  -- §5.1: exactly what was in the cell, never normalised. This is the string
  -- an alias is captured from, and the string a re-parse is compared against.
  raw_text           text,
  teacher_raw        text,
  -- Null when the cell has not been resolved to a subject yet, and null
  -- permanently for BREAK / Games / E.C.A.
  student_subject_id uuid,
  -- §5.1 rules 1 and 2. False for the vertical BREAK column and for named
  -- non-academic periods. Only academic periods count toward §7.3's next
  -- class day.
  is_academic        bool not null default true,
  created_at         timestamptz not null default now(),

  unique (id, student_id),
  -- One cell per day per period. Also the conflict target that makes 0011's
  -- repeat commit a no-op instead of a duplicate grid.
  unique (routine_id, day_of_week, period_no),

  foreign key (routine_id, student_id)
    references public.routines (id, student_id) on delete cascade,
  -- The column list is required. A bare SET NULL would null student_id too and
  -- violate its NOT NULL; deleting a subject must unlink the cell, not delete
  -- the period. Needs PG 15+ — config.toml pins major_version 17.
  foreign key (student_subject_id, student_id)
    references public.student_subjects (id, student_id)
    on delete set null (student_subject_id)
);

create index routine_periods_student_idx on public.routine_periods (student_id);
create index routine_periods_routine_idx
  on public.routine_periods (routine_id, day_of_week, period_no);

-- §7.3's hot path: given a subject, which weekdays does it meet? Partial,
-- because a break column is never an answer to that question.
create index routine_periods_subject_day_idx
  on public.routine_periods (student_subject_id, day_of_week)
  where is_academic and student_subject_id is not null;

-- ---------------------------------------------------------------------- RLS ---

alter table public.routines        enable row level security;
alter table public.routine_periods enable row level security;

-- Same uniform shape as 0008: read is can_read_student(student_id), write is
-- student_id = auth.uid(), no joins in any predicate. `(select auth.uid())`
-- rather than the bare call so it is hoisted to an InitPlan.

create policy routines_select on public.routines
  for select to authenticated
  using (public.can_read_student(student_id));

create policy routines_insert on public.routines
  for insert to authenticated
  with check (student_id = (select auth.uid()));

create policy routines_update on public.routines
  for update to authenticated
  using (student_id = (select auth.uid()))
  with check (student_id = (select auth.uid()));

create policy routines_delete on public.routines
  for delete to authenticated
  using (student_id = (select auth.uid()));

create policy routine_periods_select on public.routine_periods
  for select to authenticated
  using (public.can_read_student(student_id));

create policy routine_periods_insert on public.routine_periods
  for insert to authenticated
  with check (student_id = (select auth.uid()));

create policy routine_periods_update on public.routine_periods
  for update to authenticated
  using (student_id = (select auth.uid()))
  with check (student_id = (select auth.uid()));

create policy routine_periods_delete on public.routine_periods
  for delete to authenticated
  using (student_id = (select auth.uid()));

revoke all on public.routines, public.routine_periods from authenticated;

grant select, insert, update, delete on public.routines        to authenticated;
grant select, insert, update, delete on public.routine_periods to authenticated;

-- ------------------------------------------------------------------ storage ---
--
-- The first bucket in the project, and the reason storage_owner() has been
-- sitting in 0003 since Phase 1. §3.3: private, signed URLs only.
--
-- Layout is the one storage_owner() documents and its pgTAP assertions pin:
--
--     <student_id>/<routine_id>/<page>.<ext>
--
-- A malformed path makes storage_owner() return null, and null fails every
-- predicate below, so a bad name is denied rather than raising.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'routines', 'routines', false, 5242880,
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do nothing;

-- Guardians and tutors see the paper the grid was typed from; nobody else does.
create policy routines_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'routines'
    and public.can_read_student(public.storage_owner(name))
  );

-- The one standing write grant a tutor gets outside a definer RPC, and it is
-- deliberate. 0011 already lets a tutor commit a routine; the photo has to
-- reach storage from the browser that took it, and the service-role key is
-- confined to the cron route by CLAUDE.md, so there is no RPC-shaped path for
-- the bytes. The grant is scoped to one bucket that holds nothing but routine
-- photos, and it is INSERT only.
create policy routines_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'routines'
    and (
      public.storage_owner(name) = (select auth.uid())
      or public.is_tutor_of(public.storage_owner(name))
    )
  );

-- Overwrite and delete stay with the student. A tutor who uploads a wrong
-- photo asks the student to remove it; they cannot destroy one themselves.
create policy routines_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'routines'
    and public.storage_owner(name) = (select auth.uid())
  )
  with check (
    bucket_id = 'routines'
    and public.storage_owner(name) = (select auth.uid())
  );

create policy routines_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'routines'
    and public.storage_owner(name) = (select auth.uid())
  );
