-- 0016 — deleting a result must not leave a phantom 'logged' assessment
--
-- 0013's results_mark_assessment_logged trigger makes "a result implies a
-- logged assessment" a database fact on INSERT. Nothing undid that fact on
-- DELETE: deleteResult() (lib/assessments/actions.ts) only ever issued
-- `delete from results`, so a student correcting a mis-keyed manual entry was
-- left with an assessments row stuck at status='logged' pointing at nothing —
-- invisible everywhere (buildResultsList joins results, so it vanishes from
-- the UI) but still sitting in the table, and exactly the shape §7.4 point 6's
-- future "unlogged papers" digest would misread as a paper the student forgot
-- to log rather than one they deliberately un-logged.
--
-- The fix is the same idiom in reverse, and the choice of delete-vs-reset
-- turns on whether the assessment has an identity independent of this one
-- result:
--
--   * scheduled_date is set only by assignCTDate() — a CT the student put on
--     the calendar on purpose. That row means something with no result
--     attached (it is exactly what assignCTDate() itself creates), so
--     deleting its result reverts it to 'scheduled', the state it was in
--     before anyone logged a mark. occurred_date is cleared with it: 0013's
--     INSERT trigger is the only writer that ever populates it for a
--     scheduled_date row (via its coalesce), so clearing it on the way out
--     is the exact inverse of that write, not a guess.
--
--   * Every other assessment reaching this trigger was created by
--     log_manual_result()'s own branch (0014) purely to hold this result —
--     it carries no scheduled_date, and nothing else in the schema refers to
--     it. Once its one result is gone the row itself should be too.
--
--     predicted_for_date is deliberately not treated as a second case here:
--     nothing in Phases 1-4 ever writes it (it is Phase 6's CWM-prediction
--     engine), so there is no real assessment shape to verify this against
--     yet. Resetting to 'scheduled' would be wrong for a predicted-only row
--     — Phase 6 gets to make that call, with a real writer to test it
--     against, when it adds one.

create or replace function public.results_reset_assessment_on_delete()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if exists (
    select 1 from public.assessments a
     where a.id = old.assessment_id and a.scheduled_date is not null
  ) then
    update public.assessments
       set status        = 'scheduled',
           occurred_date = null
     where id = old.assessment_id;
  else
    delete from public.assessments where id = old.assessment_id;
  end if;
  return null;
end;
$fn$;

create trigger results_reset_assessment_on_delete
  after delete on public.results
  for each row execute function public.results_reset_assessment_on_delete();
