import { NextResponse } from "next/server";
import { runEveningDigest } from "@/lib/notifications/engine";
import { SCANS_BUCKET } from "@/lib/scans/storage";
import { createServiceClient } from "@/lib/supabase/service";

// §7.2's cron route - "one job at 20:00 Asia/Dhaka = 14:00 UTC, triggered by
// cron-job.org against POST /api/cron/evening-digest protected by
// Authorization: Bearer ${CRON_SECRET}... Keep a vercel.json entry as
// backup."
//
// Two jobs share this one hit, because CLAUDE.md is explicit that scheduling
// is "external cron hitting *a* bearer-protected route" - singular:
//
//   1. §5.3's TTL sweep, which landed here in Phase 5 ahead of the digest
//      rather than as a second cron-job.org job someone has to remember to
//      keep firing.
//   2. §7's evening digest, which is what the route was always named for.
//
// The sweep runs first and its outcome never blocks the digest. A Storage
// failure leaves orphaned bytes under a 1 GB budget; a digest that does not go
// out leaves a student unprepared for a test tomorrow. If exactly one of the
// two can happen tonight, it is the digest.
//
// GET and POST both run the same work: cron-job.org can be pointed at either,
// but Vercel's own Cron Jobs (the vercel.json backup) always issue GET, so
// POST-only would make that backup silently do nothing.
//
// service-role, not the request's own session - a cron hit has no user to be.
// RLS does not apply to this role, which is exactly why CLAUDE.md confines the
// key to this one route.
//
// §2: Vercel Hobby functions "default to a 10s timeout, raisable to 60s via
// maxDuration". The digest walks every student sequentially and sends over
// SMTP, so it needs materially more than the sweep ever did - and 60 is the
// ceiling, not a target. §7.2's instruction to chunk the work is why the engine
// is per-student: the seam to cut along is already there if this ever runs
// close.
export const maxDuration = 60;

async function runNightly(): Promise<NextResponse> {
  const supabase = createServiceClient();

  const sweep = await runTtlSweep(supabase);

  // §7: the whole point of the route.
  let digest: Awaited<ReturnType<typeof runEveningDigest>> | null = null;
  let digestError: string | null = null;

  try {
    digest = await runEveningDigest(supabase, new Date());
  } catch (error) {
    digestError = error instanceof Error ? error.message : "digest failed";
  }

  const status = digestError ? 500 : sweep.storageError ? 207 : 200;

  return NextResponse.json({ sweep, digest, digestError }, { status });
}

type SweepResult = {
  abandoned: number;
  imagesDeleted: number;
  storageError?: string;
  sweepError?: string;
};

async function runTtlSweep(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<SweepResult> {

  // abandon_expired_scan_jobs() (0021) only ever flips rows: status ->
  // 'abandoned' for jobs past expires_at. It deliberately does not touch
  // Storage - "Postgres has no reach into Storage, same as
  // confirm_scan_job()... deleting the now-orphaned scans/ bytes for an
  // abandoned job's rows is the caller's job, once it has the ids back."
  // This is that caller.
  const { data: abandonedIds, error: sweepError } = await supabase.rpc(
    "abandon_expired_scan_jobs",
  );

  // A failed sweep is reported, never thrown: the digest still has to go out.
  if (sweepError) {
    return { abandoned: 0, imagesDeleted: 0, sweepError: sweepError.message };
  }

  const jobIds = abandonedIds ?? [];
  let imagesDeleted = 0;

  if (jobIds.length > 0) {
    // scan_pages rows are left in place - they're the historical record of
    // what was once captured, and signScanImage() already treats a missing
    // object as "no image" rather than an error. Only the bytes themselves
    // are §1's actual budget concern (Supabase free storage is 1 GB).
    const { data: pages } = await supabase
      .from("scan_pages")
      .select("storage_path")
      .in("scan_job_id", jobIds);

    const paths = (pages ?? []).map((p) => p.storage_path);

    if (paths.length > 0) {
      const { data: removed, error: removeError } = await supabase.storage
        .from(SCANS_BUCKET)
        .remove(paths);

      if (removeError) {
        // Rows are already flipped to 'abandoned' and can't be un-swept -
        // report the partial state rather than pretending nothing happened.
        // The next run's own listing of expired jobs won't re-find these
        // (they're 'abandoned', not 'uploading'/'parsing'/'review'), but the
        // orphaned objects are harmless: private bucket, never billed
        // against a result, just quietly over the 1 GB budget until
        // whoever's watching Supabase storage notices.
        return {
          abandoned: jobIds.length,
          imagesDeleted: 0,
          storageError: removeError.message,
        };
      }

      imagesDeleted = removed?.length ?? 0;
    }
  }

  return { abandoned: jobIds.length, imagesDeleted };
}

function checkAuth(request: Request): NextResponse | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return null;
}

export async function POST(request: Request) {
  return checkAuth(request) ?? runNightly();
}

export async function GET(request: Request) {
  return checkAuth(request) ?? runNightly();
}
