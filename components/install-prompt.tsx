"use client";

import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { shouldShowInstallPrompt } from "@/lib/pwa/install-prompt";

const VISITS_KEY = "playpengo:install-prompt-visits";
const DISMISSED_KEY = "playpengo:install-prompt-dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * CLAUDE.md: "an add-to-home-screen prompt shown to guardians after their
 * first visit." Only ever rendered for a guardian (app/(app)/layout.tsx
 * gates that) - a student or tutor is a returning, invested user by the
 * time they'd see this anyway, and CLAUDE.md names the guardian
 * specifically because they're the one most likely to arrive once from an
 * email link and never come back to install it any other way.
 *
 * Android/Chrome fires `beforeinstallprompt`, which this captures and
 * replays on tap. iOS Safari never fires it - there is no programmatic
 * install there - so that path gets manual Share-sheet instructions
 * instead, detected once at mount rather than by feature-testing the event
 * (which never arrives to say "no").
 */
export function InstallPrompt() {
  // One combined state, set once - not two effects each triggering their
  // own render. `display` stays null (rendering nothing) until the
  // browser-only checks below have actually run; there is no SSR-safe value
  // for "is this iOS" or "is this already installed" to initialize with.
  const [display, setDisplay] = useState<{ visible: boolean; ios: boolean } | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    let dismissed = false;
    let visitCount = 1;
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) === "1";
      visitCount = Number(localStorage.getItem(VISITS_KEY) ?? "0") + 1;
      localStorage.setItem(VISITS_KEY, String(visitCount));
    } catch {
      // Private browsing or storage blocked - fall back to "don't show",
      // never crash the shell over an install nudge.
      return;
    }

    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari's own flag - it never matches the media query above.
      (navigator as unknown as { standalone?: boolean }).standalone === true;

    if (!shouldShowInstallPrompt({ visitCount, dismissed, isStandalone })) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only detection (localStorage, matchMedia, navigator); there is no SSR-safe value to initialize with, same as ThemeToggle's mount guard.
    setDisplay({ visible: true, ios: /iphone|ipad|ipod/i.test(navigator.userAgent) });

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  function dismiss() {
    setDisplay(null);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Nothing to fall back to - worst case it asks again next visit.
    }
  }

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    dismiss();
  }

  if (!display?.visible) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-3 z-40 flex items-center gap-3 rounded-card border border-hairline bg-surface p-3 shadow-elevated [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))] sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-80 sm:[padding-bottom:0.75rem]"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-tint-mint text-tint-ink">
        <Download className="h-[18px] w-[18px]" strokeWidth={1.5} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">Install PlaypenGo</p>
        <p className="mt-0.5 text-xs text-muted">
          {display.ios
            ? "Tap the Share icon, then \"Add to Home Screen.\""
            : "Add it to your home screen for one-tap access."}
        </p>
        {!display.ios && deferredPrompt ? (
          <button
            type="button"
            onClick={install}
            className="mt-2 h-8 rounded-button bg-ink px-3 text-xs font-medium text-shell transition-colors hover:bg-ink/90"
          >
            Install
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-button text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <X className="h-4 w-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}
