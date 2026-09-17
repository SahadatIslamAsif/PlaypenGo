-- 0033 — check_registered_role()
--
-- Run against a local stack:
--
--     supabase db reset
--     supabase test db

begin;

set search_path = public, extensions, tests;

select plan(5);

-- ===========================================================================
-- 1. anon can call it at all - no session exists yet at signup time.
-- ===========================================================================

select tests.login_as_anon();

select is(
  public.check_registered_role('tutor.a@example.test'),
  'tutor',
  'anon reads back the confirmed tutor fixture''s role'
);

select is(
  public.check_registered_role('TUTOR.A@EXAMPLE.TEST'),
  'tutor',
  'case-insensitive, since email addresses are'
);

select is(
  public.check_registered_role('no-such-address@example.test'),
  NULL,
  'an email nobody has ever used returns null, not an error'
);

select tests.logout();

-- ===========================================================================
-- 2. An unconfirmed account reports nothing - its role isn't settled yet
--    (§1: a second signUp() on the same still-unconfirmed email can still
--    silently land under a different role).
-- ===========================================================================

-- handle_new_user() (0002) fires on this insert and writes the matching
-- profiles row itself - inserting one by hand here would just collide with it.
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
values (
  '00000000-0000-4000-d000-000000000001',
  'unconfirmed-role-check@example.test',
  crypt('password123', gen_salt('bf')),
  null,
  '{"role":"guardian","full_name":"Unconfirmed Fixture"}'::jsonb
);

select tests.login_as_anon();

select is(
  public.check_registered_role('unconfirmed-role-check@example.test'),
  NULL,
  'a profiles row exists (handle_new_user fires on insert), but unconfirmed reports null'
);

select tests.logout();

-- Confirm it, then it does report.
update auth.users set email_confirmed_at = now()
 where id = '00000000-0000-4000-d000-000000000001';

select tests.login_as_anon();

select is(
  public.check_registered_role('unconfirmed-role-check@example.test'),
  'guardian',
  'and once confirmed, the same address reports its role'
);

select tests.logout();

select * from finish();

rollback;
