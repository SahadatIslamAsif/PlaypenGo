import { NextResponse } from "next/server";
import { recordGeminiCall } from "@/lib/gemini/usage";
import { isQuotaExceeded, mimeTypeFor, parseRoutine } from "@/lib/routines/parse/client";
import { ROUTINES_BUCKET } from "@/lib/routines/storage";
import { createClient } from "@/lib/supabase/server";

// §5.1's step-2 parse. A single-image Gemini call fits comfortably inside
// 60s (CLAUDE.md); this route is that one call, triggered by
// routine-screen.tsx right after a photo finishes uploading to the routines
// bucket.
//
// Unlike scan-jobs/[id]/parse, there is no staging row for a routine parse -
// RoutineScreen's own "draft" mode already IS §5.1's review screen (its
// header comment says so), so this route has nothing to persist. It reads
// the photo, calls Gemini, and hands the raw parse straight back to the
// client, which turns it into a draft grid via adaptRoutineParse() using the
// exact same `subjects` candidates the page already loaded.
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  // §3.3: the routine is the student's. routine-screen.tsx never shows the
  // upload control to anyone else, so this only ever fires for a student in
  // practice - guarded here the same way the syllabus import route guards
  // its own single-role action.
  if (profile?.role !== "student") {
    return NextResponse.json({ error: "Only a student can parse a routine." }, { status: 403 });
  }

  let body: { imagePath?: unknown; subjectNames?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const { imagePath, subjectNames } = body;
  if (typeof imagePath !== "string" || !imagePath) {
    return NextResponse.json({ error: "No photo to parse." }, { status: 400 });
  }
  const names = Array.isArray(subjectNames) ? subjectNames.filter((n): n is string => typeof n === "string") : [];

  // No service role here - this is a student acting on their own routine
  // photo, not the cron route (CLAUDE.md: "service-role key is used only
  // inside the cron route"). The routines bucket's storage policy checks the
  // path's own student id segment against auth.uid() (storage.ts's own
  // comment), so a path that isn't this user's own simply fails to download
  // rather than needing a second check here.
  const { data: blob, error: downloadError } = await supabase.storage
    .from(ROUTINES_BUCKET)
    .download(imagePath);

  if (downloadError || !blob) {
    return NextResponse.json({ error: "The photo couldn't be read from storage." }, { status: 404 });
  }

  try {
    const image = {
      buffer: Buffer.from(await blob.arrayBuffer()),
      mimeType: mimeTypeFor(imagePath),
    };

    const raw = await parseRoutine(image, names, {
      onAttempt: () => recordGeminiCall(supabase),
    });
    return NextResponse.json({ raw });
  } catch (error) {
    // The Gemini SDK's own ApiError.message is the raw Google error body -
    // never shown as-is (CLAUDE.md's copy rule: what happened, what to do
    // next, plain language). A 429 is the one shape common enough to name
    // specifically; anything else falls back to a generic message rather
    // than leaking whatever Google's JSON happened to say this time.
    if (isQuotaExceeded(error)) {
      return NextResponse.json(
        {
          error:
            "Couldn't read the routine right now — the daily limit has been reached. It resets each afternoon, or you can fill the grid in by hand.",
        },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: "The routine photo couldn't be read." }, { status: 500 });
  }
}
