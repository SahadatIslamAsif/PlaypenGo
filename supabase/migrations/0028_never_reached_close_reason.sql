-- 0028 — a fifth close reason: never_reached (ARCHITECTURE.md §7.3, §7.5)
--
-- `window_exhausted` (0020) was written to mean "we asked about all four
-- occurrences and got no result" — the four-occurrence cap doing the job the
-- old flat 14-day expiry used to. That reading silently assumed the engine
-- was actually running while the window was open. §2 already documents that
-- it might not be: "Supabase free projects pause after ~7 days of
-- inactivity." A cron-job.org misconfiguration or a paused Vercel account are
-- the same shape of gap. Any of them can mean the first time the engine looks
-- at a window is already after all four of its occurrences have passed — the
-- date arithmetic says `isExhausted`, but nothing was ever asked. Recording
-- that as `window_exhausted` would tell a tutor the student was asked four
-- times and stayed silent, when the honest story is the app was never
-- running to ask at all.
--
-- The distinguishing fact needs no new column: a window the engine genuinely
-- watched has at least one `confirm`-kind `alerts` row, minted the evening
-- its occurrence's date arrived (lib/notifications/window.ts's
-- closeReasonForExhaustion). A window that hits exhaustion having never
-- minted one was never reached by a running instance of the app.

alter table public.assessments
  drop constraint assessments_window_close_reason_check;

alter table public.assessments
  add constraint assessments_window_close_reason_check
  check (window_close_reason in
          ('result_logged', 'two_no_in_a_row', 'window_exhausted', 'ct_cancelled',
           'never_reached'));
