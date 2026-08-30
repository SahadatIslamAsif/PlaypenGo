-- 0005 — subject catalogue and the per-student tree (ARCHITECTURE.md §3.1, §3.2, §4)
--
-- DEVIATION from §3.2: `student_id` is carried on every child table here, not
-- just the roots. A policy on `chapters` would otherwise join up two levels to
-- reach an owner, per row. Drift is prevented structurally rather than by
-- trigger: each parent carries `unique (id, student_id)` and each child a
-- composite FK `(parent_id, student_id) -> parent (id, student_id)`, so a child
-- row cannot name a parent belonging to a different student.
--
-- §3.1: the tree is per student, never per section. Two students in the same
-- room have independent trees.

-- ------------------------------------------------------ subjects_catalog ---

-- Static seed, loaded from seed/subjects.json in Phase 2. Readable by every
-- signed-in user, writable by nobody (§3.3).
create table public.subjects_catalog (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  code           text,                      -- '4037'; null for Lower Secondary
  level          text not null check (level in ('o_level', 'lower_secondary')),
  common_aliases text[] not null default '{}',
  created_at     timestamptz not null default now(),
  unique (name, level)
);

-- §4.1: alias lookup is the hot path for routine and paper parsing.
create index subjects_catalog_aliases_idx
  on public.subjects_catalog using gin (common_aliases);

-- ------------------------------------------------------- student_subjects ---

create table public.student_subjects (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.profiles (id) on delete cascade,
  catalog_id   uuid references public.subjects_catalog (id) on delete set null,
  display_name text not null,               -- as the school names it
  teacher_name text,                        -- from the routine parse
  is_active    bool not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),

  unique (id, student_id),                  -- composite FK target
  unique (student_id, display_name)
);

create index student_subjects_active_idx
  on public.student_subjects (student_id, sort_order) where is_active;

-- ---------------------------------------------------------- subject_papers ---

-- §4.2: Mathematics -> Math D + Add Math, English Language -> Paper 1 + Paper 2.
create table public.subject_papers (
  id                 uuid primary key default gen_random_uuid(),
  student_id         uuid not null,
  student_subject_id uuid not null,
  name               text not null,
  sort_order         int not null default 0,
  created_at         timestamptz not null default now(),

  unique (id, student_id),
  unique (student_subject_id, name),
  foreign key (student_subject_id, student_id)
    references public.student_subjects (id, student_id) on delete cascade
);

create index subject_papers_student_idx on public.subject_papers (student_id);
create index subject_papers_subject_idx on public.subject_papers (student_subject_id, sort_order);

-- ----------------------------------------------------------------- chapters ---

create table public.chapters (
  id                 uuid primary key default gen_random_uuid(),
  student_id         uuid not null,
  student_subject_id uuid not null,
  paper_id           uuid,
  name               text not null,         -- §4.2: verbatim, never normalised
  source             text not null default 'manual'
                     check (source in ('syllabus', 'manual')),
  sort_order         int not null default 0,
  status             text not null default 'not_started'
                     check (status in ('not_started', 'p80', 'p100', 'not_taught')),
  status_updated_at  timestamptz not null default now(),
  -- §4.2: scoped so next term's syllabus upload does not destroy this term.
  session_label      text,
  semester           text,
  created_at         timestamptz not null default now(),

  unique (id, student_id),
  foreign key (student_subject_id, student_id)
    references public.student_subjects (id, student_id) on delete cascade,
  foreign key (paper_id, student_id)
    references public.subject_papers (id, student_id) on delete cascade
);

create index chapters_subject_idx on public.chapters (student_subject_id, sort_order);
create index chapters_paper_idx on public.chapters (paper_id);
create index chapters_student_idx on public.chapters (student_id);
-- §7.3 reads this to find CWM candidates: chapters at p80/p100 with no result.
create index chapters_ready_idx
  on public.chapters (student_id, status) where status in ('p80', 'p100');

-- status_updated_at is the input to the CWM prediction window, so it is
-- maintained by the database rather than trusted from the client.
create or replace function public.touch_chapter_status()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.status is distinct from old.status then
    new.status_updated_at := now();
  end if;
  return new;
end;
$fn$;

create trigger touch_chapter_status
  before update on public.chapters
  for each row execute function public.touch_chapter_status();

-- ---------------------------------------------------------- subject_aliases ---

-- §5.1: grows every time a parse is corrected. student_id null = a global alias
-- that helps every student's parse.
create table public.subject_aliases (
  id                 uuid primary key default gen_random_uuid(),
  alias_text         text not null,
  catalog_id         uuid references public.subjects_catalog (id) on delete cascade,
  student_subject_id uuid references public.student_subjects (id) on delete cascade,
  source             text not null check (source in ('routine', 'paper', 'manual')),
  student_id         uuid references public.profiles (id) on delete cascade,
  created_at         timestamptz not null default now(),

  check (catalog_id is not null or student_subject_id is not null),
  -- A student-scoped subject implies a student-scoped alias.
  check (student_subject_id is null or student_id is not null)
);

create unique index subject_aliases_global_uniq
  on public.subject_aliases (lower(alias_text))
  where student_id is null;

create unique index subject_aliases_student_uniq
  on public.subject_aliases (student_id, lower(alias_text))
  where student_id is not null;
