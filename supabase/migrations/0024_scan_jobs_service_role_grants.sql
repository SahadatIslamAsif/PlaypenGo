-- 0024 — service_role table grants for the TTL sweep (SPEC.md §5.3, §7.2)
--
-- 0021's abandon_expired_scan_jobs() already granted EXECUTE to service_role,
-- with its own header explaining why: "Called later by Phase 6's cron route
-- under the service-role key, RLS does not apply to that role at all". What
-- it didn't add was the table-level grant that call actually needs -
-- 0008 already documented the exact gap this repeats: "service_role bypasses
-- RLS but not the GRANT system — the local CLI's role bootstrap gives it
-- TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on new tables, not
-- SELECT/INSERT/UPDATE/DELETE". EXECUTE on a SECURITY INVOKER function is not
-- a substitute for the grant its own statements need once it's actually
-- running as service_role instead of as a signed-in student.
--
-- Two grants, matching exactly what the cron route (app/api/cron/
-- evening-digest) does under this role: abandon_expired_scan_jobs() reads and
-- updates scan_jobs; the route's own follow-up query (find which scans/
-- objects to delete for the jobs just abandoned) reads scan_pages. Nothing
-- wider - service_role has no reason to insert or delete either table, and
-- Storage's own object deletion goes through the Storage API under the
-- service-role key directly, which bypasses bucket policies by design and
-- needs no Postgres-level grant at all.

grant select, update on public.scan_jobs  to service_role;
grant select         on public.scan_pages to service_role;
