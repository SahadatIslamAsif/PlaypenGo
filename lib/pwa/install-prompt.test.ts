import { describe, expect, it } from "vitest";
import { shouldShowInstallPrompt } from "./install-prompt";

describe("shouldShowInstallPrompt", () => {
  it("never shows once already running standalone", () => {
    expect(
      shouldShowInstallPrompt({ visitCount: 5, dismissed: false, isStandalone: true }),
    ).toBe(false);
  });

  it("never shows again once dismissed", () => {
    expect(
      shouldShowInstallPrompt({ visitCount: 5, dismissed: true, isStandalone: false }),
    ).toBe(false);
  });

  it("does not show on the first visit", () => {
    expect(
      shouldShowInstallPrompt({ visitCount: 1, dismissed: false, isStandalone: false }),
    ).toBe(false);
  });

  it("shows from the second visit onward", () => {
    expect(
      shouldShowInstallPrompt({ visitCount: 2, dismissed: false, isStandalone: false }),
    ).toBe(true);
    expect(
      shouldShowInstallPrompt({ visitCount: 9, dismissed: false, isStandalone: false }),
    ).toBe(true);
  });
});
