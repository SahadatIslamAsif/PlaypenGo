// §5.2/CLAUDE.md: "Caching parses by image hash in development means
// prompt iteration doesn't burn the free tier." Same idiom as
// lib/scans/parse/cache.ts, kept as its own copy (own cache directory) so
// the two pipelines stay independent rather than sharing an import for
// something this small.
//
// Keyed by sha256(document bytes + prompt), in that order - editing
// prompt.ts invalidates every cached entry, which is the point: a stale
// cache agreeing with an old prompt would look exactly like a passing test.
//
// Dev only. Never reads or writes in production.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const CACHE_DIR = path.join(process.cwd(), ".cache", "gemini-parse-syllabus");

function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

function cacheKey(documentBuffers: Buffer[], prompt: string): string {
  const hash = createHash("sha256");
  for (const buffer of documentBuffers) hash.update(buffer);
  hash.update(prompt);
  return hash.digest("hex");
}

export async function readParseCache(
  documentBuffers: Buffer[],
  prompt: string,
): Promise<unknown | null> {
  if (!isDev()) return null;

  const key = cacheKey(documentBuffers, prompt);
  try {
    const raw = await readFile(path.join(CACHE_DIR, `${key}.json`), "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    // Missing file, unreadable, or invalid JSON - all the same "no cache
    // entry" outcome. A corrupt cache file should never fail a parse; it
    // should just be treated as absent and overwritten.
    return null;
  }
}

export async function writeParseCache(
  documentBuffers: Buffer[],
  prompt: string,
  value: unknown,
): Promise<void> {
  if (!isDev()) return;

  const key = cacheKey(documentBuffers, prompt);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(value, null, 2), "utf8");
}
