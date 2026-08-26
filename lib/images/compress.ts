// Client-side image compression. Browser only — it uses canvas.
//
// Two constraints meet here. CLAUDE.md: "Supabase free storage is 1 GB —
// compress images client-side before upload", and "Weight matters on Dhaka
// mobile data". And §5: this same file is later read by Gemini, so the cap is
// set for legibility rather than for weight alone. A 4 MB phone photo of a
// routine becomes roughly 200 KB at 2000px on the long edge, and the teacher
// names under each subject are still readable.
//
// Zero dependencies. The scan flow of Phase 5 is this module's second caller,
// which is why it lives in lib/images rather than lib/routines.

export type CompressOptions = {
  /** Longest edge in pixels. Below this the image is re-encoded, not upscaled. */
  maxEdge?: number;
  quality?: number;
  type?: "image/webp" | "image/jpeg";
};

export type CompressedImage = {
  blob: Blob;
  extension: string;
  width: number;
  height: number;
};

const DEFAULTS: Required<CompressOptions> = {
  maxEdge: 2000,
  quality: 0.82,
  type: "image/webp",
};

export async function compressImage(
  file: File,
  options: CompressOptions = {},
): Promise<CompressedImage> {
  const { maxEdge, quality, type } = { ...DEFAULTS, ...options };

  const bitmap = await createImageBitmap(file);

  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot process the image.");

    // Photographs of paper are downscaled, and nearest-neighbour on printed
    // text is what makes a routine unreadable.
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await toBlob(canvas, type, quality);
    return {
      blob,
      extension: blob.type === "image/webp" ? "webp" : "jpg",
      width,
      height,
    };
  } finally {
    bitmap.close();
  }
}

function toBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The image could not be processed."));
      },
      type,
      quality,
    );
  });
}
