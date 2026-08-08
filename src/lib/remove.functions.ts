import { createServerFn } from "@tanstack/react-start";
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

export const removeObject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured for this project.");

    const targets: string[] = [];
    if (data.points > 0) {
      targets.push(
        `The second image has ${data.points} magenta target marker${data.points > 1 ? "s" : ""} (a ring with a centre dot and a number). Each marker points at ONE object. Work out for yourself where that object begins and ends — its full silhouette, including parts far outside the ring, plus its cast shadow, reflection and anything it is holding or standing on that belongs to it. Remove the entire object, not just the area inside the ring. Do not remove anything else in the scene.`,
      );
    }
    if (data.hasPaint) {
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


    const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-pro-image",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: data.image } },
              { type: "image_url", image_url: { url: data.marked } },
            ],
          },
        ],
        modalities: ["image", "text"],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("Rate limit reached. Please try again in a moment.");
      if (res.status === 402) throw new Error("AI credits are exhausted for this workspace.");
      throw new Error(`Removal failed (${res.status}). ${detail.slice(0, 200)}`);
    }

    const payload = (await res.json()) as {
      data?: Array<{ b64_json?: string }>;
      error?: { message?: string };
    };
    const b64 = payload.data?.[0]?.b64_json;
    if (!b64) throw new Error(payload.error?.message ?? "The model did not return an image.");

    return { image: `data:image/png;base64,${b64}` };
  });
