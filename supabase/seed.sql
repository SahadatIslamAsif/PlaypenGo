-- seed.sql — local-only test fixture (SPEC.md §3.3)
--
-- Referenced by config.toml's [db.seed]. It runs on `supabase db reset` against
-- a local database and is NEVER applied to a linked project: it installs a test
-- framework and creates users with known passwords.
--
-- It builds two unrelated families plus one tutor, because the §3.3 assertions
-- are all of the form "A cannot see B" and a single-family fixture cannot
-- express them. A policy bug that leaks across families is invisible until
-- there is a second family to leak to.
--
--   tutor      ── approved ──> student A
--              ── approved ──> student B
--   guardian A ── approved ──> student A
--   guardian B ── approved ──> student B
--   guardian C ── pending  ──> student A     (never approved: §1 step 4)
--
-- Students A and B are unrelated: no link of any kind exists between them, and
-- neither guardian has any relationship with the other's student.

create extension if not exists pgtap with schema extensions;

-- --------------------------------------------------------------- test roles ---

create schema if not exists tests;

-- Impersonate a signed-in user. `set_config(..., true)` is transaction-local, so
-- a test that forgets to log out cannot contaminate the next transaction.
-- auth.uid() reads the `sub` claim out of request.jwt.claims.
create or replace function tests.login_as(p_user uuid)
returns void
language plpgsql
as $fn$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub',  p_user::text,
      'role', 'authenticated'
    )::text,
    true
  );
  perform set_config('role', 'authenticated', true);
end;
$fn$;

-- Back to the session user. Always permitted: SET ROLE to session_user needs no
-- membership.
create or replace function tests.logout()
returns void
language plpgsql
as $fn$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', null, true);
end;
$fn$;

-- Become the anonymous PostgREST role, to prove 0006's revoke actually bites.
create or replace function tests.login_as_anon()
returns void
language plpgsql
as $fn$
begin
  perform set_config('request.jwt.claims', null, true);
  perform set_config('role', 'anon', true);
end;
$fn$;

grant usage on schema tests to authenticated, anon, service_role;
grant execute on all functions in schema tests to authenticated, anon, service_role;

-- -------------------------------------------------------------------- users ---
--
-- Inserting into auth.users fires handle_new_user() from 0002, which writes the
-- matching public.profiles row. Profiles are therefore never inserted directly
-- here — doing so would test a schema the application never produces.
--
-- The tutor's address must be the one 0002 seeds into tutor_allowlist, or
-- handle_new_user() refuses the signup.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  -- tutor
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-4000-a000-000000000001',
   'authenticated', 'authenticated', 'tutor.a@example.test',
   crypt('password123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}',
   '{"role":"tutor","full_name":"Tutor A"}',
   now(), now()),

  -- student A
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-4000-a000-000000000002',
   'authenticated', 'authenticated', 'student.a@example.test',
   crypt('password123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}',
   '{"role":"student","full_name":"Student A","class_level":"8","section":"Marigold","session_label":"2026-2027"}',
   now(), now()),

  -- guardian A
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-4000-a000-000000000003',
   'authenticated', 'authenticated', 'guardian.a@example.test',
   crypt('password123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}',
   '{"role":"guardian","full_name":"Guardian A"}',
   now(), now()),

  -- student B — a different family, in the same section
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-4000-a000-000000000004',
   'authenticated', 'authenticated', 'student.b@example.test',
   crypt('password123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}',
   '{"role":"student","full_name":"Student B","class_level":"8","section":"Marigold","session_label":"2026-2027"}',
   now(), now()),

  -- guardian B
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-4000-a000-000000000005',
   'authenticated', 'authenticated', 'guardian.b@example.test',
   crypt('password123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}',
   '{"role":"guardian","full_name":"Guardian B"}',
   now(), now()),

  -- guardian C — redeemed student A's code, never approved
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-4000-a000-000000000006',
   'authenticated', 'authenticated', 'guardian.c@example.test',
   crypt('password123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}',
   '{"role":"guardian","full_name":"Guardian C"}',
   now(), now());

-- -------------------------------------------------------------------- links ---
--
-- Written directly rather than through redeem_link_code(), so that a bug in the
-- RPC cannot silently produce a fixture the policy tests then pass against.
-- approved_by/approved_at are stamped by hand for the same reason: the
-- stamp_link_approval trigger of 0002 fires on UPDATE, not INSERT.

insert into public.tutor_links (tutor_id, student_id, status, approved_by, approved_at)
values
  ('00000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000002', 'approved',
   '00000000-0000-4000-a000-000000000002', now()),
  ('00000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000004', 'approved',
   '00000000-0000-4000-a000-000000000004', now());

insert into public.guardian_links (guardian_id, student_id, status, approved_by, approved_at)
values
  ('00000000-0000-4000-a000-000000000003',
   '00000000-0000-4000-a000-000000000002', 'approved',
   '00000000-0000-4000-a000-000000000001', now()),
  ('00000000-0000-4000-a000-000000000005',
   '00000000-0000-4000-a000-000000000004', 'approved',
   '00000000-0000-4000-a000-000000000001', now()),
  -- §1 step 4: pending grants nothing until the tutor approves.
  ('00000000-0000-4000-a000-000000000006',
   '00000000-0000-4000-a000-000000000002', 'pending', null, null);

-- --------------------------------------------------------------- link codes ---
--
-- Codes must satisfy link_codes_shape from 0002: six characters, no O/0/I/1.

insert into public.link_codes (id, code, owner_id, kind, expires_at)
values
  ('00000000-0000-4000-e000-000000000001', 'ABC234',
   '00000000-0000-4000-a000-000000000002', 'guardian', now() + interval '7 days'),
  ('00000000-0000-4000-e000-000000000002', 'XYZ789',
   '00000000-0000-4000-a000-000000000001', 'tutor', now() + interval '7 days');

-- ---------------------------------------------------------------- catalogue ---

insert into public.subjects_catalog (id, name, code, level, common_aliases)
values
  ('00000000-0000-4000-d000-000000000001', 'Physics', '5054', 'o_level',
   array['Phy','Physics']),
  ('00000000-0000-4000-d000-000000000002', 'Mathematics D', '4024', 'o_level',
   array['Maths','Math D','Math-D','Mathematics']);

-- ------------------------------------------------------------ subject trees ---
--
-- §3.1: independent trees even though A and B sit in the same room.

insert into public.student_subjects (id, student_id, catalog_id, display_name, teacher_name)
values
  ('00000000-0000-4000-b000-000000000001',
   '00000000-0000-4000-a000-000000000002',
   '00000000-0000-4000-d000-000000000001', 'Physics', 'Shafiul'),
  ('00000000-0000-4000-b000-000000000002',
   '00000000-0000-4000-a000-000000000002',
   '00000000-0000-4000-d000-000000000002', 'Maths', 'Rakin'),
  ('00000000-0000-4000-b000-000000000003',
   '00000000-0000-4000-a000-000000000004',
   '00000000-0000-4000-d000-000000000001', 'Physics', 'Shafiul');

-- §4.2: Mathematics splits into two papers taught in the same periods.
insert into public.subject_papers (id, student_id, student_subject_id, name, sort_order)
values
  ('00000000-0000-4000-f000-000000000001',
   '00000000-0000-4000-a000-000000000002',
   '00000000-0000-4000-b000-000000000002', 'Math D', 1),
  ('00000000-0000-4000-f000-000000000002',
   '00000000-0000-4000-a000-000000000002',
   '00000000-0000-4000-b000-000000000002', 'Add Math', 2);

-- §4.2: chapter strings are preserved verbatim, decimal sub-topics and all.
insert into public.chapters
  (id, student_id, student_subject_id, paper_id, name, source, status, sort_order)
values
  ('00000000-0000-4000-c000-000000000001',
   '00000000-0000-4000-a000-000000000002',
   '00000000-0000-4000-b000-000000000001', null,
   '1.5.4: Circular Motion', 'syllabus', 'p100', 1),
  ('00000000-0000-4000-c000-000000000002',
   '00000000-0000-4000-a000-000000000002',
   '00000000-0000-4000-b000-000000000001', null,
   '1.2: Motion', 'syllabus', 'not_started', 2),
  ('00000000-0000-4000-c000-000000000003',
   '00000000-0000-4000-a000-000000000004',
   '00000000-0000-4000-b000-000000000003', null,
   '1.5.4: Circular Motion', 'syllabus', 'p80', 1);

-- §5.1: one global alias from the catalogue, one student-scoped correction.
insert into public.subject_aliases
  (alias_text, catalog_id, student_subject_id, source, student_id)
values
  ('Phy', '00000000-0000-4000-d000-000000000001', null, 'manual', null),
  ('Add Math', null, '00000000-0000-4000-b000-000000000002', 'routine',
   '00000000-0000-4000-a000-000000000002');
