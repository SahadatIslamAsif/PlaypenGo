// The decision behind CLAUDE.md's "add-to-home-screen prompt shown to
// guardians after their first visit." Pulled out of the client component so
// the "after their first visit, not the first, and only once" rule has a
// unit test independent of localStorage/matchMedia/beforeinstallprompt.

export function shouldShowInstallPrompt(input: {
  /** Including the current one - the component increments before deciding. */
  visitCount: number;
  dismissed: boolean;
  /** Already launched from the home screen - nothing to prompt for. */
  isStandalone: boolean;
}): boolean {
  if (input.isStandalone) return false;
  if (input.dismissed) return false;
  // "After their first visit" - not on it. A guardian's first click from an
  // email link is not the moment to interrupt with an install pitch before
  // they've seen anything the app is for.
  return input.visitCount >= 2;
}
