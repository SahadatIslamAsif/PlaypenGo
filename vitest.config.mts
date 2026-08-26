import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mirrors tsconfig.json's `paths: { "@/*": ["./*"] }`. Phase 3's tests never
// needed it — everything imported with relative paths inside lib/routines —
// but lib/assessments reuses lib/routines' schedule and grid modules via the
// "@/" alias, the same way the app code does, so vitest has to resolve it too.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "."),
    },
  },
});
