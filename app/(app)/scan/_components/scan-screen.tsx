"use client";

import { Camera, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { compressImage } from "@/lib/images/compress";
import { PageStrip } from "./page-strip";

// Static preview pass: capture, compress, and hold pages in memory only.
// No Supabase import anywhere in this file - no scan_jobs row, no bucket
// upload, no status change. That wiring is the next pass, once this
// screen's shape has been judged. See docs/SPEC.md §5.3 and the Mobile
// section of CLAUDE.md for the flow this reproduces: "Capture → thumbnail
// strip → Add page → Done... the strip carries a same paper / new paper
// toggle."

const MAX_PAGES = 5;

export type CapturedPage = {
  id: string;
  blob: Blob; // future upload payload - unused this pass beyond being held
  extension: string;
  width: number;
  height: number;
  previewUrl: string;
  /** Ignored for index 0. Authored per page, never derived from a
   * neighbour - see page-strip.tsx. */
  sameAsPrevious: boolean;
};

export function ScanScreen({ studentId: _studentId }: { studentId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomedId, setZoomedId] = useState<string | null>(null);

  const atCap = pages.length >= MAX_PAGES;
  const zoomedPage = pages.find((p) => p.id === zoomedId) ?? null;

  async function handleCapture(file: File) {
    if (atCap) return; // defense-in-depth - the trigger button is already disabled at cap
    setCapturing(true);
    setError(null);
    try {
      const compressed = await compressImage(file); // defaults only, same call as routine-photo.tsx
      setPages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          blob: compressed.blob,
          extension: compressed.extension,
          width: compressed.width,
          height: compressed.height,
          previewUrl: URL.createObjectURL(compressed.blob),
          sameAsPrevious: true,
        },
      ]);
    } catch {
      setError("That file couldn't be read as an image.");
    } finally {
      setCapturing(false);
    }
  }

  function toggleSame(id: string) {
    setPages((prev) =>
      prev.map((p) => (p.id === id ? { ...p, sameAsPrevious: !p.sameAsPrevious } : p)),
    );
  }

  function removePage(id: string) {
    setPages((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
    setZoomedId(null);
  }

  function handleDone() {
    // Upload + scan_jobs wiring lands in the next pass.
  }

  return (
    <div className="flex flex-col gap-5 pb-24 lg:pb-0">
      <div>
        <h1 className="font-display text-xl font-semibold text-ink">Scan a paper</h1>
        <p className="mt-1 text-sm text-muted">
          Capture every page in order. Up to 5 pages, one paper at a time.
        </p>
      </div>

      <PageStrip pages={pages} onToggleSame={toggleSame} onZoom={setZoomedId} />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={capturing || atCap}
          className="inline-flex h-11 items-center gap-2 rounded-button border border-hairline bg-surface px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-sunk disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Camera className="h-4 w-4" strokeWidth={1.5} />
          Add page
        </button>
        <p className="text-xs text-muted">
          {capturing ? "Adding…" : atCap ? "Limit reached" : `${pages.length} of ${MAX_PAGES} pages`}
        </p>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleCapture(file);
            e.target.value = "";
          }}
        />
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="fixed inset-x-0 bottom-14 z-20 border-t border-hairline bg-surface p-4 [padding-bottom:env(safe-area-inset-bottom)] sm:static sm:border-0 sm:bg-transparent sm:p-0">
        <Button
          type="button"
          onClick={handleDone}
          disabled={pages.length === 0}
          className="w-full sm:w-auto"
        >
          Done
        </Button>
      </div>

      {zoomedPage ? (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-ink/90 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Captured page"
          onClick={() => setZoomedId(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomedPage.previewUrl}
            alt="Captured page, full screen"
            className="max-h-[70vh] max-w-full object-contain"
          />
          <Button
            type="button"
            variant="destructive"
            onClick={(e) => {
              e.stopPropagation();
              removePage(zoomedPage.id);
            }}
          >
            Remove page
          </Button>
          <button
            type="button"
            onClick={() => setZoomedId(null)}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-[14px] bg-surface text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-5 w-5" strokeWidth={1.5} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
