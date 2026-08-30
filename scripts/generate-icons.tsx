// One-off generator for the PWA icon set (CLAUDE.md: "manifest with name:
// 'PlaypenGo' ... apple-touch-icon"). Not a build step - run once with
// `npx tsx scripts/generate-icons.ts` whenever the mark changes, and commit
// the resulting PNGs in public/. Uses next/og's ImageResponse (satori +
// resvg) exactly the way app/icon.tsx would, just invoked standalone so the
// bytes can be written straight to public/ instead of served from a route -
// keeps the manifest's icon URLs plain static files, no generated-route id
// scheme to keep in sync.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";

const ACCENT = "#1b7a50";

function mark(size: number, cornerRadius: number) {
  return (
    <div
      style={{
        width: size,
        height: size,
        background: ACCENT,
        borderRadius: cornerRadius,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          fontFamily: "sans-serif",
          fontSize: size * 0.56,
          fontWeight: 700,
          color: "#ffffff",
        }}
      >
        P
      </div>
    </div>
  );
}

async function render(size: number, cornerRadius: number, filename: string) {
  const response = new ImageResponse(mark(size, cornerRadius), { width: size, height: size });
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(join(process.cwd(), "public", filename), buffer);
  console.log(`wrote public/${filename}`);
}

async function main() {
  // Standard maskable/any icons for the manifest.
  await render(192, 40, "icon-192.png");
  await render(512, 104, "icon-512.png");
  // Apple auto-rounds the corners itself - a pre-rounded apple-touch-icon
  // double-rounds and looks wrong, so this one is a flat square.
  await render(180, 0, "apple-touch-icon.png");
}

main();
