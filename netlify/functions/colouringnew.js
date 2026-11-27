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
  "each one clearly recognisable as themselves. Leave out photographic background clutter. " +
  "ACCURACY: draw exactly the people and animals in the photo, no more and no fewer, each in the SAME pose and position as in the photo " +
  "(if someone is sitting, they stay sitting). Correct anatomy: every person has exactly two arms, two hands and two legs and every animal its " +
  "real number of legs, ears and tails; never add, duplicate, merge or lose limbs, hands, fingers or heads. Do NOT add any objects, props, tools, " +
  "art supplies (no palettes, paintbrushes, pencils or crayons), toys, text, captions or speech bubbles that are not in the photo. " +
  "SAFETY: everyone must be shown fully and modestly clothed exactly as in the photo or more covered; never remove, reduce or " +
  "change clothing, never make anyone look older or younger, and never make the image suggestive in any way. ";

// ---- Photo safety check (runs before any drawing is made) ----
// Asks Gemini to describe what kind of photo this is, then applies Keeping It Crafty's photo rules.
// If the check itself can't run, we refuse the photo (safety first) and ask the customer to try again.
const SCREEN_PROMPT =
  "You are checking a photo uploaded to a family business that turns customers' OWN personal photos into printed colouring pages. " +
  "Do not identify anyone by name. Look carefully and answer ONLY with a JSON object with these keys (true/false unless stated):\n" +
  "\"nudity\": any person is nude, partly nude, topless, or shown in underwear, lingerie, swimwear or a towel, or breasts, buttocks or genitals are visible or emphasised;\n" +
  "\"sexual\": the photo is sexual, suggestive or provocative in pose, clothing or context;\n" +
  "\"child\": anyone in the photo appears to be under 18;\n" +
  "\"child_not_fully_clothed\": anyone who appears under 18 is not fully dressed (including swimwear, nappies only, bath or bed time);\n" +
  "\"violence\": weapons, injuries, blood, drugs, or hateful or offensive symbols or gestures;\n" +
  "\"professional\": the photo looks like a press, red-carpet, concert or stage, publicity, magazine, advertising, stock, studio-portfolio or sports-event photo of a performer or public figure, " +
  "an album or film cover or poster, a screenshot from TV, film, video or a game, or it has a photographer's watermark or logo;\n" +
  "\"famous\": the person looks like they are probably a celebrity or public figure (judge only from context such as the setting, styling, stage, microphone, branding or captions, not from their face);\n" +
  "\"artwork\": the image is mainly a drawing, painting, cartoon or animated character, toy character, logo or someone else's artwork rather than a real photo;\n" +
  "\"reason\": a few words.";

const crypto = require("crypto");
// A passed photo check returns a token, so the drawing step doesn't need to check the same photo again.
const photoToken = (key, b64) => crypto.createHmac("sha256", "kic-photo-ok:" + key).update(b64).digest("hex");

function qcPrompt(style) {
  const extra = {
    caricature: "Bigger heads and simplified cartoon bodies are intended in this style, so don't count those as mistakes. ",
    stainedglass: "Lead lines, glass panes and a decorative window frame are intended in this style. ",
    oneline: "A minimal single flowing line is intended in this style, so simplified hands are fine. ",
  }[style] || "";
  return "Image 1 is a customer's photo. Image 2 is a drawing made from it for a printed colouring book. " + extra +
    "Check the drawing carefully for AI mistakes. Do not identify anyone. Answer ONLY with a JSON object:\n" +
    "\"anatomy\": true if any person or animal has extra, missing, duplicated or merged arms, hands, legs, paws, heads or tails, or clearly wrong numbers of fingers;\n" +
    "\"pose\": true if someone is in a clearly different pose from the photo (for example standing instead of sitting);\n" +
    "\"added\": true if the drawing adds objects, props, tools, art supplies, text, speech bubbles or people or animals that are not in the photo;\n" +
    "\"missing\": true if a person or animal from the photo is missing;\n" +
    "\"unkind\": true if it looks mocking, ugly or unflattering;\n" +
    "\"notes\": one short sentence describing each problem, or \"\" if none.";
}

async function screenPhoto(baseUrl, key, model, mime, b64) {
  const payload = {
    contents: [{ role: "user", parts: [{ text: SCREEN_PROMPT }, { inlineData: { mimeType: mime, data: b64 } }] }],
    generationConfig: { responseModalities: ["TEXT"], temperature: 0 },
  };
  const r = await fetch(`${baseUrl}/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(payload),
  });
  const d = await r.json().catch(() => ({}));
  const cand = (d.candidates || [])[0] || {};
  if (d.promptFeedback && d.promptFeedback.blockReason) return { blocked: true, flags: { sexual: true, reason: "blocked by Google safety" } };
  if (/SAFETY|PROHIBITED|BLOCKLIST|SPII/i.test(cand.finishReason || "")) return { blocked: true, flags: { sexual: true, reason: cand.finishReason } };
  if (!r.ok) throw new Error((d.error && d.error.message) || "screen failed");
  const text = ((cand.content || {}).parts || []).map((p) => p.text || "").join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("screen unreadable: " + text.slice(0, 120));
  return { flags: JSON.parse(m[0]) };
}

function photoRuleBreak(f) {
  if (!f) return null;
  if (f.nudity || f.sexual || f.child_not_fully_clothed)
    return { code: "clothing", error: "Sorry, we can't use this photo. Everyone in your photos needs to be fully dressed – no swimwear, underwear, bath-time or bare-chested photos. Please choose a different photo." };
  if (f.violence)
    return { code: "content", error: "Sorry, we can't use this photo because of something in it (for example a weapon, an injury or an offensive sign). Please choose a different photo." };
  if (f.professional || f.famous)
    return { code: "public", error: "Sorry, this looks like a professional, press or publicity photo, or a picture of someone famous. We can only use your own photos of people who are happy for you to use them. Please choose one of your own photos." };
  if (f.artwork)
    return { code: "artwork", error: "Sorry, this looks like a drawing, cartoon character or someone else's artwork rather than your own photo. Please upload one of your own photos." };
  return null;
}

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
    "than real life on smaller, simplified cartoon bodies, big friendly eyes and happy smiles, keeping each person's real pose from the photo. " +
    "Pets become cute, happy cartoon versions of themselves with big heads too. Use a plain white background with no props or added objects. " +
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

  // Prefer Netlify's built-in AI Gateway (what this site has always used); fall back to our own Gemini key.
  const GW_KEY = process.env.NETLIFY_AI_GATEWAY_KEY, GW_URL = (process.env.NETLIFY_AI_GATEWAY_URL || "").replace(/\/$/, "");
  // Our own paid Google key (already saved in Netlify under this name) comes first.
  const OWN = process.env.Gemini_API_Key_sketch_tool;
  const KEY = OWN || GW_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const BASE_URL = !OWN && GW_KEY && GW_URL ? GW_URL : "https://generativelanguage.googleapis.com";
  if (!KEY) return json(500, { error: "The colouring service isn't finished being set up yet. (No API key.)" });
  const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-image";

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad request." }); }

  const dataUrl = body.image || "";
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) return json(400, { error: "No photo received. Please choose a photo and try again." });
  const mime = m[1], b64 = m[2];
  if (b64.length > 11000000) return json(413, { error: "That photo is too large — please try a smaller one." });

  // Second-look check of a finished drawing (the safety check already happened when it was drawn).
  if (body.mode === "qc") {
    const dm = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(body.drawing || "");
    if (!dm) return json(400, { error: "No drawing received." });
    try {
      const r = await fetch(`${BASE_URL}/v1beta/models/${process.env.GEMINI_SCREEN_MODEL || MODEL}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: qcPrompt(body.style) }, { inlineData: { mimeType: mime, data: b64 } }, { inlineData: { mimeType: dm[1], data: dm[2] } }] }],
          generationConfig: { responseModalities: ["TEXT"], temperature: 0 },
        }),
      });
      const d = await r.json().catch(() => ({}));
      const text = ((((d.candidates || [])[0] || {}).content || {}).parts || []).map((p) => p.text || "").join("");
      const jm = text.match(/\{[\s\S]*\}/);
      const f = jm ? JSON.parse(jm[0]) : {};
      const bad = !!(f.anatomy || f.pose || f.added || f.missing || f.unkind);
      if (bad) console.log("Drawing check found:", JSON.stringify(f));
      return json(200, { ok: !bad, problems: bad ? (f.notes || "The drawing doesn't quite match the photo.") : "" });
    } catch (e) {
      return json(200, { ok: true, problems: "", skipped: true });
    }
  }

  // Photo rules check first (skipped if this exact photo already passed and the browser sent its token).
  const token = photoToken(KEY, b64);
  let screen;
  if (body.token && body.token === token && !body.checkOnly) screen = { flags: {} };
  else
  try {
    screen = await screenPhoto(BASE_URL, KEY, process.env.GEMINI_SCREEN_MODEL || MODEL, mime, b64);
  } catch (e) {
    console.error("Photo check failed:", String((e && e.message) || e));
    return json(503, { error: "We couldn't check your photo just now. Please try again in a moment." });
  }
  const broken = screen.blocked
    ? { code: "clothing", error: "Sorry, we can't use this photo. Please choose a different photo where everyone is fully dressed." }
    : photoRuleBreak(screen.flags);
  if (broken) {
    console.log("Photo refused:", broken.code, JSON.stringify(screen.flags || {}));
    return json(422, { error: broken.error, blocked: true, code: broken.code });
  }
  // The builder can ask for just the safety check (used for photos that weren't previewed, and the cover photo).
  if (body.checkOnly) return json(200, { ok: true, token });

  const payload = {
    contents: [{ role: "user", parts: [{ text: BASE + (PROMPTS[body.style] || PROMPTS.colour) +
      (body.fix ? " IMPORTANT: a previous attempt at this drawing had these mistakes, so take extra care to avoid them: " + String(body.fix).slice(0, 400) +
        " Check every person has the correct number of arms, hands and legs and that nothing has been added." : "") }, { inlineData: { mimeType: mime, data: b64 } }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    safetySettings: [
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_LOW_AND_ABOVE" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_LOW_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_LOW_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_LOW_AND_ABOVE" },
    ],
  };

  let resp, data;
  try {
    resp = await fetch(
      `${BASE_URL}/v1beta/models/${MODEL}:generateContent`,
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
  const fr = ((data.candidates || [])[0] || {}).finishReason || "";
  if ((!inline || !inline.data) && (/SAFETY|PROHIBITED|BLOCKLIST/i.test(fr) || (data.promptFeedback && data.promptFeedback.blockReason))) {
    return json(422, { error: "Sorry, we can't use this photo. Please choose a different photo where everyone is fully dressed and it's your own picture.", blocked: true, code: "google" });
  }
  if (!inline || !inline.data) {
    return json(502, { error: "The colouring service didn't return a drawing for that photo. Try a clearer photo with the subject filling more of the frame." });
  }
  const outMime = inline.mimeType || inline.mime_type || "image/png";
  return json(200, { image: `data:${outMime};base64,${inline.data}` });
};
