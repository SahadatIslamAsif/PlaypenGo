-- 0035 — scan_jobs.parse_lease_expires_at: closes the concurrent-parse hole
-- in the scan pipeline's retry path.
--
-- The parse route (app/api/scan-jobs/[id]/parse/route.ts) accepts a re-POST
-- on a job still sitting in 'parsing' — deliberately, per retryParse's own
-- comment in scan-screen.tsx: a job whose original request never reached the
-- route, or whose invocation died server-side mid-parse (Vercel's 60s
-- ceiling, a cold process, anything), would otherwise be a permanent dead
-- end with no owner left to retry it — recoverable before now only via the
-- 7-day TTL sweep discarding it outright.
--
-- But "parsing" alone can't tell a genuinely-stuck job apart from one that is
-- right now mid-flight on a different request, and the client had nothing
-- stopping a second POST from landing while the first was still running (the
-- Retry button had no in-flight guard, and the client only learns a job left
-- 'parsing' via a 2.5s poll). Two concurrent POSTs for the same job each ran
-- their own real parsePaper() call — two billed Gemini calls (plus each
-- one's own internal 503 retry) for what looked, client-side, like one
-- retry.
--
-- A lease closes that without reopening the dead-job case: the route claims
-- the row atomically (this column null-or-expired -> now()+70s, matching
-- maxDuration=60 plus headroom) before it does anything else. A second POST
-- arriving while the lease is still live finds nothing to claim and is
-- rejected with 409, rather than starting its own parse. A lease that has
-- expired (the process that held it died without ever reaching the final
-- status update) is exactly as claimable as a fresh 'failed' row always was.

alter table public.scan_jobs
  add column parse_lease_expires_at timestamptz;
