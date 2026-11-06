// Keeping It Crafty — photo → colouring page, via Google Gemini.
// The customer's browser sends a photo here; this function (which runs on Netlify's
// servers, where the secret API key lives) asks Gemini to turn it into a line drawing
// and sends the drawing back. The key is NEVER sent to the browser.
//
// Netlify environment variables used (set these in the Netlify dashboard):
//   GEMINI_API_KEY  — required. Your Google AI Studio key (starts with AIza).
//   GEMINI_MODEL    — optional. Defaults to "gemini-2.5-flash-image".
//                     Only change this if Google renames the image model.

const PROMPT =
  "Turn this photograph into a black-and-white line drawing for a children's and adults' " +
  "colouring book. Use clean, smooth, bold BLACK OUTLINES on a pure WHITE background. " +
  "Keep the main subject clearly recognisable, with well-defined outlines of its key shapes " +
  "and features (for a face: the eyes, nose, mouth and hair; for a pet: the eyes, nose, ears and fur shape). " +
  "Remove ALL colour, grey tones, shading and photographic background clutter. " +
  "Do NOT fill any area with solid black — every shape must stay open white inside so it can be coloured in. " +
  "Simplify busy textures into a few clean lines. The result should look like a friendly, printable colouring page.";

const json = (statusCode, obj) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });

  const KEY = process.env.GEMINI_API_KEY;
  if (!KEY) return json(500, { error: "The colouring service isn't finished being set up yet. (No API key.)" });
  const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-image";

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad request." }); }

  const dataUrl = body.image || "";
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) return json(400, { error: "No photo received. Please choose a photo and try again." });
  const mime = m[1], b64 = m[2];
  if (b64.length > 11000000) return json(413, { error: "That photo is too large — please try a smaller one." });

  const payload = {
    contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: b64 } }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  };

  let resp, data;
  try {
    resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": KEY }, body: JSON.stringify(payload) }
    );
    data = await resp.json();
  } catch (e) {
    return json(502, { error: "Couldn't reach the colouring service. Please try again in a moment." });
  }

  if (!resp.ok) {
    const msg = (data && data.error && data.error.message) || "";
    let friendly = "The colouring service had a problem. Please try again.";
    if (/API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(msg)) friendly = "The colouring service key isn't valid. (Check the Netlify setup.)";
    else if (/quota|RESOURCE_EXHAUSTED|billing|FAILED_PRECONDITION/i.test(msg)) friendly = "The colouring service is over its limit for now. Please try again later.";
    else if (/not found|NOT_FOUND/i.test(msg)) friendly = "The colouring service model name needs updating. (Check GEMINI_MODEL in Netlify.)";
    return json(502, { error: friendly, detail: msg });
  }

  const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  const imgPart = parts.find((p) => p.inlineData || p.inline_data);
  const inline = imgPart && (imgPart.inlineData || imgPart.inline_data);
  if (!inline || !inline.data) {
    return json(502, { error: "The colouring service didn't return a drawing for that photo. Try a clearer photo with the subject filling more of the frame." });
  }
  const outMime = inline.mimeType || inline.mime_type || "image/png";
  return json(200, { image: `data:${outMime};base64,${inline.data}` });
};
