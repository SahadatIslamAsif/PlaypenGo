// §5.3: "Cache parses by image hash in development so prompt iteration
// doesn't burn the free tier." Keyed by sha256(image bytes... + prompt), in
// that order, so the images alone don't determine the key - editing
// prompt.ts invalidates every cached entry, which is the point: a stale
// cache agreeing with an old prompt would look exactly like a passing test.
//
// Dev only. Never reads or writes in production - there is no reason a
// deployed app should ever hit this path, and NODE_ENV is the same guard
// the rest of the ecosystem uses, not a bespoke flag to remember.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const CACHE_DIR = path.join(process.cwd(), ".cache", "gemini-parse");

function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

function cacheKey(imageBuffers: Buffer[], prompt: string): string {
  const hash = createHash("sha256");
  for (const buffer of imageBuffers) hash.update(buffer);
  hash.update(prompt);
  return hash.digest("hex");
}

export async function readParseCache(
  imageBuffers: Buffer[],
  prompt: string,
): Promise<unknown | null> {
  if (!isDev()) return null;

  const key = cacheKey(imageBuffers, prompt);
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
  imageBuffers: Buffer[],
  prompt: string,
  value: unknown,
): Promise<void> {
  if (!isDev()) return;

  const key = cacheKey(imageBuffers, prompt);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(value, null, 2), "utf8");
}
