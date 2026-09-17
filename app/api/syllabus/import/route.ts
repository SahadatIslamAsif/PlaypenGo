import { NextResponse } from "next/server";
import { recordGeminiCall } from "@/lib/gemini/usage";
import { isQuotaExceeded, parseSyllabus } from "@/lib/syllabus/parse/client";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

// §5.2: the syllabus parse skips the review screen entirely, so there is no
// scan_jobs-shaped staging table for it — this route is upload, parse, and
// commit_syllabus_tree in one request. The document is never written to
// Storage; its bytes live only in this request's memory and are gone once
// it returns. A single multi-page document fits the same 60s budget CLAUDE.md
// already gives a multi-image scan call.
export const maxDuration = 60;

const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

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
    .select("role, session_label")
    .eq("id", user.id)
    .single();

  // commit_syllabus_tree (0009) also authorizes an approved tutor for
  // another student, but there is no tutor-facing surface onto this route
  // yet (subjects/page.tsx redirects a tutor away entirely - Phase 7's
  // roster is what will give a tutor a student to import for). Until that
  // exists, this route only ever imports the caller's own tree, so it
  // matches §3.3's posture for scanning too: the student is the one who
  // uploads.
  if (profile?.role !== "student") {
    return NextResponse.json({ error: "Only a student can import a syllabus." }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Upload a PDF or a photo of the syllabus (PDF, JPG, PNG, or WEBP)." },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // §3.2: session_label scopes what a re-import can and can't touch (0029) -
  // it comes from the student's own profile, never from text the parse
  // happened to read off the document.
  const sessionLabel = profile.session_label ?? "2026-2027";

  let raw;
  try {
    raw = await parseSyllabus(
      { buffer, mimeType: file.type },
      { onAttempt: () => recordGeminiCall(supabase) },
    );
  } catch (error) {
    // The Gemini SDK's own ApiError.message is the raw Google error body -
    // never shown as-is (CLAUDE.md's copy rule). A 429 is the one shape
    // common enough to name specifically; anything else falls back to a
    // generic message rather than leaking whatever Google's JSON said.
    if (isQuotaExceeded(error)) {
      return NextResponse.json(
        {
          error:
            "Couldn't read the syllabus right now — the daily limit has been reached. It resets each afternoon, or add the subjects and chapters by hand.",
        },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: "The syllabus couldn't be read." }, { status: 502 });
  }

  if (raw.subjects.length === 0) {
    return NextResponse.json(
      { error: "Nothing readable came out of that document." },
      { status: 422 },
    );
  }

  // commit_syllabus_tree reads only `semester` and `subjects` off p_tree
  // (§3.2) - class_level/session are the parse's own informational fields,
  // not part of the commit contract.
  const tree = {
    semester: raw.semester,
    subjects: raw.subjects.map((subject) => ({
      name: subject.name,
      chapters: subject.chapters,
      papers: subject.papers,
    })),
  };

  const { data, error } = await supabase.rpc("commit_syllabus_tree", {
    p_student: user.id,
    p_tree: tree as unknown as Json,
    p_session: sessionLabel,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ result: data });
}
