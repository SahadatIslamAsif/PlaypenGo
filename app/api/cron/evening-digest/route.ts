import { NextResponse } from "next/server";
import { SCANS_BUCKET } from "@/lib/scans/storage";
import { createServiceClient } from "@/lib/supabase/service";

// §7.2's cron route - "one job at 20:00 Asia/Dhaka = 14:00 UTC, triggered by
// cron-job.org against POST /api/cron/evening-digest protected by
// Authorization: Bearer ${CRON_SECRET}... Keep a vercel.json entry as
// backup." The digest itself (§7.4-§7.6) is Phase 6 and isn't built yet -
// Phases 1-4 ship before Gemini, and Phase 6 comes after Phase 5's scan
// pipeline (CLAUDE.md's build order). But CLAUDE.md is also explicit that
// scheduling is "external cron hitting *a* bearer-protected route" -
// singular - so the TTL sweep §5.3 already promised ("Abandoned scan images
// are swept on a TTL") lands here now, in the route the digest will grow
// into, rather than as a second cron-job.org job someone has to remember to
// keep firing once the digest exists.
//
// GET and POST both run the same sweep: cron-job.org can be pointed at
// either, but Vercel's own Cron Jobs (the vercel.json backup below) always
// issue GET, so POST-only would make that backup silently do nothing.
//
// service-role, not the request's own session - a cron hit has no user to
// be. RLS does not apply to this role, which is exactly why CLAUDE.md
// confines the key to this one route: abandon_expired_scan_jobs() (0021) is
// SECURITY INVOKER precisely so that, called this way, it sweeps every
// student's expired jobs in one statement rather than needing a loop over
// each of them individually.
export const maxDuration = 30;

async function runDailySweep(): Promise<NextResponse> {
  const supabase = createServiceClient();

  // abandon_expired_scan_jobs() (0021) only ever flips rows: status ->
  // 'abandoned' for jobs past expires_at. It deliberately does not touch
  // Storage - "Postgres has no reach into Storage, same as
  // confirm_scan_job()... deleting the now-orphaned scans/ bytes for an
  // abandoned job's rows is the caller's job, once it has the ids back."
  // This is that caller.
  const { data: abandonedIds, error: sweepError } = await supabase.rpc(
    "abandon_expired_scan_jobs",
  );

  if (sweepError) {
    return NextResponse.json({ error: sweepError.message }, { status: 500 });
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
        return NextResponse.json(
          { abandoned: jobIds.length, imagesDeleted: 0, storageError: removeError.message },
          { status: 207 },
        );
      }

      imagesDeleted = removed?.length ?? 0;
    }
  }

  return NextResponse.json({ abandoned: jobIds.length, imagesDeleted });
}

function checkAuth(request: Request): NextResponse | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return null;
}

export async function POST(request: Request) {
  return checkAuth(request) ?? runDailySweep();
}

export async function GET(request: Request) {
  return checkAuth(request) ?? runDailySweep();
}
