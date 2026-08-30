import type { MetadataRoute } from "next";

// CLAUDE.md: "PWA: manifest with name: 'PlaypenGo', short_name: 'PlaypenGo',
// display: standalone, theme-color matching the wash, apple-touch-icon, and
// an add-to-home-screen prompt shown to guardians after their first visit."
// The apple-touch-icon half of that is app/apple-icon.png (Next's own file
// convention, auto-linked in <head>) - this file covers the rest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PlaypenGo",
    short_name: "PlaypenGo",
    description:
      "A running record of assessments for a Playpen School student, their guardian, and their tutor.",
    start_url: "/",
    display: "standalone",
    // --wash-from (app/globals.css) - the page background, so the splash
    // screen a standalone launch shows before first paint reads as a
    // continuation of the app rather than a flash of a different colour.
    background_color: "#edf8f1",
    theme_color: "#edf8f1",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
