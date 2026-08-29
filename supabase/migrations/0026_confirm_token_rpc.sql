-- 0026 — §7.6's one-tap confirmation, and §7.5's last close reason
--
-- Two things, both of which put a rule in the database rather than in a caller
-- that might forget it.
--
-- ---------------------------------------------------------------------------
-- 1. `ct_cancelled`
--
-- §7.5 lists four ways a window closes. 0020 wired two of them into triggers
-- (`result_logged`, and the reopen on delete), and Phase 6's engine computes
-- the other two — except that `ct_cancelled` is not the engine's to compute at
-- all. It happens when a student taps Cancel on a CT, at 11am, from
-- `cancelCT()`, which today sets `status = 'cancelled'` and nothing else.
--
-- That leaves a cancelled CT with an open window: the nightly run would still
-- find it, still fire its advance and night-before alerts, and still ask
-- whether a test the student personally cancelled had happened. 0020's argument
-- for putting `result_logged` in a trigger applies verbatim — "§5.3's scan
-- confirm, the manual entry form and Phase 6's own writers all reach this
-- trigger, and only one of them would otherwise remember".
--
-- ---------------------------------------------------------------------------
-- 2. answer_confirm_token()
--
-- §7.6: "Yes/No links point at /c/<token> — single-use, 7-day expiry, no login
-- required."
--
-- No login means no `auth.uid()` to police, which rules out every policy this
-- schema has. It also cannot use the service-role key: CLAUDE.md confines that
-- to the cron route, and a page that held it would put the key one
-- URL-parsing bug away from the client. So the token *is* the capability, and
-- this is a SECURITY DEFINER function granted to `anon` — the shape 0004 gave
-- `redeem_link_code`, with the same `set search_path = ''` discipline.
--
-- Deliberately NOT throttled, unlike 0004. `link_codes` are six characters from
-- a 32-symbol alphabet and a brute-force is a realistic attack, which is what
-- `link_code_attempts` exists for. A confirm token is 32+ url-safe characters
-- (0025's check constraint) — roughly 190 bits — and the reachable prize is
-- answering one yes/no question about one quiz. A throttle table here would be
-- machinery guarding nothing.
--
-- It returns a status rather than raising for the cases a person can actually
-- hit. §8's mobile section is explicit that /c/<token> "is the guardian's most
-- common entry point; treat it as a real screen, not a redirect" — and a real
-- screen distinguishes "already answered" from "expired" from "we don't know
-- this link". A raised exception collapses all three into an error page.

-- --------------------------------------------------------- ct_cancelled ---

create or replace function public.assessments_close_window_on_cancel()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  -- Only the transition into 'cancelled', and only for a window still open. A
  -- window already closed keeps the reason it closed for — the same rule 0020
  -- applied to `result_logged`, for the same reason: a result logged before the
  -- cancellation should not have its history rewritten by it.
  if new.status = 'cancelled'
     and old.status is distinct from 'cancelled'
     and new.window_closed_at is null then
    new.window_closed_at    := now();
    new.window_close_reason := 'ct_cancelled';
  end if;

  return new;
end;
$fn$;

-- BEFORE, so it writes into the row being updated rather than issuing a second
-- UPDATE that would re-enter this same trigger.
create trigger assessments_close_window_on_cancel
  before update of status on public.assessments
  for each row
  execute function public.assessments_close_window_on_cancel();

-- --------------------------------------------------- answer_confirm_token ---

create or replace function public.answer_confirm_token(
  p_token  text,
  p_answer text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_token      public.confirm_tokens;
  v_alert      public.alerts;
  v_subject    text;
  v_type       text;
  v_closed     text := null;
  v_two_no     bool;
begin
  if p_answer is distinct from 'yes' and p_answer is distinct from 'no' then
    raise exception 'Answer must be yes or no.' using errcode = 'check_violation';
  end if;

  select * into v_token
    from public.confirm_tokens ct
   where ct.token = p_token;

  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;

  -- Single use. §7.6 offers one tap; a second one is a person checking they
  -- pressed it, not a person changing their mind, so report what was recorded
  -- rather than overwriting it.
  if v_token.used_at is not null then
    return jsonb_build_object('status', 'already_answered', 'answer', v_token.answer);
  end if;

  if v_token.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;

  select * into v_alert from public.alerts a where a.id = v_token.alert_id;

  select ss.display_name, a.type
    into v_subject, v_type
    from public.assessments a
    join public.student_subjects ss on ss.id = a.student_subject_id
   where a.id = v_alert.assessment_id;

  update public.confirm_tokens
     set used_at = now(), answer = p_answer
   where id = v_token.id;

  if p_answer = 'yes' then
    -- §7.6: "Yes -> sets assessments.status = 'occurred', creates a
    -- pending-result placeholder that surfaces on the dashboard and in section
    -- 6 of the digest."
    --
    -- The placeholder is not a new table. An assessment at 'occurred' with no
    -- `results` row IS the placeholder — that is exactly the shape §7.4 section
    -- 6 already reads ("assessments confirmed as having happened with no result
    -- after 2 days") and exactly what §8's dashboard calls a pending-result
    -- nudge. Inventing a row for it would create a second source of truth for
    -- the same fact.
    --
    -- The window is NOT closed here. §7.6: "The window closes the normal way
    -- once that result is logged — a confirmed 'yes' doesn't need its own close
    -- reason", and 0020's trigger is what will do it.
    update public.assessments
       set status        = 'occurred',
           occurred_date = coalesce(occurred_date, v_alert.target_date)
     where id = v_alert.assessment_id
       and status in ('predicted', 'scheduled');

  else
    -- §7.6: "No does not close the window by itself. It advances to the next
    -- occurrence still open in the window." So the only thing to decide here is
    -- whether this No was the second in a row.
    --
    -- §7.3's computation, over answered occurrences only: take the confirm
    -- alerts of this assessment that actually carry an answer, newest
    -- occurrence first, and look at two. An occurrence whose token expired
    -- unused never appears, so it "neither breaks nor extends anything"; a
    -- `yes` between two `no`s does break the run, because it occupies one of
    -- the two slots.
    select count(*) = 2 and bool_and(recent.answer = 'no')
      into v_two_no
      from (
        select ct.answer
          from public.alerts a
          join public.confirm_tokens ct on ct.alert_id = a.id
         where a.assessment_id = v_alert.assessment_id
           and a.kind = 'confirm'
           and ct.answer is not null
         order by a.target_date desc
         limit 2
      ) recent;

    if v_two_no then
      update public.assessments
         set window_closed_at    = now(),
             window_close_reason = 'two_no_in_a_row'
       where id = v_alert.assessment_id
         and window_closed_at is null;

      v_closed := 'two_no_in_a_row';
    end if;
  end if;

  return jsonb_build_object(
    'status',       'recorded',
    'answer',       p_answer,
    'subject',      v_subject,
    'type',         v_type,
    'target_date',  v_alert.target_date,
    'window_closed', v_closed
  );
end;
$fn$;

-- The one function in this schema `anon` may execute. `authenticated` gets it
-- too: a guardian who happens to be signed in on the same phone follows the
-- same link, and the token is what authorises the answer either way.
revoke execute on function public.answer_confirm_token(text, text) from public;
grant execute on function public.answer_confirm_token(text, text) to anon, authenticated;
