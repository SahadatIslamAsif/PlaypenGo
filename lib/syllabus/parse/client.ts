// The one Gemini call for §5.2's syllabus parse. One document (a PDF, or a
// photographed page) in one request - "one call per assessment, sequential,
// never parallel" (CLAUDE.md) applies here as "one call per document."
// Structured output only, never a text response parsed after the fact.
//
// parseSyllabus() takes bytes (DocumentInput), not a path - mirrors
// lib/scans/parse/client.ts's parsePaper() split between a CLI-only
// loadLocalDocument() and the actual parse call, so a route handler reading
// an uploaded file straight from the request body (never touching local
// disk) uses the exact same entry point a local script does.
//
// Model ID and API key come from GEMINI_MODEL / GEMINI_API_KEY, same as the
// scan pipeline - read once, guarded the same way, never logged.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { ApiError, GoogleGenAI, Type, type Schema } from "@google/genai";
import { SYLLABUS_PARSE_PROMPT } from "./prompt";
import { SYLLABUS_PARSE_SCHEMA, type GeminiSchema, type RawSyllabus } from "./schema";
import { readParseCache, writeParseCache } from "./cache";

const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function mimeTypeFor(filePath: string): string {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  const mimeType = MIME_TYPE_BY_EXTENSION[extension];
  if (!mimeType) {
    throw new Error(
      `Unsupported document extension ".${extension}" for ${filePath} - expected pdf, jpg, jpeg, png, or webp.`,
    );
  }
  return mimeType;
}

// ---------------------------------------------------------------------------
// schema.ts's GeminiSchema -> the installed SDK's actual Schema/Type. Same
// conversion as lib/scans/parse/client.ts, verified against the same
// installed @google/genai - kept as its own copy rather than a shared
// helper so this pipeline has no import into lib/scans/.

const SDK_TYPE_BY_NAME: Record<GeminiSchema["type"], Type> = {
  OBJECT: Type.OBJECT,
  ARRAY: Type.ARRAY,
  STRING: Type.STRING,
  NUMBER: Type.NUMBER,
  INTEGER: Type.INTEGER,
  BOOLEAN: Type.BOOLEAN,
};

function toSdkSchema(schema: GeminiSchema): Schema {
  return {
    type: SDK_TYPE_BY_NAME[schema.type],
    description: schema.description,
    nullable: schema.nullable,
    enum: schema.enum,
    properties: schema.properties
      ? Object.fromEntries(
          Object.entries(schema.properties).map(([key, value]) => [key, toSdkSchema(value)]),
        )
      : undefined,
    required: schema.required,
    items: schema.items ? toSdkSchema(schema.items) : undefined,
  };
}

export type ParseSyllabusOptions = {
  /** Skip the dev cache and make a live call regardless of a cached hit. */
  forceLive?: boolean;
  /**
   * Called once per real outbound call to Gemini, including a 503's retry -
   * lib/gemini/usage.ts's recordGeminiCall(), passed in by the route handler
   * (which holds the Supabase client this file doesn't depend on). Omitted
   * by every CLI caller, which is a no-op, not a broken count - those calls
   * are dev/test tooling, not what the daily quota is being protected for.
   */
  onAttempt?: () => void | Promise<void>;
};

/** One document's bytes plus the MIME type Gemini needs alongside them. */
export type DocumentInput = { buffer: Buffer; mimeType: string };

/** Reads a local file into DocumentInput - the CLI's own boundary, mirroring
 * lib/scans/parse/client.ts's loadLocalImages(). parseSyllabus() itself
 * takes already-loaded bytes, so a route handler reading an uploaded
 * File's bytes builds the same shape without touching local disk. */
export async function loadLocalDocument(filePath: string): Promise<DocumentInput> {
  return { buffer: await readFile(filePath), mimeType: mimeTypeFor(filePath) };
}

// A 503 from this endpoint is Google's own "high demand, try again" - not a
// bad request and not a billing problem. Retried once, after a short
// pause, same as the scan pipeline.
const RETRY_DELAY_MS = 5000;

function isRetryableUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 503;
}

// Not retried like 503 - a 429 means the day's quota is already spent, and a
// second attempt seconds later fails the same way. The route handler is what
// turns this into copy a person can act on (CLAUDE.md's error-copy rule);
// this is just the typed check that lets it tell a quota rejection apart
// from any other failure.
export function isQuotaExceeded(error: unknown): boolean {
  return error instanceof ApiError && error.status === 429;
}

async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI["models"]["generateContent"]>[0],
  onAttempt?: () => void | Promise<void>,
): ReturnType<GoogleGenAI["models"]["generateContent"]> {
  await onAttempt?.();
  try {
    return await ai.models.generateContent(params);
  } catch (error) {
    if (!isRetryableUnavailable(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    await onAttempt?.();
    return await ai.models.generateContent(params);
  }
}

function requireEnv(): { apiKey: string; model: string } {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;

  if (!apiKey || !model) {
    throw new Error(
      "Set GEMINI_API_KEY and GEMINI_MODEL (e.g. `tsx --env-file=.env.local`, which loads .env.local).",
    );
  }

  return { apiKey, model };
}

/**
 * Parses one syllabus document into §5.2's RawSyllabus shape. Nothing is
 * written to the database here - the caller (the import route) commits
 * straight through commit_syllabus_tree; there is no review step in
 * between for this parse (§5.2, "Why this parse skips the review screen").
 */
export async function parseSyllabus(
  document: DocumentInput,
  options: ParseSyllabusOptions = {},
): Promise<RawSyllabus> {
  const prompt = SYLLABUS_PARSE_PROMPT;

  if (!options.forceLive) {
    const cached = await readParseCache([document.buffer], prompt);
    if (cached) return cached as RawSyllabus;
  }

  const { apiKey, model } = requireEnv();
  const ai = new GoogleGenAI({ apiKey });

  const response = await generateContentWithRetry(
    ai,
    {
      model,
      contents: [
        {
          role: "user" as const,
          parts: [
            { text: prompt },
            { inlineData: { mimeType: document.mimeType, data: document.buffer.toString("base64") } },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: toSdkSchema(SYLLABUS_PARSE_SCHEMA),
      },
    },
    options.onAttempt,
  );

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned no content for this parse.");
  }

  // Structured output, not "return ONLY JSON" text parsing (CLAUDE.md's
  // distinction): responseSchema constrains the model to emit nothing but
  // schema-conforming JSON.
  const parsed = JSON.parse(text) as RawSyllabus;

  await writeParseCache([document.buffer], prompt, parsed);

  return parsed;
}
