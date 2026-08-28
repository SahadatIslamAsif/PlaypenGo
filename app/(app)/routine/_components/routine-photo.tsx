"use client";

import { Camera, X } from "lucide-react";
import { useRef, useState } from "react";
import { compressImage } from "@/lib/images/compress";
import { routineImagePath, ROUTINES_BUCKET } from "@/lib/routines/storage";
import { createClient } from "@/lib/supabase/client";

// The photo of the printed routine, kept beside the grid it was typed from.
//
// Phase 3 stores it and shows it; nothing reads it yet. Phase 5 sends this same
// file to Gemini (§5.1), which is why compress.ts caps the long edge for
// legibility rather than purely for weight.
//
// The bytes go browser -> bucket directly. The server never handles them, and
// the storage policies in migration 0010 are what authorise the write: the path
// starts with the student's id, which is the only thing storage_owner() reads.

export function RoutinePhoto({
  studentId,
  routineId,
  signedUrl,
  editable,
  onUploaded,
}: {
  studentId: string;
  routineId: string;
  signedUrl: string | null;
  editable: boolean;
  onUploaded: (path: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);

  const shown = preview ?? signedUrl;

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const compressed = await compressImage(file);
      const path = routineImagePath(studentId, routineId, compressed.extension);

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(ROUTINES_BUCKET)
        .upload(path, compressed.blob, {
          contentType: compressed.blob.type,
          upsert: true,
        });

      if (uploadError) {
        setError("The photo didn't upload. Check your connection and try again.");
        return;
      }

      setPreview(URL.createObjectURL(compressed.blob));
      onUploaded(path);
    } catch {
      setError("That file couldn't be read as an image.");
    } finally {
      setBusy(false);
    }
  }

  if (!shown && !editable) return null;

  return (
    <>
      <div className="flex items-center gap-3">
        {shown ? (
          <button
            type="button"
            onClick={() => setZoomed(true)}
            aria-label="Open the routine photo full screen"
            className="relative h-16 w-16 shrink-0 overflow-hidden rounded-tint border border-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {/* Signed URLs and blob URLs are both remote to next/image, and the
                thumbnail is small — plain img keeps the loader out of it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={shown}
              alt="The printed class routine"
              className="h-full w-full object-cover"
            />
          </button>
        ) : null}

        {editable ? (
          <div className="flex min-w-0 flex-col gap-1">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="inline-flex h-11 items-center gap-2 rounded-button border border-hairline bg-surface px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-sunk disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Camera className="h-4 w-4" strokeWidth={1.5} />
              {busy ? "Uploading…" : shown ? "Replace photo" : "Add a photo"}
            </button>
            <p className="text-xs text-muted">
              Keep the printed routine beside the grid.
            </p>
          </div>
        ) : null}

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          // Straight to the camera on a phone, per the mobile scan rules — the
          // student is photographing a routine on the wall, not picking a file.
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {zoomed && shown ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/90 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Routine photo"
          onClick={() => setZoomed(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shown}
            alt="The printed class routine"
            className="max-h-full max-w-full object-contain"
          />
          <button
            type="button"
            onClick={() => setZoomed(false)}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-[14px] bg-surface text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-5 w-5" strokeWidth={1.5} />
          </button>
        </div>
      ) : null}
    </>
  );
}
