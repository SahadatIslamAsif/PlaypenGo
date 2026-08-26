// The routines bucket. Private, signed URLs only (§3.3).
//
// Paths follow the layout storage_owner() parses in migration 0003 and the
// storage policies in 0010 depend on:
//
//     <student_id>/<routine_id>/<page>.<ext>
//
// The first segment is the whole access-control story — get it wrong and the
// object is unreachable rather than exposed, because storage_owner() returns
// null for a malformed path and null fails every policy predicate.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export const ROUTINES_BUCKET = "routines";

/** One hour: long enough to read a page, short enough that a copied URL dies. */
const SIGNED_URL_TTL = 3600;

export function routineImagePath(
  studentId: string,
  routineId: string,
  extension: string,
  page = 1,
): string {
  return `${studentId}/${routineId}/${page}.${extension}`;
}

export async function signRoutineImage(
  supabase: SupabaseClient<Database>,
  path: string | null,
  expiresIn = SIGNED_URL_TTL,
): Promise<string | null> {
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from(ROUTINES_BUCKET)
    .createSignedUrl(path, expiresIn);

  // A missing or unreadable image is not a reason to fail the page — the grid
  // is the point, and the photo is reference material beside it.
  if (error || !data) return null;
  return data.signedUrl;
}
