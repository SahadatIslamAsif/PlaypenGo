"use client";

import { SwitchCamera, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// `<input capture="environment">` is only a hint, and iOS Safari has long
// been inconsistent about honouring it - sometimes opening the front camera,
// sometimes falling back to the photo picker. getUserMedia's `facingMode` is
// a browser-API-level preference instead of a device-specific one: it works
// the same way on Chrome and Safari, desktop or phone, without needing to
// know the model. This hook tries that first and only falls back to the
// plain file input - which still works today on browsers that do honour the
// hint, and is the only option left on one with no camera API at all, or
// that refuses permission - when getUserMedia isn't available or fails.
//
// Callers keep their own trigger button exactly as before; only the
// onClick target changes, from `inputRef.current?.click()` to `open()`.
// Render `modal` once, anywhere in the tree, and spread `fallbackInputProps`
// onto the same hidden `<input type="file">` the caller already has.

type Facing = "environment" | "user";

export function useCameraCapture(onCapture: (file: File) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const [live, setLive] = useState(false);
  const [facing, setFacing] = useState<Facing>("environment");

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  // The camera light has to go off on unmount regardless of what state this
  // was left in - a tab navigation away is not a "Cancel" click.
  useEffect(() => stopStream, []);

  async function startStream(nextFacing: Facing) {
    stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: nextFacing } },
        audio: false,
      });
      streamRef.current = stream;
      setFacing(nextFacing);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setLive(true);
    } catch {
      // No camera, permission refused, or no getUserMedia support at all.
      setLive(false);
      fallbackInputRef.current?.click();
    }
  }

  function open() {
    if (!navigator.mediaDevices?.getUserMedia) {
      fallbackInputRef.current?.click();
      return;
    }
    void startStream("environment");
  }

  function close() {
    stopStream();
    setLive(false);
  }

  function flip() {
    void startStream(facing === "environment" ? "user" : "environment");
  }

  function capture() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          onCapture(new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" }));
        }
        close();
      },
      "image/jpeg",
      0.92,
    );
  }

  const fallbackInputProps = {
    ref: fallbackInputRef,
    type: "file" as const,
    accept: "image/*",
    capture: "environment" as const,
    className: "hidden",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onCapture(file);
      e.target.value = "";
    },
  };

  const modal = live ? (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-ink"
      role="dialog"
      aria-modal="true"
      aria-label="Camera"
    >
      <div className="flex justify-end p-4">
        <button
          type="button"
          onClick={close}
          aria-label="Cancel"
          className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-surface text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X className="h-5 w-5" strokeWidth={1.5} />
        </button>
      </div>

      <video ref={videoRef} autoPlay playsInline muted className="min-h-0 flex-1 object-contain" />

      <div className="flex items-center justify-center gap-8 p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <span className="h-11 w-11" aria-hidden="true" />
        <button
          type="button"
          onClick={capture}
          aria-label="Capture"
          className="h-16 w-16 rounded-full border-4 border-white bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        />
        <button
          type="button"
          onClick={flip}
          aria-label="Switch camera"
          className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-surface text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <SwitchCamera className="h-5 w-5" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  ) : null;

  return { open, modal, fallbackInputProps };
}
