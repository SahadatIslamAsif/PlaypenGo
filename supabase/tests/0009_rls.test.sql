-- 0009 — RLS policy assertions (SPEC.md §3.3)
--
-- §3.3 says "write policy tests as SQL assertions: a guardian must not be able
-- to read another family's rows, and an unlinked student must not read anything
-- of another student's". This file is that, plus the write side, which matters
-- as much: §1 makes guardians read-only, and §3.3 stops a tutor short of
-- rewriting a student's syllabus.
--
-- Run against a local stack:
--
--     supabase db reset          -- applies 0001-0008, then seed.sql
--     supabase test db
--
-- The fixture is seed.sql: two unrelated families plus one tutor. Every
-- assertion here is of the form "A cannot see B", so it needs a B.
--
-- Two kinds of denial appear below and they are not interchangeable:
--
--   * 42501 from a statement that never runs — the role lacks the table
--     privilege (0007/0008 grant only the verbs that have a policy), or an
--     INSERT/UPDATE fails a policy's WITH CHECK.
--   * a silent zero rows — the role holds the privilege, but the policy's
--     USING clause filters every candidate row away, and Postgres reports
--     success. A test that only asserted "no error" would pass against a policy
--     that deleted the row, so each of these reads the row back afterwards.
--
-- Structural assertions come first. They are the ones that keep working as
-- Phases 3-6 add tables: a behavioural test only covers a table someone
-- remembered to write a test for, whereas "every table in public has RLS on"
-- fails the moment a new one lands without it.

begin;

-- pgtap lives in `extensions` and the fixture's helpers in `tests`. Set the
-- path explicitly rather than relying on the postgres role's default, which
-- SET ROLE does not re-evaluate.
set search_path = public, extensions, tests;

select plan(106);

-- ------------------------------------------------------------- test names ---
--
-- The fixture's UUIDs are fixed but unreadable. One lookup keeps the assertions
-- legible; it is created inside the transaction and rolled back with everything
-- else. Statements passed to throws_ok/lives_ok still carry literals, because
-- those run in their own EXECUTE and reading them next to the assertion text is
-- the point.

create or replace function tests.uid(p_who text)
returns uuid
language sql
immutable
as $fn$
  select case p_who
    when 'tutor'       then '00000000-0000-4000-a000-000000000001'
    when 'student_a'   then '00000000-0000-4000-a000-000000000002'
    when 'guardian_a'  then '00000000-0000-4000-a000-000000000003'
    when 'student_b'   then '00000000-0000-4000-a000-000000000004'
    when 'guardian_b'  then '00000000-0000-4000-a000-000000000005'
    when 'guardian_c'  then '00000000-0000-4000-a000-000000000006'
    when 'physics_a'   then '00000000-0000-4000-b000-000000000001'
    when 'maths_a'     then '00000000-0000-4000-b000-000000000002'
    when 'physics_b'   then '00000000-0000-4000-b000-000000000003'
    when 'chapter_a1'  then '00000000-0000-4000-c000-000000000001'
    when 'chapter_a2'  then '00000000-0000-4000-c000-000000000002'
    when 'chapter_b1'  then '00000000-0000-4000-c000-000000000003'
    when 'catalog_phy' then '00000000-0000-4000-d000-000000000001'
  end::uuid;
$fn$;

grant execute on function tests.uid(text) to authenticated, anon;


-- ===========================================================================
-- 1. Structural invariants
-- ===========================================================================

-- 0006's header promises this test exists, so that "every table added after
-- this migration must enable RLS in the same migration that creates it" cannot
-- be forgotten silently in Phases 3-6.
select is_empty(
  $$ select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and not c.relrowsecurity $$,
  'every table in public has RLS enabled'
);

-- Defence in depth behind 0006's revoke: RLS filters rows, GRANT decides
-- whether the statement runs at all. Read from relacl rather than
-- information_schema, whose grant views are filtered by the querying role's own
-- memberships and can quietly return nothing.
select is_empty(
  $$ select c.relname || ':' || a.privilege_type
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       cross join lateral aclexplode(c.relacl) a
       join pg_roles r on r.oid = a.grantee
      where n.nspname = 'public'
        and c.relkind = 'r'
        and r.rolname = 'anon' $$,
  'anon holds no table privilege anywhere in public'
);

-- A policy naming anon or PUBLIC would hand its table to an unauthenticated
-- request regardless of the revoke above.
select is_empty(
  $$ select tablename || '.' || policyname
       from pg_policies
      where schemaname = 'public'
        and ('anon' = any(roles) or 'public' = any(roles)) $$,
  'no policy in public is granted to anon or PUBLIC'
);

-- §3.3: guardians get SELECT and nothing else — "No INSERT/UPDATE/DELETE
-- anywhere." can_read_student() and is_guardian_of() are the two predicates
-- that admit a guardian, so a write policy routing through either is the exact
-- shape of that mistake. This is the assertion that catches it in Phase 4, when
-- assessments and results arrive and the temptation is to reuse the read
-- predicate for the tutor's logging policies.
select is_empty(
  $$ select tablename || '.' || policyname
       from pg_policies
      where schemaname = 'public'
        and cmd <> 'SELECT'
        and (coalesce(qual, '') || coalesce(with_check, ''))
            ~ '(can_read_student|is_guardian_of)' $$,
  'no write policy routes through a guardian-inclusive predicate'
);

-- Every SECURITY DEFINER function in public must pin its search_path, per the
-- 0003 header. One that does not is a privilege-escalation primitive: the
-- caller controls which schema an unqualified name resolves in, and the body
-- runs as the function's owner.
select is_empty(
  $$ select p.proname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prosecdef
        and not coalesce(p.proconfig, '{}') @> array['search_path='] $$,
  'every SECURITY DEFINER function in public pins search_path to empty'
);


-- ===========================================================================
-- 2. The anonymous role reaches nothing
-- ===========================================================================

select tests.login_as_anon();

select throws_ok(
  $$ select * from public.profiles $$,
  '42501', NULL,
  'anon cannot select profiles'
);

select throws_ok(
  $$ select * from public.chapters $$,
  '42501', NULL,
  'anon cannot select chapters'
);

select throws_ok(
  $$ select * from public.subjects_catalog $$,
  '42501', NULL,
  'anon cannot select the subject catalogue'
);

select throws_ok(
  $$ select * from public.link_codes $$,
  '42501', NULL,
  'anon cannot fish for link codes'
);

-- 0003 revokes EXECUTE from public and anon on every helper. Without that, anon
-- could probe the whole link graph one uuid at a time.
select throws_ok(
  $$ select public.can_read_student('00000000-0000-4000-a000-000000000002') $$,
  '42501', NULL,
  'anon cannot execute the access helpers'
);

select tests.logout();


-- ===========================================================================
-- 3. Access helpers — the predicates every policy is built from
-- ===========================================================================

select tests.login_as(tests.uid('tutor'));

select is(public.my_role(), 'tutor', 'my_role reports the tutor');

select ok(public.is_tutor_of(tests.uid('student_a')),
  'the tutor is tutor of student A');

select ok(public.is_tutor_of(tests.uid('student_b')),
  'the tutor is tutor of student B');

select ok(public.can_read_student(tests.uid('student_b')),
  'the tutor may read student B');

-- §3.3 gives the tutor INSERT/UPDATE on assessments, results and result_images
-- when Phase 4 creates them. 0006 leaves can_log_for() with no caller until
-- then, so this is the only thing holding it correct in the meantime.
select ok(public.can_log_for(tests.uid('student_a')),
  'the tutor may log a paper for student A');

select tests.login_as(tests.uid('guardian_a'));

select is(public.my_role(), 'guardian', 'my_role reports the guardian');

select ok(public.is_guardian_of(tests.uid('student_a')),
  'guardian A is guardian of student A');

select ok(not public.is_guardian_of(tests.uid('student_b')),
  'guardian A is not guardian of student B');

select ok(not public.can_read_student(tests.uid('student_b')),
  'guardian A may not read student B');

-- The whole of §1's read-only rule, in one predicate.
select ok(not public.can_log_for(tests.uid('student_a')),
  'guardian A may never log, not even for their own student');

select tests.login_as(tests.uid('guardian_c'));

-- §1 step 4: redeeming a code creates a pending link, and pending grants
-- nothing until the tutor approves.
select ok(not public.is_guardian_of(tests.uid('student_a')),
  'a pending guardian link grants nothing');

select ok(not public.can_read_student(tests.uid('student_a')),
  'a pending guardian may not read the student');

select tests.logout();

-- Storage objects are laid out as `<student_id>/<entity_id>/<page>.<ext>`. A
-- malformed path must evaluate to a denied policy, not abort the statement with
-- a failed cast.
select is(
  public.storage_owner('00000000-0000-4000-a000-000000000002/abc/1.jpg'),
  tests.uid('student_a'),
  'storage_owner reads the student out of a well-formed path'
);

select is(
  public.storage_owner('not-a-uuid/1.jpg'),
  NULL::uuid,
  'storage_owner returns null for a malformed path instead of raising'
);


-- ===========================================================================
-- 4. Student A — full CRUD on their own tree, nothing outside it
-- ===========================================================================

select tests.login_as(tests.uid('student_a'));

select is(
  (select count(*) from public.student_subjects),
  2::bigint,
  'student A sees exactly their own two subjects'
);

select is(
  (select count(*) from public.chapters),
  2::bigint,
  'student A sees exactly their own two chapters'
);

-- §3.1: independent trees even though A and B sit in the same room.
select is(
  (select count(*) from public.chapters where student_id = tests.uid('student_b')),
  0::bigint,
  'student A cannot read student B''s chapters'
);

select is(
  (select count(*) from public.subject_papers),
  2::bigint,
  'student A sees their own papers'
);

select lives_ok(
  $$ update public.chapters set status = 'p80'
      where id = '00000000-0000-4000-c000-000000000002' $$,
  'student A can tap their own chapter progress'
);

select is(
  (select status from public.chapters where id = tests.uid('chapter_a2')),
  'p80',
  'and the progress tap landed'
);

-- 0005 maintains this server-side because §7.3 reads it to decide when a CWM
-- becomes likely. A client-supplied timestamp would let the prediction window
-- be moved by whoever issues the UPDATE.
-- Compared against the row's own created_at rather than against now(): the seed
-- writes both from the same now(), so they start equal, and only the trigger
-- firing inside this transaction can separate them.
select ok(
  (select status_updated_at > created_at from public.chapters
    where id = tests.uid('chapter_a2')),
  'the status_updated_at trigger fired on the progress tap'
);

select lives_ok(
  $$ insert into public.chapters (student_id, student_subject_id, name, source)
     values ('00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-b000-000000000001',
             '1.6: Energy', 'manual') $$,
  'student A can add a chapter to their own subject'
);

select lives_ok(
  $$ delete from public.chapters where name = '1.6: Energy' $$,
  'student A can delete their own chapter'
);

-- The core cross-family write test — §3.1 from the write side.
select throws_ok(
  $$ insert into public.chapters (student_id, student_subject_id, name, source)
     values ('00000000-0000-4000-a000-000000000004',
             '00000000-0000-4000-b000-000000000003',
             'Injected chapter', 'manual') $$,
  '42501', NULL,
  'student A cannot write into student B''s tree'
);

select throws_ok(
  $$ insert into public.student_subjects (student_id, display_name)
     values ('00000000-0000-4000-a000-000000000004', 'Injected subject') $$,
  '42501', NULL,
  'student A cannot add a subject to student B'
);

-- USING filters the row away rather than raising, so the assertion is on the
-- value, not on the absence of an error.
select lives_ok(
  $$ update public.chapters set status = 'p100'
      where id = '00000000-0000-4000-c000-000000000003' $$,
  'student A''s update of student B''s chapter raises nothing'
);

select tests.logout();

select is(
  (select status from public.chapters where id = tests.uid('chapter_b1')),
  'p80',
  'and changed nothing — student B''s chapter is untouched'
);

select tests.login_as(tests.uid('student_a'));

select lives_ok(
  $$ delete from public.chapters
      where id = '00000000-0000-4000-c000-000000000003' $$,
  'student A''s delete of student B''s chapter raises nothing'
);

select tests.logout();

select is(
  (select count(*) from public.chapters where id = tests.uid('chapter_b1')),
  1::bigint,
  'and deleted nothing — student B''s chapter survives'
);

select tests.login_as(tests.uid('student_a'));

-- §3.3: the catalogue is readable by all authenticated users and writable by
-- nobody. 0008 revokes the write privileges outright, so this fails before the
-- policy layer is reached.
select is(
  (select count(*) from public.subjects_catalog),
  2::bigint,
  'student A reads the whole subject catalogue'
);

select throws_ok(
  $$ insert into public.subjects_catalog (name, level)
     values ('Invented Subject', 'o_level') $$,
  '42501', NULL,
  'nobody writes the subject catalogue'
);

-- §5.1: alias corrections stay in the correcting student's own scope. One
-- student's misreading of a routine cell must not reshape every other student's
-- parse.
select is(
  (select count(*) from public.subject_aliases),
  2::bigint,
  'student A sees the global alias and their own'
);

select throws_ok(
  $$ insert into public.subject_aliases (alias_text, catalog_id, source, student_id)
     values ('Physics', '00000000-0000-4000-d000-000000000001', 'manual', NULL) $$,
  '42501', NULL,
  'a student cannot write a global alias'
);

select lives_ok(
  $$ insert into public.subject_aliases
       (alias_text, student_subject_id, source, student_id)
     values ('Phy Sir', '00000000-0000-4000-b000-000000000001', 'routine',
             '00000000-0000-4000-a000-000000000002') $$,
  'a student can write an alias in their own scope'
);

-- ------------------------------------------------------ profile visibility ---

select is(
  (select count(*) from public.profiles),
  3::bigint,
  'student A sees themselves, their guardian, and their tutor'
);

select is_empty(
  $$ select id from public.profiles
      where id in ('00000000-0000-4000-a000-000000000004',
                   '00000000-0000-4000-a000-000000000005') $$,
  'student A sees nothing of the other family'
);

-- The pending guardian is invisible to the student too. Only the tutor, who has
-- to act on the approval, sees that row — 0007's
-- is_pending_guardian_for_my_student() is scoped to exactly that.
select is(
  (select count(*) from public.profiles where id = tests.uid('guardian_c')),
  0::bigint,
  'student A does not see a guardian whose link is still pending'
);

-- Without 0002's column lock this is the escalation path: a student rewrites
-- their own role to tutor and can then approve their own guardian links.
select throws_ok(
  $$ update public.profiles set role = 'tutor'
      where id = '00000000-0000-4000-a000-000000000002' $$,
  '42501', NULL,
  'a student cannot promote themselves to tutor'
);

select throws_ok(
  $$ update public.profiles set email = 'someone.else@example.test'
      where id = '00000000-0000-4000-a000-000000000002' $$,
  '42501', NULL,
  'a student cannot rewrite their sign-in email'
);

select lives_ok(
  $$ update public.profiles set section = 'Rose'
      where id = '00000000-0000-4000-a000-000000000002' $$,
  'a student can edit the unprivileged columns of their own profile'
);

select lives_ok(
  $$ update public.profiles set full_name = 'Renamed'
      where id = '00000000-0000-4000-a000-000000000003' $$,
  'a student''s update of their guardian''s profile raises nothing'
);

select is(
  (select full_name from public.profiles where id = tests.uid('guardian_a')),
  'Guardian A',
  'and changed nothing'
);

-- ------------------------------------------------------------- link codes ---
--
-- §1 step 2. Nobody selects anyone else's code: that is what keeps a
-- six-character code unguessable over PostgREST. A redeemer never reads this
-- table — they hand a candidate to redeem_link_code() and get yes or no.
select is(
  (select count(*) from public.link_codes),
  1::bigint,
  'student A sees only their own family code'
);

select is(
  (select code from public.link_codes),
  'ABC234',
  'and it is theirs'
);

select is_empty(
  $$ select code from public.link_codes where code = 'XYZ789' $$,
  'student A cannot read the tutor''s code'
);

-- A throttle counter the throttled party can read tells them how much budget is
-- left; one they can delete is not a throttle at all.
select throws_ok(
  $$ select * from public.link_code_attempts $$,
  '42501', NULL,
  'nobody reads the throttle counter'
);

select throws_ok(
  $$ select * from public.tutor_allowlist $$,
  '42501', NULL,
  'nobody reads the tutor allowlist'
);


-- ===========================================================================
-- 5. Student B — the unlinked student of §3.3
-- ===========================================================================

select tests.login_as(tests.uid('student_b'));

select is(
  (select count(*) from public.chapters),
  1::bigint,
  'student B sees only their own chapter'
);

select is(
  (select count(*) from public.student_subjects),
  1::bigint,
  'student B sees only their own subject'
);

select is(
  (select count(*) from public.subject_papers),
  0::bigint,
  'student B sees none of student A''s papers'
);

select is(
  (select count(*) from public.profiles),
  3::bigint,
  'student B sees their own family and the shared tutor, and no more'
);

select is(
  (select count(*) from public.subject_aliases),
  1::bigint,
  'student B sees the global alias but not student A''s correction'
);

select is(
  (select count(*) from public.guardian_links),
  1::bigint,
  'student B sees only the link to their own guardian'
);


-- ===========================================================================
-- 6. Guardian A — read-only, on one student (SPEC.md §1, §3.3)
-- ===========================================================================

select tests.login_as(tests.uid('guardian_a'));

-- §1: "Full transparency — no filtering of bad marks." The guardian sees the
-- same tree the student does, not a subset of it.
select is(
  (select count(*) from public.chapters),
  2::bigint,
  'guardian A reads their student''s chapters in full'
);

select is(
  (select count(*) from public.student_subjects),
  2::bigint,
  'guardian A reads their student''s subjects in full'
);

select is(
  (select count(*) from public.chapters where student_id = tests.uid('student_b')),
  0::bigint,
  'guardian A cannot read another family''s chapters'
);

select is(
  (select count(*) from public.profiles),
  3::bigint,
  'guardian A sees their student and the tutor, and nobody else'
);

-- The read-only rule, one verb at a time. INSERT fails the WITH CHECK; UPDATE
-- and DELETE are filtered to zero rows and so must be read back.
select throws_ok(
  $$ insert into public.chapters (student_id, student_subject_id, name, source)
     values ('00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-b000-000000000001',
             'Guardian-added chapter', 'manual') $$,
  '42501', NULL,
  'guardian A cannot insert a chapter'
);

select throws_ok(
  $$ insert into public.student_subjects (student_id, display_name)
     values ('00000000-0000-4000-a000-000000000002', 'Guardian-added subject') $$,
  '42501', NULL,
  'guardian A cannot insert a subject'
);

select throws_ok(
  $$ insert into public.subject_aliases
       (alias_text, student_subject_id, source, student_id)
     values ('G', '00000000-0000-4000-b000-000000000001', 'manual',
             '00000000-0000-4000-a000-000000000002') $$,
  '42501', NULL,
  'guardian A cannot insert an alias'
);

select lives_ok(
  $$ update public.chapters set status = 'not_taught'
      where id = '00000000-0000-4000-c000-000000000001' $$,
  'guardian A''s update of a chapter raises nothing'
);

select is(
  (select status from public.chapters where id = tests.uid('chapter_a1')),
  'p100',
  'and changed nothing — the chapter is still at p100'
);

select lives_ok(
  $$ delete from public.chapters
      where id = '00000000-0000-4000-c000-000000000001' $$,
  'guardian A''s delete of a chapter raises nothing'
);

select is(
  (select count(*) from public.chapters),
  2::bigint,
  'and deleted nothing — both chapters survive'
);

select lives_ok(
  $$ update public.profiles set section = 'Rose'
      where id = '00000000-0000-4000-a000-000000000002' $$,
  'guardian A''s edit of their student''s profile raises nothing'
);

-- A guardian who can revoke their own link switches off the transparency the
-- product exists to provide, from the other direction. §1 step 4 makes approval
-- — and revocation — the tutor's.
select lives_ok(
  $$ update public.guardian_links set status = 'revoked'
      where guardian_id = '00000000-0000-4000-a000-000000000003' $$,
  'guardian A''s attempt to revoke their own link raises nothing'
);

select is(
  (select status from public.guardian_links
    where guardian_id = tests.uid('guardian_a')),
  'approved',
  'and changed nothing — the link is still approved'
);

select is(
  (select count(*) from public.link_codes),
  0::bigint,
  'a guardian has no code of their own to read'
);


-- ===========================================================================
-- 7. Guardian C — pending, and therefore blind (SPEC.md §1 step 4)
-- ===========================================================================

select tests.login_as(tests.uid('guardian_c'));

select is(
  (select count(*) from public.chapters),
  0::bigint,
  'a pending guardian reads no chapters'
);

select is(
  (select count(*) from public.student_subjects),
  0::bigint,
  'a pending guardian reads no subjects'
);

select is(
  (select count(*) from public.profiles),
  1::bigint,
  'a pending guardian sees only themselves'
);

-- They can see that their own request exists — otherwise the "waiting for
-- approval" screen has nothing to render.
select is(
  (select status from public.guardian_links
    where guardian_id = tests.uid('guardian_c')),
  'pending',
  'a pending guardian can see their own request is pending'
);

select lives_ok(
  $$ update public.guardian_links set status = 'approved'
      where guardian_id = '00000000-0000-4000-a000-000000000006' $$,
  'a pending guardian''s self-approval raises nothing'
);

select is(
  (select status from public.guardian_links
    where guardian_id = tests.uid('guardian_c')),
  'pending',
  'and changed nothing — a guardian cannot approve themselves'
);


-- ===========================================================================
-- 8. Tutor — reads every linked student, writes none of their tree
-- ===========================================================================

select tests.login_as(tests.uid('tutor'));

select is(
  (select count(*) from public.chapters),
  3::bigint,
  'the tutor reads both students'' chapters'
);

select is(
  (select count(*) from public.student_subjects),
  3::bigint,
  'the tutor reads both students'' subjects'
);

select is(
  (select count(*) from public.profiles),
  6::bigint,
  'the tutor sees both families and the guardian awaiting approval'
);

-- §1 step 4: the approval queue has to render the guardian's name, or the tutor
-- is asked to approve a row they cannot identify.
select is(
  (select full_name from public.profiles where id = tests.uid('guardian_c')),
  'Guardian C',
  'the approval queue can name the pending guardian'
);

select is(
  (select count(*) from public.guardian_links),
  3::bigint,
  'the tutor sees every guardian link for their students, pending included'
);

-- 0008's decision, asserted rather than left in a comment. §3.3 grants tutors
-- INSERT/UPDATE on assessments, results and result_images and nothing else,
-- which contradicts §4.2's "tutor or student uploads PDF" for the syllabus
-- seeder. §3.3 wins: a tutor blocked from seeding a tree is an inconvenience,
-- a tutor able to rewrite a student's syllabus is a data-loss path across
-- unrelated families. FLAGGED for a decision before Phase 2 — if the seeder
-- becomes a tutor-run flow it goes through a definer RPC with its own checks,
-- and these assertions stay exactly as they are.
select throws_ok(
  $$ insert into public.chapters (student_id, student_subject_id, name, source)
     values ('00000000-0000-4000-a000-000000000002',
             '00000000-0000-4000-b000-000000000001',
             'Tutor-added chapter', 'syllabus') $$,
  '42501', NULL,
  'the tutor cannot insert a chapter into a student''s tree'
);

select throws_ok(
  $$ insert into public.student_subjects (student_id, display_name)
     values ('00000000-0000-4000-a000-000000000002', 'Tutor-added subject') $$,
  '42501', NULL,
  'the tutor cannot insert a subject into a student''s tree'
);

-- §3.3: "Cannot delete student data."
select lives_ok(
  $$ delete from public.chapters
      where id = '00000000-0000-4000-c000-000000000001' $$,
  'the tutor''s delete of a chapter raises nothing'
);

select is(
  (select count(*) from public.chapters),
  3::bigint,
  'and deleted nothing — every chapter survives'
);

select lives_ok(
  $$ update public.chapters set status = 'p100'
      where id = '00000000-0000-4000-c000-000000000002' $$,
  'the tutor''s update of a chapter raises nothing'
);

select is(
  (select status from public.chapters where id = tests.uid('chapter_a2')),
  'p80',
  'and changed nothing'
);


-- ===========================================================================
-- 9. Approval, and the integrity triggers around it
-- ===========================================================================
--
-- Ordered last: these mutate the link graph, and every visibility count above
-- is measured against the fixture as seeded.

select is(
  (select count(*) from public.tutor_links),
  2::bigint,
  'the tutor sees both of their own tutor links'
);

-- §1 step 4, the happy path.
select lives_ok(
  $$ update public.guardian_links set status = 'approved'
      where guardian_id = '00000000-0000-4000-a000-000000000006' $$,
  'the tutor approves the pending guardian link'
);

-- 0002 stamps the approver server-side so it cannot be forged by whoever issues
-- the UPDATE.
select is(
  (select approved_by from public.guardian_links
    where guardian_id = tests.uid('guardian_c')),
  tests.uid('tutor'),
  'the approval is stamped with the tutor, not with whatever the client sent'
);

select tests.login_as(tests.uid('guardian_c'));

select is(
  (select count(*) from public.chapters),
  2::bigint,
  'the newly approved guardian now reads their student''s chapters'
);

select tests.login_as(tests.uid('tutor'));

-- A row-level policy is re-checked against the NEW row, so an UPDATE that also
-- rewrites the row's identity can satisfy the policy while pointing somewhere
-- else. The tutor passes USING on student A's row and WITH CHECK on student
-- B's — both students are theirs — so only 0007's trigger stops this.
select throws_ok(
  $$ update public.guardian_links
        set student_id = '00000000-0000-4000-a000-000000000004'
      where guardian_id = '00000000-0000-4000-a000-000000000003' $$,
  '42501', NULL,
  'a guardian link cannot be moved onto a different student'
);

select throws_ok(
  $$ update public.tutor_links
        set student_id = '00000000-0000-4000-a000-000000000004'
      where student_id = '00000000-0000-4000-a000-000000000002' $$,
  '42501', NULL,
  'a tutor link cannot be moved onto a different student'
);

-- Revocation is one-way. Restoring a link goes back through a fresh code, so
-- consent is re-given rather than silently reinstated.
select lives_ok(
  $$ update public.guardian_links set status = 'revoked'
      where guardian_id = '00000000-0000-4000-a000-000000000003' $$,
  'the tutor can revoke a guardian link'
);

select is(
  (select approved_by from public.guardian_links
    where guardian_id = tests.uid('guardian_a')),
  NULL::uuid,
  'revoking clears the approval stamp'
);

select throws_ok(
  $$ update public.guardian_links set status = 'approved'
      where guardian_id = '00000000-0000-4000-a000-000000000003' $$,
  '23514', NULL,
  'a revoked link cannot be quietly reinstated'
);

select tests.login_as(tests.uid('guardian_a'));

-- Revocation takes effect immediately, within the same session.
select is(
  (select count(*) from public.chapters),
  0::bigint,
  'a revoked guardian reads nothing'
);

select is(
  (select count(*) from public.profiles),
  1::bigint,
  'a revoked guardian sees only themselves'
);

select tests.logout();

select * from finish();

rollback;
