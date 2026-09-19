-- 0034 — assessments.created_by and results.verified_by are the only two
-- foreign keys onto public.profiles (id) in the whole schema with no
-- explicit ON DELETE action (every other one, from 0002 through 0025,
-- states cascade/set null deliberately). Left at the implicit default
-- (NO ACTION), either blocks GoTrue's own user-delete cascade outright, or
-- makes it succeed only by accident of trigger firing order — Supabase's
-- dashboard reports both failure shapes as the same opaque "Database error
-- deleting user".
--
-- The two columns don't want the same fix:
--   created_by (not null, always the assessment's own student — §3.1, only
--   students create assessments) — the row is already gone by the time this
--   check would matter, since student_id cascades away first. Cascade here
--   too, so deletion no longer depends on constraint-firing order to succeed.
--   verified_by (nullable — §5.3 "who confirmed the review screen", set by
--   whichever student or tutor saved the result) — must not cascade. A tutor
--   is never the row's owner, and deleting a tutor's account must not take a
--   student's already-logged result down with it. Set null, matching the
--   approved_by columns in 0002.
alter table public.assessments
  drop constraint assessments_created_by_fkey,
  add constraint assessments_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete cascade;

alter table public.results
  drop constraint results_verified_by_fkey,
  add constraint results_verified_by_fkey
    foreign key (verified_by) references public.profiles (id) on delete set null;

-- results_set_scale() (0013) re-derives converted_scale by looking up the
-- parent assessment on *every* update, not just ones that touch
-- assessment_id — including the SET NULL this migration just put on
-- verified_by. That update fires mid-cascade, after the deleting profile's
-- assessments may already be gone, so the lookup raises "That assessment
-- does not exist" and aborts the whole delete. converted_scale only needs
-- re-deriving when assessment_id itself changes (or on insert); any other
-- update — a tutor's mark correction, this cascade's verified_by clear —
-- should leave it alone.
create or replace function public.results_set_scale()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_type text;
begin
  if TG_OP = 'UPDATE' and new.assessment_id is not distinct from old.assessment_id then
    new.converted_scale := old.converted_scale;
    return new;
  end if;

  select a.type into v_type
    from public.assessments a
   where a.id = new.assessment_id;

  if v_type is null then
    raise exception 'That assessment does not exist.'
      using errcode = 'foreign_key_violation';
  end if;

  new.converted_scale := case v_type when 'CT' then 25 else 15 end;
  return new;
end;
$fn$;
