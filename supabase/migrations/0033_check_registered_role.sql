-- 0033 — check_registered_role(): names the role behind the "already
-- registered" signup error (app/signup/actions.ts).
--
-- GoTrue's own signUp() response deliberately can't answer this - its
-- anti-enumeration obfuscation (0032's neighbour in spirit, not in code)
-- echoes back whatever the failed attempt just submitted, never the real
-- account's data, specifically so a caller can't learn anything about an
-- email it doesn't already know exists. This function is a conscious,
-- narrow reversal of that for one specific case: once the app already knows
-- (via identities.length === 0) that the email is taken, naming which role
-- it's taken under is worth more to a three-person household signing up in
-- one sitting than the enumeration protection is worth defending here - the
-- opposite tradeoff a public multi-tenant service would make.
--
-- Scoped as narrowly as the tradeoff allows: role only, nothing else about
-- the account, and only once the email is actually confirmed (an unconfirmed
-- signup's role can still flip on the next signUp() call per §1, so
-- reporting it here would be reporting something not even settled yet).
create or replace function public.check_registered_role(p_email text)
returns text
language sql
security definer
set search_path = ''
stable
as $fn$
  select p.role
    from public.profiles p
    join auth.users u on u.id = p.id
   where lower(u.email) = lower(p_email)
     and u.email_confirmed_at is not null
   limit 1;
$fn$;

-- Callable before signup, same as answer_confirm_token (0026) - there is no
-- session yet at the point signup wants this answer.
revoke execute on function public.check_registered_role(text) from public;
grant execute on function public.check_registered_role(text) to anon, authenticated;
