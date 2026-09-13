import { z } from "zod";

const schema = z.object({
  /** Full data URL of the original image */
  image: z.string().min(32),
  /** Full data URL of the same image with paint strokes and/or target markers */
  marked: z.string().min(32),
  /** How many tap markers were placed */
  points: z.number().int().min(0).max(20),
  /** Whether freehand paint strokes were used */
  hasPaint: z.boolean(),
});

export type RemoveObjectInput = z.infer<typeof schema>;

/** Extract raw base64 data (strip the data: prefix) */
function stripDataUrl(url: string): { data: string; mimeType: string } {
  const match = url.match(/^data:(image\/[\w+]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid image data URL.");
  return { data: match[2], mimeType: match[1] };
}

const IMAGE_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image",
  "gemini-3.1-flash-lite-image",
  "gemini-3-pro-image",
];

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

function parseRetryDelayMs(payload: any, headers: Headers): number {
  const details = payload?.error?.details;
  if (Array.isArray(details)) {
    for (const d of details) {
      if (d?.retryDelay) {
        const sec = parseFloat(String(d.retryDelay).replace("s", ""));
        if (!isNaN(sec) && sec > 0) return Math.ceil(sec * 1000);
      }
    }
  }

  const msg = payload?.error?.message ?? "";
  const match = msg.match(/retry in ([0-9.]+)\s*s/i);
  if (match) {
    const sec = parseFloat(match[1]);
    if (!isNaN(sec) && sec > 0) return Math.ceil(sec * 1000);
  }

  const header = headers.get("Retry-After");
  if (header) {
    const sec = parseInt(header, 10);
    if (!isNaN(sec) && sec > 0) return sec * 1000;
  }

  return 10000;
}

function isZeroQuotaError(payload: any): boolean {
  const msg = payload?.error?.message ?? "";
  return msg.includes("limit: 0") || msg.includes("limit: 0,");
}

/**
 * Client-side object removal using Google Gemini API.
 *
 * Uses Gemini image editing models (Nano Banana) with automatic
 * retries and countdown timers for rate limits (429).
 */
export async function removeObject(
  data: RemoveObjectInput,
  onStatusUpdate?: (status: string) => void,
): Promise<{ image: string }> {
  const parsed = schema.parse(data);

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "AI is not configured. Set VITE_GEMINI_API_KEY in your .env file. Get a free key at https://aistudio.google.com/apikey",
    );
  }

  const targets: string[] = [];
  if (parsed.points > 0) {
    targets.push(
      `The second image has ${parsed.points} magenta target marker${parsed.points > 1 ? "s" : ""} (a ring with a centre dot and a number). Each marker points at ONE object. Work out for yourself where that object begins and ends — its full silhouette, including parts far outside the ring, plus its cast shadow, reflection and anything it is holding or standing on that belongs to it. Remove the entire object, not just the area inside the ring. Do not remove anything else in the scene.`,
    );
  }
  if (parsed.hasPaint) {
    targets.push(
      "The second image also has translucent magenta paint over regions. Remove everything under the paint.",
    );
  }

  const prompt = [
    "You are a professional photo retoucher performing generative fill (inpainting).",
    "The FIRST image is the clean original photo. The SECOND image is the same photo with magenta annotations added.",
    ...targets,
    "Reconstruct what would realistically be behind the removed subjects: continue background textures, patterns, edges, grass, paving lines, shadows, reflections and lighting so the result looks like they were never there.",
    "Do NOT output any magenta, markers, rings or numbers. Do not blur, smear, patch with flat colour, or leave ghosting or silhouettes.",
    "Keep every other pixel identical to the original: same framing, same aspect ratio, same resolution, same colour grading, same grain.",
    "Return only the final edited photograph.",
  ].join(" ");

  const original = stripDataUrl(parsed.image);
  const marked = stripDataUrl(parsed.marked);

  let lastHumanError = "";

  for (const model of IMAGE_MODELS) {
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: prompt },
                    { inline_data: { mime_type: original.mimeType, data: original.data } },
                    { inline_data: { mime_type: marked.mimeType, data: marked.data } },
                  ],
                },
              ],
              generationConfig: {
                responseModalities: ["TEXT", "IMAGE"],
              },
            }),
          },
        );

        let payload: any = null;
        try {
          payload = await res.json();
        } catch {
          // Non-JSON response
        }

        if (res.ok && payload) {
          const parts = payload.candidates?.[0]?.content?.parts ?? [];
          const imagePart = parts.find(
            (p: any) => "inlineData" in p || "inline_data" in p,
          );

          const inlineData = imagePart?.inlineData ?? imagePart?.inline_data;
          const b64 = inlineData?.data;

          if (b64) {
            const mimeType = inlineData?.mimeType ?? "image/jpeg";
            return { image: `data:${mimeType};base64,${b64}` };
          }

          if (payload.error?.message) {
            lastHumanError = payload.error.message;
          }
        } else {
          if (res.status === 403) {
            throw new Error(
              "API key invalid or billing not enabled for image generation.",
            );
          }

          if (
            payload?.error?.message?.includes("not available in your country")
          ) {
            throw new Error(
              "Google AI Studio image generation (Nano Banana) is not supported in your country/region by Google. Turn on a US VPN to use it.",
            );
          }

          if (res.status === 404) {
            // Skip unavailable model
            break;
          }

          if (res.status === 429) {
            if (isZeroQuotaError(payload)) {
              throw new Error(
                "Image generation quota is set to 0 on this Google AI Studio project. Enable Pay-As-You-Go billing or create an API key in a project with image generation quota enabled.",
              );
            }

            const delayMs = parseRetryDelayMs(payload, res.headers);
            const totalSec = Math.ceil(delayMs / 1000);

            for (let sec = totalSec; sec > 0; sec--) {
              onStatusUpdate?.(
                `Rate limit reached on free tier. Retrying automatically in ${sec}s…`,
              );
              await sleep(1000);
            }
            continue;
          }

          if (res.status >= 500) {
            onStatusUpdate?.("AI service busy, retrying in a moment…");
            await sleep(3000);
            continue;
          }

          if (payload?.error?.message) {
            lastHumanError = payload.error.message;
          }
        }
      } catch (err: any) {
        if (
          err.message?.includes("API key invalid") ||
          err.message?.includes("Quota") ||
          err.message?.includes("quota")
        ) {
          throw err;
        }
      }
    }
  }

  throw new Error(
    lastHumanError ||
      "Rate limit reached on Gemini free tier. Please wait 20–30 seconds and try again.",
  );
}
