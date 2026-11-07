// Keeping It Crafty — all AI artwork, via Google Gemini.
// The customer's browser sends a request here; this function (which runs on Netlify's
// servers, where the secret API key lives) asks Gemini to draw the artwork and sends the
// image back. The key is NEVER sent to the browser.
//
// Request body (JSON):
//   { kind: "photo", style: "colour" | "graphite" | "charcoal" | "loose", image: "data:image/...;base64,..." }
//   { kind: "theme", theme: "mandala" | "garden" | ..., level: 0 | 1 | 2 }
//   { kind: "name",  name: "SOPHIE", deco: "stars" | "hearts" | "flowers" | "bubbles" }
//   Every kind may also send `v` (a number that changes on every attempt) so each
//   generation picks a different idea and never repeats the previous one.
//
// Netlify environment variables used (set these in the Netlify dashboard):
//   Uses Netlify AI Gateway automatically (no key needed). Optionally set
//   GEMINI_API_KEY to use your own Google AI Studio key instead.
//   GEMINI_MODEL    — optional. Defaults to "gemini-2.5-flash-image".
//                     Only change this if Google renames the image model.

const pick = (list, v) => list[((v % list.length) + list.length) % list.length];
const rand = (list) => list[Math.floor(Math.random() * list.length)];

const NO_FILL =
  "Use clean, smooth BLACK OUTLINES on a pure WHITE background. No colour, no grey tones, no shading, " +
  "and do NOT fill any area with solid black — every shape must stay open white inside so it can be coloured in. ";

/* ---------- Photo styles ---------- */
const PHOTO_STYLES = {
  colour: {
    base:
      "Turn this photograph into a black-and-white line drawing for a children's and adults' colouring book. " +
      NO_FILL +
      "Keep the main subject clearly recognisable, with well-defined outlines of its key shapes and features " +
      "(for a face: the eyes, nose, mouth and hair; for a pet: the eyes, nose, ears and fur shape). " +
      "Remove photographic background clutter and simplify busy textures into a few clean lines. " +
      "The result should look like a friendly, printable colouring page.",
    looks: [
      "Keep the background completely plain white.",
      "Add a simple, fun background of hearts and stars for colouring.",
      "Surround the subject with a few simple leaves and flowers to colour.",
      "Include a simplified, outline-only version of the original setting behind the subject.",
      "Place the subject inside a simple decorative frame with rounded corners.",
      "Add a playful scattering of simple shapes (circles, swirls and dots) in the background.",
    ],
    lines: ["Use bold, chunky outlines.", "Use medium outlines with a little extra detail in the features.", "Use smooth, flowing, elegant outlines."],
  },
  graphite: {
    base:
      "Redraw this photograph as a realistic graphite pencil drawing on white paper, like a careful portrait study. " +
      "Use soft blended shading, fine hatching and accurate tonal values in shades of grey only (no colour). " +
      "Keep the subject accurately recognisable — same pose, features and proportions.",
    looks: [
      "Keep the background plain white paper.",
      "Let the drawing fade softly into the white paper around the edges, like a vignette.",
      "Lightly suggest the original setting behind the subject with a few soft pencil marks.",
      "Add gentle cross-hatched shading behind the subject so it stands out.",
      "Leave some areas unfinished with visible construction lines, like an artist's study.",
    ],
    lines: ["Use crisp, fine detail.", "Use soft, smooth blending.", "Use slightly stronger contrast in the darkest areas."],
  },
  charcoal: {
    base:
      "Redraw this photograph as a bold, expressive charcoal drawing on textured white paper. " +
      "Use dramatic smudgy shadows, strong contrast and visible paper grain, in black and grey only (no colour). " +
      "Keep the subject clearly recognisable — same pose, features and proportions.",
    looks: [
      "Keep the background mostly bare paper.",
      "Add sweeping, smudged charcoal strokes in the background.",
      "Let the drawing dissolve into rough, broken strokes at the edges.",
      "Use a darker, moody background so the subject glows from the paper.",
      "Add a few white highlight marks, as if picked out with an eraser.",
    ],
    lines: ["Use heavy, confident strokes.", "Use softer, misty smudging.", "Use crisp dark accents on the key features."],
  },
  loose: {
    base:
      "Redraw this photograph as a loose, impressionist ink-and-pencil sketch, like a page from an artist's sketchbook. " +
      "Use quick, confident gestural strokes that follow the form, in black and grey only (no colour). " +
      "Keep the subject recognisable — same pose and proportions — while the style stays free and expressive.",
    looks: [
      "Keep the background plain white.",
      "Suggest the surroundings with a few quick scribbled lines.",
      "Let some strokes overshoot and trail off at the edges.",
      "Add a few light ink washes in grey for depth.",
      "Use continuous, flowing single-line contours where possible.",
    ],
    lines: ["Use thin, energetic lines.", "Use bolder brush-pen strokes.", "Use a mix of fine pencil and bold ink lines."],
  },
};

/* ---------- Theme colouring pages ---------- */
const THEMES = {
  mandala: {
    label: "Flower Mandala",
    ideas: [
      "a large circular flower mandala with layered petals",
      "a mandala made of interlocking leaves and tiny daisies",
      "a sunflower-centred mandala with geometric rings",
      "a lotus mandala with ornate petal borders",
      "a heart-shaped floral mandala",
      "a mandala of roses and swirling vines",
      "a star-shaped mandala with tulips at each point",
      "a mandala of feathers and blossoms",
    ],
  },
  garden: {
    label: "Secret Garden",
    ideas: [
      "a secret garden gate covered in climbing roses",
      "a cottage garden path with foxgloves and a birdbath",
      "a little greenhouse full of potted plants",
      "a hedgehog among toadstools and wildflowers",
      "a garden bench under a wisteria arch",
      "a watering can overflowing with flowers, with a robin on the handle",
      "a tiny fairy door in an old tree surrounded by bluebells",
      "a vegetable patch with a friendly scarecrow and rabbits",
    ],
  },
  ocean: {
    label: "Under the Sea",
    ideas: [
      "a sea turtle swimming over a coral reef",
      "an octopus peeking out of a treasure chest",
      "a pod of dolphins leaping through waves",
      "a seahorse family among swaying seaweed",
      "a friendly whale surrounded by little fish and bubbles",
      "a sunken ship with curious fish swimming through it",
      "a crab and starfish in a rock pool",
      "a parade of jellyfish with ribbon tentacles",
    ],
  },
  space: {
    label: "Outer Space",
    ideas: [
      "an astronaut floating beside a ringed planet",
      "a rocket blasting off past the moon",
      "a friendly alien waving from a flying saucer",
      "a space station with solar panels among the stars",
      "the planets of the solar system lined up around the sun",
      "a moon base with a little rover",
      "a cat astronaut in a bubble helmet",
      "a comet zooming past constellations",
    ],
  },
  butterfly: {
    label: "Butterfly",
    ideas: [
      "a single large butterfly with beautifully patterned wings",
      "butterflies fluttering around a flowering bush",
      "a butterfly resting on a sunflower",
      "the life cycle of a butterfly from caterpillar to wings",
      "three butterflies with mosaic-patterned wings",
      "a butterfly with stained-glass style wings framed by flowers",
      "a moth and a butterfly among moonflowers",
      "a butterfly garden with a little wooden birdhouse",
    ],
  },
  critters: {
    label: "Cute Critters",
    ideas: [
      "a sleepy fox curled up in autumn leaves",
      "a bunny picnic on a blanket",
      "a panda munching bamboo",
      "an owl family on a branch",
      "a kitten playing with a ball of yarn",
      "a puppy sitting in a wellington boot",
      "a hedgehog holding a mushroom umbrella",
      "a squirrel collecting acorns outside a tree house",
    ],
  },
  patterns: {
    label: "Patchwork Quilt",
    ideas: [
      "a patchwork quilt of squares with hearts, stars and flowers",
      "a hexagon quilt with little floral motifs",
      "a log-cabin quilt with folk-art birds",
      "a granny-square blanket pattern",
      "a diamond harlequin quilt with leaves",
      "a quilt made of tiny houses and trees",
      "a quilt of circles and scallops",
      "a sampler quilt with lots of different patchwork blocks",
    ],
  },
};

const LEVELS = [
  "Designed for little children aged 3 to 6: very simple, large shapes with very thick bold outlines, big open areas to colour and minimal detail.",
  "Designed for children aged 6 to 12: a medium amount of detail with bold clear outlines and a fun background with a few extra elements.",
  "Designed for teens and adults: intricate, highly detailed fine linework with lots of small areas and decorative patterns to colour.",
];

const COMPOSITIONS = [
  "Use a centred composition with the main subject large in the frame.",
  "Place the subject slightly off-centre with an interesting background.",
  "Make it a close-up that fills the page edge to edge.",
  "Show a wide scene with clear foreground and background elements.",
  "Frame the picture with a simple decorative border.",
  "Draw it from a playful, slightly low viewpoint.",
];

/* ---------- Name pages ---------- */
const DECOS = {
  stars: ["shooting stars, planets and sparkles", "big and small stars with swirly trails", "a starry night with a crescent moon and clouds"],
  hearts: ["hearts of all sizes with little bows", "a garland of hearts and flowers", "hearts with patterns inside them and sparkles"],
  flowers: ["daisies, tulips and leafy vines", "a wreath of roses and leaves", "wildflowers growing up from the bottom of the page with bees"],
  bubbles: ["floating bubbles of different sizes", "bubbles with little fish and seaweed", "bubbles, swirls and sparkles"],
};

function buildRequest(body) {
  const kind = body.kind || "photo";
  const v = Number.isFinite(+body.v) ? Math.floor(+body.v) : Math.floor(Math.random() * 1000);

  if (kind === "photo") {
    const style = PHOTO_STYLES[body.style] ? body.style : "colour";
    const S = PHOTO_STYLES[style];
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(body.image || "");
    if (!m) return { error: [400, "No photo received. Please choose a photo and try again."] };
    if (m[2].length > 11000000) return { error: [413, "That photo is too large — please try a smaller one."] };
    const text = `${S.base} ${pick(S.looks, v)} ${rand(S.lines)}`;
    return { parts: [{ text }, { inline_data: { mime_type: m[1], data: m[2] } }], aspect: null };
  }

  if (kind === "theme") {
    const T = THEMES[body.theme];
    if (!T) return { error: [400, "Please choose a theme and try again."] };
    const level = LEVELS[Math.max(0, Math.min(2, Math.floor(+body.level) || 0))];
    const text =
      `Create an original, one-of-a-kind colouring book page (theme: ${T.label}) showing ${pick(T.ideas, v)}. ` +
      `${level} ${rand(COMPOSITIONS)} ` +
      NO_FILL +
      "Do not include any words, letters, numbers, signatures or watermarks. Portrait page, ready to print.";
    return { parts: [{ text }], aspect: "3:4" };
  }

  if (kind === "name") {
    const name = String(body.name || "")
      .toUpperCase()
      .replace(/[^A-Z0-9 &'!.\-]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 18);
    if (!name) return { error: [400, "Please type a name first."] };
    const deco = DECOS[body.deco] ? body.deco : "stars";
    const spelled = name.replace(/ /g, "").split("").join("-");
    const text =
      `Create a personalised colouring book page featuring the name "${name}" in large, bold, rounded bubble letters ` +
      `(outlines only, white inside so they can be coloured in), spelled exactly ${spelled}, centred on the page. ` +
      `Surround the name with ${pick(DECOS[deco], v)}. ${rand(COMPOSITIONS.slice(0, 2).concat(COMPOSITIONS[4]))} ` +
      NO_FILL +
      "The name must be the ONLY text on the page — no other words, letters, signatures or watermarks. Portrait page, ready to print.";
    return { parts: [{ text }], aspect: "3:4" };
  }

  return { error: [400, "Bad request."] };
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });

// Works with Netlify AI Gateway (credentials injected automatically) or your own Google key.
function geminiEndpoint() {
  const gwBase = process.env.GOOGLE_GEMINI_BASE_URL;
  if (gwBase && process.env.GEMINI_API_KEY) return { base: gwBase, key: process.env.GEMINI_API_KEY };
  if (process.env.GEMINI_API_KEY) return { base: "https://generativelanguage.googleapis.com", key: process.env.GEMINI_API_KEY };
  if (process.env.NETLIFY_AI_GATEWAY_URL && process.env.NETLIFY_AI_GATEWAY_KEY)
    return { base: process.env.NETLIFY_AI_GATEWAY_URL, key: process.env.NETLIFY_AI_GATEWAY_KEY };
  return null;
}

async function callGemini(MODEL, EP, parts, aspect, extras) {
  const generationConfig = { responseModalities: ["TEXT", "IMAGE"] };
  if (extras) {
    // A fresh seed and full temperature make every generation look different.
    generationConfig.temperature = 1;
    generationConfig.seed = Math.floor(Math.random() * 2147483647);
    if (aspect) generationConfig.imageConfig = { aspectRatio: aspect };
  }
  const resp = await fetch(`${EP.base.replace(/\/$/, "")}/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": EP.key },
    body: JSON.stringify({ contents: [{ parts }], generationConfig }),
  });
  const data = await resp.json().catch(() => ({}));
  return { resp, data };
}

export default async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json(405, { error: "Method not allowed." });

  const EP = geminiEndpoint();
  if (!EP) return json(500, { error: "The drawing service isn't finished being set up yet. (No API key.)" });
  const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-image";

  let body;
  try { body = await request.json(); } catch { return json(400, { error: "Bad request." }); }

  const req = buildRequest(body);
  if (req.error) return json(req.error[0], { error: req.error[1] });

  let resp, data;
  try {
    ({ resp, data } = await callGemini(MODEL, EP, req.parts, req.aspect, true));
    // Some model versions don't accept seed / aspect-ratio settings — retry without them.
    if (resp.status === 400 && /seed|imageConfig|aspect|Unknown name|INVALID_ARGUMENT/i.test((data.error && data.error.message) || "")) {
      ({ resp, data } = await callGemini(MODEL, EP, req.parts, req.aspect, false));
    }
  } catch (e) {
    return json(502, { error: "Couldn't reach the drawing service. Please try again in a moment." });
  }

  if (!resp.ok) {
    const msg = (data && data.error && data.error.message) || "";
    let friendly = "The drawing service had a problem. Please try again.";
    if (/API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(msg)) friendly = "The drawing service key isn't valid. (Check the Netlify setup.)";
    else if (/quota|RESOURCE_EXHAUSTED|billing|FAILED_PRECONDITION/i.test(msg)) friendly = "The drawing service is over its limit for now. Please try again later.";
    else if (/not found|NOT_FOUND/i.test(msg)) friendly = "The drawing service model name needs updating. (Check GEMINI_MODEL in Netlify.)";
    return json(502, { error: friendly, detail: msg });
  }

  const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  const imgPart = parts.find((p) => p.inlineData || p.inline_data);
  const inline = imgPart && (imgPart.inlineData || imgPart.inline_data);
  if (!inline || !inline.data) {
    const hint = (body.kind || "photo") === "photo"
      ? "Try a clearer photo with the subject filling more of the frame."
      : "Please try again.";
    return json(502, { error: `The drawing service didn't return a picture that time. ${hint}` });
  }
  const outMime = inline.mimeType || inline.mime_type || "image/png";
  return json(200, { image: `data:${outMime};base64,${inline.data}` });
};
