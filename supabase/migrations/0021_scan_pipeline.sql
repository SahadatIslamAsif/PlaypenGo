-- 0021 — the scan pipeline (SPEC.md §3.2, §3.3, §5.3; Phase 5)
--
-- Three tables, two buckets and two RPCs, in one migration because 0006's rule
-- is that a table enables RLS in the migration that creates it and a bucket
-- ships with its policies — and 0009's suite fails the build if either is
-- forgotten.
--
-- The shape of the whole phase, in one sentence: an unconfirmed parse is a row
-- in `scan_jobs`, not React state, because launching the camera can evict the
-- tab and §5.3 requires the review screen to be resumable.
--
-- ---------------------------------------------------------------------------
-- Why two buckets rather than one with a path prefix
--
-- §3.3 says the tutor and guardian read a confirmed exam script — it is the
-- evidence behind a mark they can see — and §3.3 also says the tutor gets "no
-- access to `scan_jobs` / `scan_pages`: scanning is a student-only action".
-- Those are different access rules for bytes at two stages of one flow, so
-- they are two buckets:
--
--   * `scans`   — pending. The student alone, on every verb.
--   * `scripts` — confirmed. can_read_student() on SELECT, student-only writes.
--
-- One bucket with a `scans/` prefix would make that distinction a condition on
-- a path segment inside a policy, where a rename is a privilege escalation.
-- A bucket id cannot be renamed by a client at all.
--
-- ---------------------------------------------------------------------------
-- Why the bytes move last
--
-- A cross-bucket move is copy-then-delete; storage has no rename. confirm_scan_job()
-- therefore writes the `result_images` rows naming the destination paths, and
-- the client copies the bytes and only then deletes the originals. A failure
-- midway leaves orphaned objects under `scans/`, which the TTL sweep already
-- exists to collect — the alternative ordering leaves a result whose images
-- have vanished, and there is nothing that can repair that.

-- ---------------------------------------------------------------- scan_jobs ---
--
-- `expires_at` is §5.3's TTL: "Abandoned scan images are swept on a TTL.
-- Supabase free storage is 1 GB." Seven days is long enough that a student who
-- puts their phone down mid-review still finds the parse waiting.

create table public.scan_jobs (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,

  status text not null default 'uploading'
         check (status in ('uploading', 'parsing', 'review',
                           'confirmed', 'abandoned', 'failed')),

  -- The full Gemini response, stored whether or not it is any good. §5.3 for
  -- CT: "store the raw parse in scan_jobs.raw_parse anyway" — no real CT paper
  -- has been seen yet (§10 item 6), so every CT scan a student runs before
  -- then is a free sample of a layout nobody has written a prompt against.
  raw_parse jsonb,
  error     text,

  -- Set on confirm. Composite FK so a job can never point at another
  -- student's result, the anti-drift idiom 0005/0013/0017 use throughout.
  result_id uuid,

  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, student_id),

  -- A result outliving the scan that produced it is normal; the job is a
  -- workspace, not a record. Null the pointer rather than cascading.
  foreign key (result_id, student_id)
    references public.results (id, student_id) on delete set null (result_id),

  -- Only a confirmed job may point at a result. Deliberately one-directional:
  -- the FK above nulls this column when the result is deleted, and a job that
  -- was confirmed stays confirmed — it did happen. The biconditional form
  -- would turn every deleteResult() into a constraint violation.
  check (result_id is null or status = 'confirmed')
);

create index scan_jobs_student_status_idx
  on public.scan_jobs (student_id, status);

-- The sweep's hot path: open jobs past their TTL, and nothing else.
create index scan_jobs_expiry_idx
  on public.scan_jobs (expires_at)
  where status in ('uploading', 'parsing', 'review');

-- --------------------------------------------------------------- scan_pages ---
--
-- §5.3: "Students upload in page order. Group by upload order, never by header
-- matching" — page 2 of the Env. Management sample has no header at all,
-- nothing to match on. `page_no` is that order, and it is what the same
-- paper / new paper toggle rewrites when a batch is split.
--
-- `has_header` comes back from the parse, so it is null until the parse runs.

create table public.scan_pages (
  id           uuid primary key default gen_random_uuid(),
  scan_job_id  uuid not null,
  student_id   uuid not null,

  -- §5.3: "1-5 images of one assessment". The cap is here rather than in the
  -- client because it is also what keeps a single Gemini call inside the 60s
  -- Vercel ceiling (§2).
  page_no      int not null check (page_no between 1 and 5),
  storage_path text not null,
  has_header   bool,

  created_at   timestamptz not null default now(),

  unique (scan_job_id, page_no),
  unique (id, student_id),

  foreign key (scan_job_id, student_id)
    references public.scan_jobs (id, student_id) on delete cascade
);

create index scan_pages_job_idx on public.scan_pages (scan_job_id, page_no);

-- ------------------------------------------------------------ result_images ---
--
-- §3.2's table, named as planned in 0006's header and deliberately not created
-- by 0013 because it has a bucket and 0006's rule is that a bucket ships with
-- its policies. This is that migration.
--
-- `raw_parse` per page rather than per result: §5.3's response schema reports
-- `mark_candidates` with a page number, and the review screen shows the
-- candidates beside the page they were read from.

create table public.result_images (
  id           uuid primary key default gen_random_uuid(),
  result_id    uuid not null,
  student_id   uuid not null,

  storage_path text not null,
  page_no      int not null check (page_no between 1 and 5),
  raw_parse    jsonb,

  created_at   timestamptz not null default now(),

  unique (result_id, page_no),

  foreign key (result_id, student_id)
    references public.results (id, student_id) on delete cascade
);

create index result_images_result_idx on public.result_images (result_id, page_no);

-- ------------------------------------------------------- results, extended ---
--
-- §5.3's name mismatch: "Do not block the save… The mismatch is recorded on
-- the result and surfaces in the tutor and guardian views." Surfacing it in a
-- roster query is what makes it a column rather than a key inside
-- `ocr_confidence` — a badge on the tutor's student list cannot afford to
-- reach into jsonb on every row.
--
-- The parsed name is kept only when it disagrees. Storing a copy of the
-- student's own name on every result would be a second place for it to be
-- wrong, and no view would ever read it.

alter table public.results
  add column name_mismatch       bool not null default false,
  add column parsed_student_name text;

alter table public.results
  add constraint results_parsed_name_only_on_mismatch_check
  check (parsed_student_name is null or name_mismatch);

-- ----------------------------------------------------------------------- RLS ---

alter table public.scan_jobs     enable row level security;
alter table public.scan_pages    enable row level security;
alter table public.result_images enable row level security;

-- §3.3, verbatim: "no access to `scan_jobs` / `scan_pages`: scanning is a
-- student-only action." The tutor and guardian are absent here by having no
-- policy at all — not by a predicate that excludes them. With RLS on and no
-- policy matching, every row is invisible and every write refused, which is
-- the strongest form the rule can take.

create policy scan_jobs_select on public.scan_jobs
  for select to authenticated
  using (public.is_owner_student(student_id));

create policy scan_jobs_insert on public.scan_jobs
  for insert to authenticated
  with check (public.is_owner_student(student_id));

create policy scan_jobs_update on public.scan_jobs
  for update to authenticated
  using (public.is_owner_student(student_id))
  with check (public.is_owner_student(student_id));

create policy scan_jobs_delete on public.scan_jobs
  for delete to authenticated
  using (public.is_owner_student(student_id));

create policy scan_pages_select on public.scan_pages
  for select to authenticated
  using (public.is_owner_student(student_id));

create policy scan_pages_insert on public.scan_pages
  for insert to authenticated
  with check (public.is_owner_student(student_id));

create policy scan_pages_update on public.scan_pages
  for update to authenticated
  using (public.is_owner_student(student_id))
  with check (public.is_owner_student(student_id));

create policy scan_pages_delete on public.scan_pages
  for delete to authenticated
  using (public.is_owner_student(student_id));

-- result_images is the other side of that line. The image behind a logged mark
-- is evidence the guardian and tutor are entitled to — §1's "full transparency
-- — no filtering of bad marks" is about exactly this — so SELECT widens to
-- can_read_student() while every write stays with the student.
create policy result_images_select on public.result_images
  for select to authenticated
  using (public.can_read_student(student_id));

create policy result_images_insert on public.result_images
  for insert to authenticated
  with check (public.is_owner_student(student_id));

-- No UPDATE policy: a page is replaced, never edited. What could be corrected
-- on one of these rows — which chapter, which mark — lives on `results` and
-- `assessment_chapters`, where the tutor's one write already reaches.
create policy result_images_delete on public.result_images
  for delete to authenticated
  using (public.is_owner_student(student_id));

revoke all on public.scan_jobs, public.scan_pages, public.result_images
  from authenticated;

grant select, insert, update, delete on public.scan_jobs  to authenticated;
grant select, insert, update, delete on public.scan_pages to authenticated;
grant select, insert, delete         on public.result_images to authenticated;

-- ------------------------------------------------------------------ storage ---
--
-- Both private, both student-first paths so 0003's storage_owner() reads the
-- owner out of segment 1 unchanged:
--
--     scans/   <student_id>/<scan_job_id>/<page_no>.<ext>
--     scripts/ <student_id>/<result_id>/<page_no>.<ext>
--
-- A malformed name makes storage_owner() return null, and null fails every
-- predicate below — denied rather than raising, exactly as 0010 documents.
--
-- The size limit is smaller than the routines bucket's 5 MB: lib/images
-- compresses to roughly 200 KB at 2000px before upload, and a cap well above
-- that still refuses an uncompressed 4 MB phone photo that skipped the client
-- path. Dhaka mobile data is not free (CLAUDE.md), and neither is 1 GB.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('scans',   'scans',   false, 2097152, array['image/webp', 'image/jpeg', 'image/png']),
  ('scripts', 'scripts', false, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- scans: the student, alone, on all four verbs. No can_read_student() anywhere
-- in this bucket — an unconfirmed parse is not evidence of anything yet.
create policy scans_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'scans'
    and public.storage_owner(name) = (select auth.uid())
    and public.my_role() = 'student'
  );

create policy scans_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'scans'
    and public.storage_owner(name) = (select auth.uid())
    and public.my_role() = 'student'
  );

create policy scans_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'scans'
    and public.storage_owner(name) = (select auth.uid())
    and public.my_role() = 'student'
  )
  with check (
    bucket_id = 'scans'
    and public.storage_owner(name) = (select auth.uid())
    and public.my_role() = 'student'
  );

-- DELETE matters more here than anywhere else in the project: it is the last
-- step of every confirm, not an exceptional act.
create policy scans_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'scans'
    and public.storage_owner(name) = (select auth.uid())
    and public.my_role() = 'student'
  );

-- scripts: read widens to the people entitled to see the mark's evidence.
create policy scripts_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'scripts'
    and public.can_read_student(public.storage_owner(name))
  );

create policy scripts_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'scripts'
    and public.storage_owner(name) = (select auth.uid())
    and public.my_role() = 'student'
  );

create policy scripts_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'scripts'
    and public.storage_owner(name) = (select auth.uid())
    and public.my_role() = 'student'
  )
  with check (
    bucket_id = 'scripts'
    and public.storage_owner(name) = (select auth.uid())
    and public.my_role() = 'student'
  );

create policy scripts_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'scripts'
    and public.storage_owner(name) = (select auth.uid())
    and public.my_role() = 'student'
  );

-- --------------------------------------------------- log_manual_result, again ---
--
-- 0020 verbatim but for three new optional keys, all defaulted to exactly what
-- every existing caller already gets: `entry_mode` stays 'manual' unless told
-- otherwise, `name_mismatch` stays false, `parsed_student_name` stays null.
-- confirm_scan_job() below is the only caller that ever sets them — this is
-- still "the atomic half" §5.3's manual-entry form relies on, just widened
-- enough for the scan confirm to be a caller of it rather than a rewrite of
-- it.

create or replace function public.log_manual_result(
  p_student uuid,
  p_entry   jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_assessment_id     uuid;
  v_student_subject   uuid;
  v_paper             uuid;
  v_chapter_ids       uuid[];
  v_type              text;
  v_occurred          date;
  v_obtained          numeric;
  v_total             numeric;
  v_entry_mode        text;
  v_name_mismatch     bool;
  v_parsed_name       text;
  v_result_id         uuid;
  v_percentage        numeric;
  v_converted         numeric;
begin
  v_obtained := nullif(p_entry ->> 'raw_obtained', '')::numeric;
  v_total    := nullif(p_entry ->> 'raw_total', '')::numeric;

  if v_obtained is null or v_total is null then
    raise exception 'Enter both the obtained and total marks.'
      using errcode = 'check_violation';
  end if;

  v_entry_mode    := coalesce(nullif(p_entry ->> 'entry_mode', ''), 'manual');
  v_name_mismatch := coalesce((p_entry ->> 'name_mismatch')::bool, false);
  v_parsed_name   := nullif(p_entry ->> 'parsed_student_name', '');

  v_assessment_id := nullif(p_entry ->> 'assessment_id', '')::uuid;

  if v_assessment_id is not null then
    -- §5.3's other path: a CT already on the calendar, or a CWM confirmed
    -- through §7.6's "did this happen?" link. The assessment must already be
    -- this student's — the SELECT itself is policy-gated, so a mismatched or
    -- foreign id simply finds no row rather than leaking whose it is.
    select a.id into v_assessment_id
      from public.assessments a
     where a.id = v_assessment_id and a.student_id = p_student;

    if v_assessment_id is null then
      raise exception 'That assessment could not be found for this student.'
        using errcode = 'no_data_found';
    end if;

    if exists (select 1 from public.results r where r.assessment_id = v_assessment_id) then
      raise exception 'A result is already logged for this assessment.'
        using errcode = 'unique_violation';
    end if;
  else
    -- No assessment yet: the manual-entry form, or a scan with no window to
    -- attach to, is creating both at once.
    v_student_subject := nullif(p_entry ->> 'student_subject_id', '')::uuid;
    v_paper           := nullif(p_entry ->> 'paper_id', '')::uuid;
    v_type            := nullif(p_entry ->> 'type', '');
    v_occurred        := nullif(p_entry ->> 'occurred_date', '')::date;

    if v_student_subject is null then
      raise exception 'Choose a subject.' using errcode = 'check_violation';
    end if;

    if v_type is distinct from 'CT' and v_type is distinct from 'CWM' then
      raise exception 'Choose whether this is a CT or a CWM.'
        using errcode = 'check_violation';
    end if;

    insert into public.assessments
      (student_id, student_subject_id, paper_id, type,
       status, occurred_date, created_by)
    values
      (p_student, v_student_subject, v_paper, v_type,
       'logged', coalesce(v_occurred, current_date), (select auth.uid()))
    returning id into v_assessment_id;
  end if;

  -- chapter_ids is optional on both entry shapes — a paper that names no
  -- chapter at all is exactly as valid today as it was under the old scalar
  -- column, and set_assessment_chapters() treats an empty/absent array as
  -- "no chapters" rather than an error.
  select array_agg(nullif(value, '')::uuid)
    into v_chapter_ids
    from jsonb_array_elements_text(coalesce(p_entry -> 'chapter_ids', '[]'::jsonb)) as value;

  perform public.set_assessment_chapters(v_assessment_id, v_chapter_ids);

  insert into public.results
    (assessment_id, student_id, raw_obtained, raw_total, paper_missing,
     entry_mode, verified_by, name_mismatch, parsed_student_name)
  values
    (v_assessment_id, p_student, v_obtained, v_total,
     coalesce((p_entry ->> 'paper_missing')::bool, false),
     v_entry_mode, (select auth.uid()), v_name_mismatch, v_parsed_name)
  returning id, percentage, converted into v_result_id, v_percentage, v_converted;

  return jsonb_build_object(
    'assessment_id', v_assessment_id,
    'result_id',     v_result_id,
    -- Read back from the generated columns (0013), never recomputed here, so
    -- the caller displays what Postgres actually stored.
    'percentage',    v_percentage,
    'converted',     v_converted
  );
end;
$fn$;

revoke execute on function public.log_manual_result(uuid, jsonb) from public, anon;
grant execute on function public.log_manual_result(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------ confirm_scan_job ---
--
-- §5.3's "On confirm": write results (via log_manual_result, so the atomicity
-- and both entry shapes come for free), write result_images naming the
-- `scripts/` destinations, and mark the job confirmed. What it does NOT do is
-- move any bytes — Postgres cannot reach into Storage, and the settled order
-- is write-rows-then-copy-then-delete so a crash mid-move leaves orphans the
-- TTL sweep collects rather than a result with vanished images. The returned
-- `images` array is what the client copies from and then deletes.
--
-- SECURITY INVOKER, same as log_manual_result and for the same reason (0014's
-- header): the table policies above already say who may do this, so there is
-- one authorization story for the whole confirm, not two.

create or replace function public.confirm_scan_job(
  p_job   uuid,
  p_entry jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_student   uuid;
  v_status    text;
  v_result    jsonb;
  v_result_id uuid;
  v_images    jsonb;
begin
  select sj.student_id, sj.status into v_student, v_status
    from public.scan_jobs sj
   where sj.id = p_job;

  if v_student is null then
    raise exception 'That scan could not be found.' using errcode = 'no_data_found';
  end if;

  if v_status = 'confirmed' then
    raise exception 'This scan has already been saved.'
      using errcode = 'unique_violation';
  end if;

  if v_status not in ('review', 'parsing') then
    raise exception 'This scan is not ready to be saved.'
      using errcode = 'check_violation';
  end if;

  -- log_manual_result() re-derives assessment ownership and does its own
  -- checks; forcing entry_mode here rather than trusting the client is the
  -- one thing confirm_scan_job adds on top of it — a caller cannot claim a
  -- scanned result was typed by hand, or the reverse.
  v_result := public.log_manual_result(
    v_student,
    p_entry || jsonb_build_object('entry_mode', 'ocr')
  );
  v_result_id := (v_result ->> 'result_id')::uuid;

  -- One result_images row per page, in upload order, naming where the bytes
  -- will live once the client finishes the copy. The extension is carried
  -- over from the scans/ path rather than re-guessed.
  insert into public.result_images (result_id, student_id, storage_path, page_no)
  select
    v_result_id,
    v_student,
    v_student || '/' || v_result_id || '/' || sp.page_no ||
      '.' || substring(sp.storage_path from '\.([^.]+)$'),
    sp.page_no
  from public.scan_pages sp
  where sp.scan_job_id = p_job;

  select jsonb_agg(jsonb_build_object(
           'page_no',   ri.page_no,
           'from_path', sp.storage_path,
           'to_path',   ri.storage_path
         ) order by ri.page_no)
    into v_images
    from public.result_images ri
    join public.scan_pages sp
      on sp.scan_job_id = p_job and sp.page_no = ri.page_no
   where ri.result_id = v_result_id;

  update public.scan_jobs
     set status = 'confirmed', result_id = v_result_id, updated_at = now()
   where id = p_job;

  return v_result || jsonb_build_object('scan_job_id', p_job, 'images', v_images);
end;
$fn$;

revoke execute on function public.confirm_scan_job(uuid, jsonb) from public, anon;
grant execute on function public.confirm_scan_job(uuid, jsonb) to authenticated;

-- ------------------------------------------------------ abandon_expired_scan_jobs ---
--
-- The TTL sweep. SECURITY INVOKER on purpose: called by a signed-in student
-- opening the scan screen, RLS narrows the UPDATE to their own rows via
-- scan_jobs_update's is_owner_student() — this sweeps only what that student
-- could see anyway. Called later by Phase 6's cron route under the
-- service-role key, RLS does not apply to that role at all, and the same
-- statement sweeps every student's abandoned jobs. One function, two callers,
-- no branch between them.
--
-- Storage objects are not touched here — Postgres has no reach into Storage,
-- same as confirm_scan_job() above. Deleting the now-orphaned `scans/` bytes
-- for an abandoned job's rows is the caller's job, once it has the ids back.

create or replace function public.abandon_expired_scan_jobs()
returns setof uuid
language sql
security invoker
set search_path = ''
as $fn$
  update public.scan_jobs
     set status = 'abandoned', updated_at = now()
   where status in ('uploading', 'parsing', 'review')
     and expires_at < now()
  returning id;
$fn$;

revoke execute on function public.abandon_expired_scan_jobs() from public, anon;
grant execute on function public.abandon_expired_scan_jobs() to authenticated, service_role;
