-- 0026 — §7.6's one-tap confirmation (0026 migration)
--
-- answer_confirm_token() is the only function in this schema `anon` may
-- execute, and the only write in the whole app that happens without an
-- authenticated user. Everything below is either about that fact or about
-- §7.3's two_no_in_a_row, which this RPC is the sole writer of.
--
-- The cases that carry the most weight:
--
--   * A No does NOT close the window. §7.6 is explicit — it "advances to the
--     next occurrence still open in the window" — and closing on the first No
--     would undo the entire reason the window model replaced the single-guess
--     one: a public holiday produces one wrong alert and one No tap, which the
--     window is supposed to shrug off.
--   * A Yes does not close the window either, and does not invent a
--     placeholder row. The assessment at 'occurred' with no result IS the
--     placeholder.
--   * Two No's separated by a Yes do not close it; two with an *expired* token
--     between them do, because an unanswered occurrence is skipped entirely.
--
-- Run against a local stack:
--
--     supabase db reset
--     supabase test db

begin;

set search_path = public, extensions, tests;

select plan(24);

create or replace function tests.uid(p_who text)
returns uuid
language sql
immutable
as $fn$
  select case p_who
    when 'student_a' then '00000000-0000-4000-a000-000000000002'
    when 'physics_a' then '00000000-0000-4000-b000-000000000001'
    when 'cwm'       then '00000000-0000-4000-9000-000000000001'
    when 'ct'        then '00000000-0000-4000-9000-000000000002'
    when 'occ1'      then '00000000-0000-4000-9000-000000000011'
    when 'occ2'      then '00000000-0000-4000-9000-000000000012'
    when 'occ3'      then '00000000-0000-4000-9000-000000000013'
    when 'occ4'      then '00000000-0000-4000-9000-000000000014'
  end::uuid;
$fn$;

grant execute on function tests.uid(text) to authenticated, anon;

-- A CWM window with four occurrences, each with its own 'confirm' alert and
-- token — the state the engine leaves behind after four class days.
insert into public.assessments
  (id, student_id, student_subject_id, type, status, created_by)
values
  (tests.uid('cwm'), tests.uid('student_a'), tests.uid('physics_a'),
   'CWM', 'predicted', tests.uid('student_a')),
  (tests.uid('ct'), tests.uid('student_a'), tests.uid('physics_a'),
   'CT', 'scheduled', tests.uid('student_a'));

update public.assessments set scheduled_date = date '2026-09-10' where id = tests.uid('ct');

insert into public.alerts (id, student_id, assessment_id, kind, target_date)
values
  (tests.uid('occ1'), tests.uid('student_a'), tests.uid('cwm'), 'confirm', date '2026-08-30'),
  (tests.uid('occ2'), tests.uid('student_a'), tests.uid('cwm'), 'confirm', date '2026-08-31'),
  (tests.uid('occ3'), tests.uid('student_a'), tests.uid('cwm'), 'confirm', date '2026-09-01'),
  (tests.uid('occ4'), tests.uid('student_a'), tests.uid('cwm'), 'confirm', date '2026-09-06');

insert into public.confirm_tokens (token, alert_id, expires_at)
values
  ('tok-occurrence-one-aaaaaaaaaaaaaaaaaaaa', tests.uid('occ1'), now() + interval '7 days'),
  ('tok-occurrence-two-bbbbbbbbbbbbbbbbbbbb', tests.uid('occ2'), now() + interval '7 days'),
  ('tok-occurrence-three-cccccccccccccccccc', tests.uid('occ3'), now() + interval '7 days'),
  -- Already expired: §7.3's "token expired unused" case.
  ('tok-occurrence-four-dddddddddddddddddd', tests.uid('occ4'), now() - interval '1 day');

-- ===========================================================================
-- 1. It really is reachable without logging in
-- ===========================================================================

select tests.login_as_anon();

select is(
  public.answer_confirm_token('no-such-token-at-all-xxxxxxxxxxxxxxx', 'yes') ->> 'status',
  'unknown',
  'anon may call it at all - §7.6''s "no login required"'
);

select is(
  public.answer_confirm_token('tok-occurrence-four-dddddddddddddddddd', 'yes') ->> 'status',
  'expired',
  'an expired token is reported as expired, not as an error page'
);

select throws_ok(
  $$ select public.answer_confirm_token('tok-occurrence-one-aaaaaaaaaaaaaaaaaaaa', 'maybe') $$,
  '23514', NULL,
  'but an answer that is neither yes nor no is refused outright'
);

-- The definer function is the ONLY reach anon has. It must not have become a
-- back door to the table it reads.
select throws_ok(
  $$ select count(*) from public.confirm_tokens $$,
  '42501', NULL,
  'anon still cannot read confirm_tokens directly'
);

-- ===========================================================================
-- 2. No — §7.6's "does not close the window by itself"
-- ===========================================================================

select is(
  public.answer_confirm_token('tok-occurrence-one-aaaaaaaaaaaaaaaaaaaa', 'no') ->> 'status',
  'recorded',
  'the first No is recorded'
);

-- Back to postgres for the assertions themselves. Reading these tables is
-- exactly what anon cannot do and must never be able to — only the RPC calls in
-- this file run as anon, and the check further up proves the table stays shut.
select tests.logout();

select is(
  (select window_close_reason from public.assessments where id = tests.uid('cwm')),
  NULL,
  'and the window stays OPEN - a public holiday costs one wrong alert, not the window'
);

select is(
  (select status from public.assessments where id = tests.uid('cwm')),
  'predicted',
  'the assessment is still predicted, waiting on the next occurrence'
);

select is(
  (select answer from public.confirm_tokens
    where token = 'tok-occurrence-one-aaaaaaaaaaaaaaaaaaaa'),
  'no',
  'the answer is written to the token'
);

select isnt(
  (select used_at from public.confirm_tokens
    where token = 'tok-occurrence-one-aaaaaaaaaaaaaaaaaaaa'),
  NULL,
  'and the token is spent'
);

-- §7.6 offers one tap. A second is someone checking they pressed it.
select tests.login_as_anon();

select is(
  public.answer_confirm_token('tok-occurrence-one-aaaaaaaaaaaaaaaaaaaa', 'yes') ->> 'status',
  'already_answered',
  'a second tap reports what was recorded rather than overwriting it'
);

select tests.logout();

select is(
  (select answer from public.confirm_tokens
    where token = 'tok-occurrence-one-aaaaaaaaaaaaaaaaaaaa'),
  'no',
  'and really does not overwrite it'
);

-- ===========================================================================
-- 3. A Yes between two No's resets the run — §7.3
-- ===========================================================================

select tests.login_as_anon();

select is(
  public.answer_confirm_token('tok-occurrence-two-bbbbbbbbbbbbbbbbbbbb', 'yes') ->> 'status',
  'recorded',
  'occurrence 2 is answered Yes'
);

select tests.logout();

select is(
  (select status from public.assessments where id = tests.uid('cwm')),
  'occurred',
  '§7.6: Yes sets the assessment to occurred'
);

select is(
  (select occurred_date from public.assessments where id = tests.uid('cwm')),
  date '2026-08-31',
  'and dates it to the occurrence that was confirmed, not to today'
);

select is(
  (select count(*) from public.results r where r.assessment_id = tests.uid('cwm')),
  0::bigint,
  'the pending-result placeholder is the occurred assessment itself - no invented row'
);

select is(
  (select window_close_reason from public.assessments where id = tests.uid('cwm')),
  NULL,
  'a confirmed Yes does not close the window - §7.5 closes it when the result lands'
);

select tests.login_as_anon();

select is(
  public.answer_confirm_token('tok-occurrence-three-cccccccccccccccccc', 'no') ->> 'status',
  'recorded',
  'occurrence 3 is answered No - the sequence is now no, yes, no'
);

select tests.logout();

select is(
  (select window_close_reason from public.assessments where id = tests.uid('cwm')),
  NULL,
  'still open: two No''s separated by a Yes are not two in a row'
);

-- ===========================================================================
-- 4. Two No's back to back, across an expired token — §7.3
-- ===========================================================================
--
-- occurrence 3 is already 'no'. Occurrence 4's token expired unused, so it is
-- skipped entirely. A fifth occurrence answered No therefore lands directly
-- after occurrence 3's No in the *answered* sequence, and closes the window.

select tests.logout();

insert into public.alerts (id, student_id, assessment_id, kind, target_date)
values ('00000000-0000-4000-9000-000000000015', tests.uid('student_a'),
        tests.uid('cwm'), 'confirm', date '2026-09-07');

insert into public.confirm_tokens (token, alert_id)
values ('tok-occurrence-five-eeeeeeeeeeeeeeeeee',
        '00000000-0000-4000-9000-000000000015');

select tests.login_as_anon();

select is(
  public.answer_confirm_token('tok-occurrence-five-eeeeeeeeeeeeeeeeee', 'no') ->> 'window_closed',
  'two_no_in_a_row',
  'the second No in a row closes the window, across an occurrence nobody answered'
);

select tests.logout();

select is(
  (select window_close_reason from public.assessments where id = tests.uid('cwm')),
  'two_no_in_a_row',
  'and the reason is recorded on the assessment, per §3.2'
);

select isnt(
  (select window_closed_at from public.assessments where id = tests.uid('cwm')),
  NULL,
  'with a timestamp beside it - 0020''s pairing constraint requires both'
);

-- ===========================================================================
-- 5. ct_cancelled — §7.5's fourth reason
-- ===========================================================================

select tests.login_as(tests.uid('student_a'));

select is(
  (select window_close_reason from public.assessments where id = tests.uid('ct')),
  NULL,
  'sanity: the CT''s window is open before it is cancelled'
);

update public.assessments set status = 'cancelled' where id = tests.uid('ct');

select is(
  (select window_close_reason from public.assessments where id = tests.uid('ct')),
  'ct_cancelled',
  'cancelling a CT closes its window - the engine must not keep asking about it'
);

-- A window already closed keeps the reason it closed for, exactly as 0020 ruled
-- for result_logged.
update public.assessments set status = 'cancelled' where id = tests.uid('cwm');

select is(
  (select window_close_reason from public.assessments where id = tests.uid('cwm')),
  'two_no_in_a_row',
  'but cancelling an already-closed window does not rewrite why it closed'
);

select * from finish();

rollback;
