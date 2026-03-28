/**
 * Image generation via Replicate Flux Schnell.
 * Generates hero images, banners, and asset images for generated apps.
 *
 * Cost: ~$0.003 per image (Flux Schnell)
 * Speed: ~1.5-2s warm, 15-20s cold start
 */
import Replicate from "replicate";

let _client: Replicate | null = null;

function getClient(): Replicate | null {
  if (_client) return _client;
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return null;
  _client = new Replicate({ auth: token });
  return _client;
}

export interface ImageRequest {
  prompt: string;
  aspect_ratio?: "1:1" | "16:9" | "9:16" | "3:2" | "2:3" | "4:5" | "5:4";
  filename: string; // e.g. "hero-image.webp"
}

export interface GeneratedImage {
  filename: string;
  url: string;       // Replicate CDN URL
  base64?: string;   // base64-encoded data for embedding
}

/**
 * Generate a single image using Flux Schnell.
 * Returns null if Replicate is not configured.
 */
export async function generateImage(request: ImageRequest): Promise<GeneratedImage | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const output = await client.run("black-forest-labs/flux-schnell", {
      input: {
        prompt: request.prompt,
        aspect_ratio: request.aspect_ratio ?? "16:9",
        num_outputs: 1,
        output_format: "webp",
        output_quality: 80,
      },
    }) as unknown[];

    const result = output[0];
    if (!result) return null;

    // Result can be a URL string or a ReadableStream/FileOutput
    const url = typeof result === "string" ? result : String(result);

    return {
      filename: request.filename,
      url,
    };
  } catch (err) {
    console.error(`[imageGen] Failed to generate "${request.filename}":`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Generate multiple images in parallel.
 * Skips failures gracefully — returns only successful images.
 */
export async function generateImages(requests: ImageRequest[]): Promise<GeneratedImage[]> {
  if (!getClient()) return [];
  const results = await Promise.allSettled(requests.map(generateImage));
  return results
    .filter((r): r is PromiseFulfilledResult<GeneratedImage | null> => r.status === "fulfilled")
    .map(r => r.value)
    .filter((img): img is GeneratedImage => img !== null);
}

/**
 * Edit/modify an existing image using Flux Dev img2img.
 * Takes a source image URL and a prompt describing the desired changes.
 */
export async function editImage(
  sourceUrl: string,
  prompt: string,
  filename: string,
  strength?: number,
): Promise<GeneratedImage | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const output = await client.run("black-forest-labs/flux-dev", {
      input: {
        prompt,
        image: sourceUrl,
        strength: strength ?? 0.75,
        num_outputs: 1,
        output_format: "webp",
        output_quality: 80,
      },
    }) as unknown[];

    const result = output[0];
    if (!result) return null;
    const url = typeof result === "string" ? result : String(result);
    return { filename, url };
  } catch (err) {
    console.error(`[imageEdit] Failed to edit "${filename}":`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Merge/combine multiple images based on a prompt.
 */
export async function mergeImages(
  sourceUrls: string[],
  prompt: string,
  filename: string,
): Promise<GeneratedImage | null> {
  const client = getClient();
  if (!client) return null;

  try {
    // Use the first image as base with the others described in the prompt
    const output = await client.run("black-forest-labs/flux-dev", {
      input: {
        prompt: `${prompt}. Combine and blend the provided images seamlessly.`,
        image: sourceUrls[0],
        strength: 0.65,
        num_outputs: 1,
        output_format: "webp",
        output_quality: 80,
      },
    }) as unknown[];

    const result = output[0];
    if (!result) return null;
    const url = typeof result === "string" ? result : String(result);
    return { filename, url };
  } catch (err) {
    console.error(`[imageMerge] Failed to merge for "${filename}":`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Check if image generation is available (REPLICATE_API_TOKEN is set).
 */
export function isImageGenAvailable(): boolean {
  return !!process.env.REPLICATE_API_TOKEN;
}
