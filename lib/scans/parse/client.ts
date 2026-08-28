// The one Gemini call for §5.3's exam-paper parse. 1-5 local image paths,
// all pages in one request in page order - "so the model can see that page 3
// belongs to page 1's header" (§5.3) - structured output only, never a text
// response parsed after the fact (CLAUDE.md).
//
// Model ID and API key come from GEMINI_MODEL / GEMINI_API_KEY, read once
// and guarded the same way scripts/seed-subjects-catalog.ts guards its own
// env vars: missing means a clear message and a thrown error, not a
// half-configured client. Neither value is logged.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { ApiError, GoogleGenAI, Type, type Schema } from "@google/genai";
import { buildPaperParsePrompt } from "./prompt";
import { buildPaperParseSchema, type GeminiSchema, type RawParse } from "./schema";
import { readParseCache, writeParseCache } from "./cache";

const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function mimeTypeFor(imagePath: string): string {
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
// schema.ts's GeminiSchema -> the installed SDK's actual Schema/Type
//
// Verified against node_modules/@google/genai/dist/genai.d.ts (v2.19.0)
// rather than trusted from documentation - Schema's fields (type, properties,
// required, items, enum, nullable, description) match schema.ts's local type
// exactly, but `type` is the SDK's own string enum (Type.OBJECT, not the
// literal "OBJECT"), which is why this conversion exists instead of a cast.
// This is the one place that import happens; schema.ts stays free of the SDK
// so its content can be reasoned about (and unit tested) without it.

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

export type ParsePaperOptions = {
  /** The subject's seeded chapter names, for the inferred_chapter enum and prompt appendix. */
  seededChapterNames?: string[];
  /** Skip the dev cache and make a live call regardless of a cached hit. */
  forceLive?: boolean;
};

// A 503 from this endpoint is Google's own "high demand, try again" - not a
// bad request and not a billing problem (a paid-only model 404s instead, it
// never 503s). Retried once, after a short pause, before this surfaces as a
// parse failure - so the fixture harness (scripts/parse-paper.ts) doesn't
// report a transient capacity blip as if the parse itself were wrong.
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
 * Parses 1-5 images of one paper into §5.3's RawParse shape. Nothing is
 * written to the database here - this is the parse alone; the human review
 * screen is what stands between this and a `results` row.
 */
export async function parsePaper(
  imagePaths: string[],
  options: ParsePaperOptions = {},
): Promise<RawParse> {
  if (imagePaths.length < 1 || imagePaths.length > 5) {
    throw new Error(`Expected 1-5 images per §5.3, got ${imagePaths.length}.`);
  }

  const seededChapterNames = options.seededChapterNames ?? [];
  const prompt = buildPaperParsePrompt(seededChapterNames);
  const imageBuffers = await Promise.all(imagePaths.map((imagePath) => readFile(imagePath)));

  if (!options.forceLive) {
    const cached = await readParseCache(imageBuffers, prompt);
    if (cached) return cached as RawParse;
  }

  const { apiKey, model } = requireEnv();
  const ai = new GoogleGenAI({ apiKey });

  const imageParts = imagePaths.map((imagePath, i) => ({
    inlineData: {
      mimeType: mimeTypeFor(imagePath),
      data: imageBuffers[i].toString("base64"),
    },
  }));

  const response = await generateContentWithRetry(ai, {
    model,
    contents: [
      {
        role: "user" as const,
        parts: [{ text: prompt }, ...imageParts],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: toSdkSchema(buildPaperParseSchema(seededChapterNames)),
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned no content for this parse.");
  }

  // Structured output, not "return ONLY JSON" text parsing (CLAUDE.md's
  // distinction): responseSchema constrains the model to emit nothing but
  // schema-conforming JSON, so this decodes a guaranteed-clean payload rather
  // than extracting JSON out of a chatty response.
  const parsed = JSON.parse(text) as RawParse;

  await writeParseCache(imageBuffers, prompt, parsed);

  return parsed;
}
