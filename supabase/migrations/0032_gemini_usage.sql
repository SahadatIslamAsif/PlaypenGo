-- 0032 — gemini_usage: one global counter for the shared Gemini free-tier
-- daily quota (~20 requests/day on gemini-3.6-flash, shared across syllabus
-- import, routine OCR, and paper scanning — CLAUDE.md / ARCHITECTURE.md §2).
-- The quota is per Google project, not per student, so this is one row per
-- day, never one row per student — a per-student counter would already be
-- wrong the moment a second student used the app.
--
-- Keyed to the Pacific calendar date, because that's the date Google's own
-- quota resets against (midnight Pacific), not the caller's local date and
-- not UTC. Both functions below compute it server-side (America/Los_Angeles,
-- so DST is handled for free) so every caller agrees on the same boundary
-- regardless of which student's session made the call.
--
-- Counted at send, not on a successful response: a request Google receives
-- and counts, followed by a crash or timeout before this app reads the
-- response back, must still count here, or the number silently drifts to
-- look safer than it is. A 503's retry is a second real call to Google, so
-- client.ts calls record_gemini_call() once per outbound request, not once
-- per logical parse attempt — see lib/gemini/usage.ts.

create table public.gemini_usage (
  id            uuid primary key default gen_random_uuid(),
  usage_date    date not null unique,
  request_count int not null default 0,
  created_at    timestamptz not null default now()
);

alter table public.gemini_usage enable row level security;

-- No policy of any kind, on purpose — like link_codes (0004), this table is
-- reachable only through the two definer functions below. There's nothing
-- here worth reading directly (one integer, one date), but there's also no
-- reason to open a second way to touch it.

create or replace function public.record_gemini_call()
returns int
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid   uuid := (select auth.uid());
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_count int;
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;

  insert into public.gemini_usage (usage_date, request_count)
  values (v_today, 1)
  on conflict (usage_date) do update
    set request_count = public.gemini_usage.request_count + 1
  returning request_count into v_count;

  return v_count;
end;
$fn$;

-- Read-only peek for the scan screen's threshold warning. Always today's
-- count against today's Pacific date — there is no reason for a client to
-- ever ask about a different day.
create or replace function public.get_gemini_usage_today()
returns int
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid   uuid := (select auth.uid());
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_count int;
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;

  select request_count into v_count
    from public.gemini_usage
   where usage_date = v_today;

  return coalesce(v_count, 0);
end;
$fn$;

revoke execute on function public.record_gemini_call(), public.get_gemini_usage_today()
  from public, anon;

grant execute on function public.record_gemini_call(), public.get_gemini_usage_today()
  to authenticated;
