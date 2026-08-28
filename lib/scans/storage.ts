// The scans and scripts buckets. Both private, signed URLs only (§3.3), on
// the same student-first path layout 0021's storage_owner() reads:
//
//     scans/<student_id>/<scan_job_id>/<page_no>.<ext>
//     scripts/<student_id>/<result_id>/<page_no>.<ext>
//
// Mirrors lib/routines/storage.ts exactly — same TTL, same "missing image is
// not a reason to fail the page" behaviour — for the two buckets 0021 added.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export const SCANS_BUCKET = "scans";
export const SCRIPTS_BUCKET = "scripts";

/** One hour: long enough to review a page, short enough that a copied URL dies. */
const SIGNED_URL_TTL = 3600;

export function scanImagePath(
  studentId: string,
  scanJobId: string,
  pageNo: number,
  extension: string,
): string {
  return `${studentId}/${scanJobId}/${pageNo}.${extension}`;
}

export function scriptImagePath(
  studentId: string,
  resultId: string,
  pageNo: number,
  extension: string,
): string {
  return `${studentId}/${resultId}/${pageNo}.${extension}`;
}

async function signImage(
  supabase: SupabaseClient<Database>,
  bucket: string,
  path: string | null,
  expiresIn: number,
): Promise<string | null> {
  if (!path) return null;

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);

  // A missing or unreadable image is not a reason to fail the review screen —
  // the extracted fields are the point, and the photo is reference material.
  if (error || !data) return null;
  return data.signedUrl;
}

export function signScanImage(
  supabase: SupabaseClient<Database>,
  path: string | null,
  expiresIn = SIGNED_URL_TTL,
): Promise<string | null> {
  return signImage(supabase, SCANS_BUCKET, path, expiresIn);
}

export function signScriptImage(
  supabase: SupabaseClient<Database>,
  path: string | null,
  expiresIn = SIGNED_URL_TTL,
): Promise<string | null> {
  return signImage(supabase, SCRIPTS_BUCKET, path, expiresIn);
}
