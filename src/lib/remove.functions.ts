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

/**
 * Client-side object removal using Google Gemini API (free tier).
 *
 * Uses the gemini-2.5-flash-image model (Nano Banana) which supports
 * image editing / inpainting. Free tier allows ~500 requests/day.
 *
 * Requires VITE_GEMINI_API_KEY to be set at build time (in .env).
 * Get a free key at https://aistudio.google.com/apikey
 */
export async function removeObject(
  data: RemoveObjectInput,
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

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`,
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

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (res.status === 429)
      throw new Error("Rate limit reached. Please try again in a moment.");
    if (res.status === 403)
      throw new Error("API key invalid or billing not enabled for image generation.");
    throw new Error(`Removal failed (${res.status}). ${detail.slice(0, 200)}`);
  }

  const payload = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<
          | { text?: string }
          | { inlineData?: { mimeType?: string; data?: string } }
          | { inline_data?: { mime_type?: string; data?: string } }
        >;
      };
    }>;
    error?: { message?: string };
  };

  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find(
    (p): p is { inlineData?: { mimeType?: string; data?: string } } =>
      "inlineData" in p || "inline_data" in p,
  );

  const inlineData = imagePart?.inlineData ?? (imagePart as any)?.inline_data;
  const b64 = inlineData?.data;

  if (!b64) {
    throw new Error(
      payload.error?.message ?? "The model did not return an image. Please try again.",
    );
  }

  const mimeType = inlineData?.mimeType ?? (imagePart as any)?.inline_data?.mime_type ?? "image/png";

  return { image: `data:${mimeType};base64,${b64}` };
}
