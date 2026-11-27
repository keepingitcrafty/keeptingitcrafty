// Keeping It Crafty — photo → colouring page, via Google Gemini.
// The customer's browser sends a photo here; this function (which runs on Netlify's
// servers, where the secret API key lives) asks Gemini to turn it into a line drawing
// and sends the drawing back. The key is NEVER sent to the browser.
//
// Netlify environment variables used (set these in the Netlify dashboard):
//   GEMINI_API_KEY  — required. Your Google AI Studio key (starts with AIza).
//   GEMINI_MODEL    — optional. Defaults to "gemini-2.5-flash-image".
//                     Only change this if Google renames the image model.

const BASE =
  "The photo may show people, pets or other animals, or both together: include every person and animal in it, " +
  "each one clearly recognisable as themselves. Leave out photographic background clutter. ";

const PROMPTS = {
  colour:
    "Turn this photograph into a black-and-white line drawing for a children's and adults' " +
    "colouring book. Use clean, smooth, bold BLACK OUTLINES on a pure WHITE background. " +
    "Keep the main subject clearly recognisable, with well-defined outlines of its key shapes " +
    "and features (for a face: the eyes, nose, mouth and hair; for a pet: the eyes, nose, ears and fur shape). " +
    "Remove ALL colour, grey tones, shading and photographic background clutter. " +
    "Do NOT fill any area with solid black — every shape must stay open white inside so it can be coloured in. " +
    "Simplify busy textures into a few clean lines. The result should look like a friendly, printable colouring page.",
  caricature:
    "Turn this photograph into a GENTLE, AFFECTIONATE cartoon caricature drawn as a black-and-white colouring page: " +
    "clean bold black outlines on pure white, no colour, no grey, no shading, no solid black areas. " +
    "Draw it in a clear, fun CARTOON CARICATURE style, like a friendly seaside caricature artist: heads about one and a half times bigger " +
    "than real life on smaller, simplified cartoon bodies, big friendly eyes and happy smiles, a cheerful playful pose. " +
    "Pets become cute, happy cartoon versions of themselves with big heads too. Use a plain white background or one very simple prop. " +
    "Make it warm and flattering, the kind of drawing the person would love to receive as a gift. " +
    "Keep each person's real likeness, hairstyle, glasses and clothes so they are easy to recognise. " +
    "STRICT KINDNESS RULES: never mock or exaggerate weight, body shape or size, age, wrinkles, skin, teeth, nose, ears, " +
    "baldness, height, disability, mobility aids, or any ethnic or racial feature; never make anyone look ugly, silly, rude, " +
    "scary or embarrassed; no rude gestures, no unflattering expressions, no text or captions. Keep everyone's skin tone and features true to the photo. " +
    "If in doubt, make it kinder and more flattering.",
  stainedglass:
    "Turn this photograph into a STAINED-GLASS WINDOW colouring page: the subject drawn with bold, even black 'lead' lines, " +
    "and both the subject and the background divided into many smooth glass panes of medium size, like a church or Tiffany window, " +
    "with a simple decorative frame of panes around the edge. Pure black lines on white only: no colour, no grey, no shading, " +
    "and no pane filled with solid black. Faces, eyes and pet features stay simple, clear and friendly so everyone is recognisable.",
  oneline:
    "Turn this photograph into an elegant SINGLE-LINE drawing: one continuous, flowing black line that never lifts, " +
    "tracing the outline and the key features of every person and animal (eyes, smile, hair, ears, fur shape) in a minimal, stylish way. " +
    "Thin, even black line on pure white. No shading, no fill, no colour, no extra separate lines, no background. " +
    "Keep everyone recognisable and the drawing warm and flattering.",
  pencil:
    "Turn this photograph into a realistic graphite pencil sketch on white paper, with soft natural shading and fine detail. " +
    "Keep everyone recognisable and flattering. No colour.",
  charcoal:
    "Turn this photograph into a bold, expressive charcoal drawing on white paper, with strong dramatic strokes and soft smudged tones. " +
    "Keep everyone recognisable and flattering. No colour.",
  watercolour:
    "Turn this photograph into a loose, soft watercolour painting on white paper, with gentle washes of colour and an impressionist feel. " +
    "Keep everyone recognisable and flattering.",
};

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
    contents: [{ parts: [{ text: BASE + (PROMPTS[body.style] || PROMPTS.colour) }, { inline_data: { mime_type: mime, data: b64 } }] }],
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
