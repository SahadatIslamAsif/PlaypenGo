// The one Gemini call for §5.1's routine parse. One photo, one request -
// "one call per assessment, sequential, never parallel" (CLAUDE.md) applies
// here as one call per routine. Structured output only, never a text
// response parsed after the fact.
//
// parseRoutine() takes bytes (ImageInput), not a path - mirrors
// lib/scans/parse/client.ts's parsePaper() split: a route handler downloads
// the already-uploaded photo from the routines bucket (RoutinePhoto.tsx
// uploads browser -> storage directly, per its own header comment) and
// builds the same shape a local script would from a file.
//
// Model ID and API key come from GEMINI_MODEL / GEMINI_API_KEY, same as
// every other pipeline - read once, guarded the same way, never logged.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { ApiError, GoogleGenAI, Type, type Schema } from "@google/genai";
import { buildRoutineParsePrompt } from "./prompt";
import { buildRoutineParseSchema, type GeminiSchema, type RawRoutineParse } from "./schema";
import { readParseCache, writeParseCache } from "./cache";

const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function mimeTypeFor(imagePath: string): string {
  const extension = path.extname(imagePath).slice(1).toLowerCase();
  const mimeType = MIME_TYPE_BY_EXTENSION[extension];
  if (!mimeType) {
    throw new Error(
      `Unsupported image extension ".${extension}" for ${imagePath} - expected jpg, jpeg, png, or webp.`,
    );
  }
  return mimeType;
}

// ---------------------------------------------------------------------------
// schema.ts's GeminiSchema -> the installed SDK's actual Schema/Type. Same
// conversion as every other pipeline's client.ts - kept as its own copy
// rather than a shared helper so this pipeline has no import into
// lib/scans/ or lib/syllabus/.

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

export type ParseRoutineOptions = {
  /** Skip the dev cache and make a live call regardless of a cached hit. */
  forceLive?: boolean;
};

/** The photo's bytes plus the MIME type Gemini needs alongside them. */
export type ImageInput = { buffer: Buffer; mimeType: string };

/** Reads a local file into ImageInput - the CLI's own boundary, mirroring
 * lib/scans/parse/client.ts's loadLocalImages(). parseRoutine() itself takes
 * already-loaded bytes, so a route handler downloading from Supabase Storage
 * builds the same shape without touching local disk. */
export async function loadLocalImage(imagePath: string): Promise<ImageInput> {
  return { buffer: await readFile(imagePath), mimeType: mimeTypeFor(imagePath) };
}

// A 503 from this endpoint is Google's own "high demand, try again" - not a
// bad request and not a billing problem. Retried once, after a short pause,
// same as every other pipeline.
const RETRY_DELAY_MS = 5000;

function isRetryableUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 503;
}

async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI["models"]["generateContent"]>[0],
): ReturnType<GoogleGenAI["models"]["generateContent"]> {
  try {
    return await ai.models.generateContent(params);
  } catch (error) {
    if (!isRetryableUnavailable(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
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
 * Parses one routine photo into §5.1's RawRoutineParse shape. Nothing is
 * written to the database here - this is the parse alone. The draft grid
 * (RoutineScreen's "draft" mode, lib/routines/grid.ts) is §5.1's review
 * screen: every field it fills stays editable until "Save routine."
 */
export async function parseRoutine(
  image: ImageInput,
  subjectNames: string[],
  options: ParseRoutineOptions = {},
): Promise<RawRoutineParse> {
  const prompt = buildRoutineParsePrompt(subjectNames);

  if (!options.forceLive) {
    const cached = await readParseCache([image.buffer], prompt);
    if (cached) return cached as RawRoutineParse;
  }

  const { apiKey, model } = requireEnv();
  const ai = new GoogleGenAI({ apiKey });

  const response = await generateContentWithRetry(ai, {
    model,
    contents: [
      {
        role: "user" as const,
        parts: [
          { text: prompt },
          { inlineData: { mimeType: image.mimeType, data: image.buffer.toString("base64") } },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: toSdkSchema(buildRoutineParseSchema(subjectNames)),
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned no content for this parse.");
  }

  // Structured output, not "return ONLY JSON" text parsing (CLAUDE.md's
  // distinction): responseSchema constrains the model to emit nothing but
  // schema-conforming JSON.
  const parsed = JSON.parse(text) as RawRoutineParse;

  await writeParseCache([image.buffer], prompt, parsed);

  return parsed;
}
