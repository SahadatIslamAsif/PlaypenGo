"use client";

import { useEffect } from "react";

// Catches a throw in the root layout itself, or anywhere in the top-level
// routes outside the (app) shell (/login, /signup/*) that has no closer
// error.tsx of its own. Next replaces the entire root layout to render this,
// so - per Next's own file-convention doc - it gets none of app/globals.css,
// no Tailwind utilities, no theme toggle: hence plain inline styles, light
// values only, matching app/globals.css's --wash/--ink/--accent tokens by
// hand rather than trying to reach classes that may not be loaded.
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(160deg, #edf8f1, #dcf0e4)",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', sans-serif",
          padding: "24px",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 384,
            textAlign: "center",
            background: "#ffffff",
            border: "1px solid #dbe7e0",
            borderRadius: 24,
            padding: 32,
            boxShadow: "0 12px 32px rgba(14,26,20,0.12)",
          }}
        >
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#0e1a14" }}>
            PlaypenGo didn&apos;t load
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 14, color: "#5b6b62" }}>
            Something went wrong. Check your connection and try again.
          </p>
          <button
            type="button"
            onClick={retry}
            style={{
              marginTop: 20,
              width: "100%",
              height: 44,
              borderRadius: 12,
              border: "none",
              background: "#0e1a14",
              color: "#ffffff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
