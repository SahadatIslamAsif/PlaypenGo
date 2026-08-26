-- 0015 — percentage and converted are NOT NULL (0013 migration; SPEC.md §6)
--
-- 0013 declared these as `generated always as (...) stored` without an
-- explicit NOT NULL. They can never actually be null in practice —
-- raw_obtained, raw_total and converted_scale are all NOT NULL, and the
-- generation expression only divides by a value the raw_total > 0 check has
-- already guaranteed is positive — but Postgres does not infer NOT NULL for a
-- generated column just because its inputs are constrained, and
-- `supabase gen types` reads the constraint, not the arithmetic. Every
-- consumer of these columns (lib/assessments/list.ts's ResultRow, the
-- dashboard) is written against `number`, not `number | null`, so the
-- generated TypeScript types disagreeing here is a real mismatch, not a
-- cosmetic one — this migration is that fix, forward rather than editing
-- 0013, on the same "an applied migration is immutable" basis 0009 states.

alter table public.results
  alter column percentage set not null,
  alter column converted  set not null;
