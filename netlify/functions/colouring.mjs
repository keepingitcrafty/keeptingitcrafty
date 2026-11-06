// Keeping It Crafty — photo → colouring page, via Google Gemini.
// The customer's browser sends a photo here; this function asks Gemini (through
// Netlify AI Gateway) to turn it into a line drawing and sends the drawing back.
// No API key is needed: Netlify AI Gateway provides the credentials automatically.
//
// Optional environment variable:
//   GEMINI_MODEL — override the image model (default "gemini-3.1-flash-image").

import { GoogleGenAI } from "@google/genai";

const PROMPT =
  "Turn this photograph into a black-and-white line drawing for a children's and adults' " +
  "colouring book. Use clean, smooth, bold BLACK OUTLINES on a pure WHITE background. " +
  "Keep the main subject clearly recognisable, with well-defined outlines of its key shapes " +
  "and features (for a face: the eyes, nose, mouth and hair; for a pet: the eyes, nose, ears and fur shape). " +
  "Remove ALL colour, grey tones, shading and photographic background clutter. " +
  "Do NOT fill any area with solid black — every shape must stay open white inside so it can be coloured in. " +
  "Simplify busy textures into a few clean lines. The result should look like a friendly, printable colouring page.";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status, obj) => Response.json(obj, { status, headers: CORS });

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed." });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Bad request." }); }

  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec((body && body.image) || "");
  if (!m) return json(400, { error: "No photo received. Please choose a photo and try again." });
  const [, mimeType, data] = m;
  if (data.length > 5_500_000) return json(413, { error: "That photo is too large — please try a smaller one." });

  const ai = new GoogleGenAI({
    apiKey: process.env.NETLIFY_AI_GATEWAY_KEY,
    httpOptions: { baseUrl: process.env.NETLIFY_AI_GATEWAY_URL?.replace(/\/$/, "") },
  });

  // Gemini occasionally replies without an image, so try twice before giving up.
  let response, inline;
  try {
    for (let attempt = 0; attempt < 2 && !inline; attempt++) {
      response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-3.1-flash-image",
        contents: [{ role: "user", parts: [{ text: PROMPT }, { inlineData: { mimeType, data } }] }],
        config: { responseModalities: ["TEXT", "IMAGE"] },
      });
      const parts = response?.candidates?.[0]?.content?.parts || [];
      inline = parts.find((p) => p.inlineData && p.inlineData.data)?.inlineData;
    }
  } catch (e) {
    const msg = String((e && e.message) || e);
    console.error("Gemini request failed:", msg);
    let friendly = "The colouring service had a problem. Please try again.";
    if ((e && e.status === 429) || /quota|RESOURCE_EXHAUSTED|rate/i.test(msg)) friendly = "The colouring service is busy right now. Please try again in a minute.";
    else if (/SAFETY|blocked/i.test(msg)) friendly = "That photo couldn't be turned into a drawing. Please try a different photo.";
    return json(502, { error: friendly });
  }

  if (!inline) {
    console.error("No image in Gemini response:", response?.candidates?.[0]?.finishReason, response?.text);
    return json(502, { error: "The colouring service didn't return a drawing for that photo. Try a clearer photo with the subject filling more of the frame." });
  }
  return json(200, { image: `data:${inline.mimeType || "image/png"};base64,${inline.data}` });
};
