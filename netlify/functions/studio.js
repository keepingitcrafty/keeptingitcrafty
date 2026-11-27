// Keeping It Crafty — Book Studio helper (runs on Netlify, next to colouring.js).
// Lets Hayley's private Book Studio read colouring-book orders from Shopify.
// Nothing is stored here: it reads orders when asked and hands back what the Studio needs.
//
// Netlify environment variables (Site configuration → Environment variables):
//   STUDIO_PASSWORD        — the password Hayley types into the Studio. Make it long.
//   SHOPIFY_SHOP           — xjje2b-st.myshopify.com
//   SHOPIFY_CLIENT_ID      — from the "Book Studio" app in the Shopify Dev Dashboard
//   SHOPIFY_CLIENT_SECRET  — from the same app (keep secret)
// The app needs the access scopes read_orders and write_orders (write is only used to tag orders as printed).

const crypto = require("crypto");
const API_VERSION = "2026-10";
const BOOK_HANDLE = "personalised-colouring-book";
const EXTRA_HANDLES = ["personalised-photo-tote-bag-white", "personalised-photo-mug-white", "personalised-photo-a5-notebook", "digital-colouring-page-download"];
const FILE_HOSTS = [/(^|\.)cdn\.shopify\.com$/i, /(^|\.)shopifycdn\.net$/i, /(^|\.)myshopify\.com$/i, /(^|\.)haykeepingitcrafty\.co\.uk$/i];

const json = (statusCode, obj) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  },
  body: JSON.stringify(obj),
});

const same = (a, b) => {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

let cached = { token: "", until: 0 };
async function getToken() {
  if (cached.token && Date.now() < cached.until - 60000) return cached.token;
  const shop = process.env.SHOPIFY_SHOP;
  const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.SHOPIFY_CLIENT_ID || "", client_secret: process.env.SHOPIFY_CLIENT_SECRET || "" }),
  });
  if (!r.ok) throw new Error("Shopify sign-in failed (" + r.status + "). Check the Book Studio app details in Netlify.");
  const j = await r.json();
  cached = { token: j.access_token, until: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

async function gql(query, variables) {
  const r = await fetch(`https://${process.env.SHOPIFY_SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await getToken() },
    body: JSON.stringify({ query, variables: variables || {} }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.errors && j.errors.length)) throw new Error("Shopify said: " + JSON.stringify(j.errors || r.status).slice(0, 300));
  return j.data;
}

const ORDERS = `query($first:Int!, $after:String) {
  orders(first:$first, after:$after, sortKey:CREATED_AT, reverse:true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus tags note
      lineItems(first:30) { nodes { id title variantTitle quantity product { handle } customAttributes { key value } } }
    }
  }
}`;

function shape(o) {
  const items = (o.lineItems.nodes || []).map((li) => ({
    id: li.id, title: li.title, variant: li.variantTitle, qty: li.quantity, handle: li.product && li.product.handle,
    props: (li.customAttributes || []).map((a) => ({ k: a.key, v: a.value })),
  }));
  const book = items.filter((i) => i.handle === BOOK_HANDLE || i.props.some((p) => p.k === "Cover template"));
  if (!book.length) return null;
  const extras = items.filter((i) => book.indexOf(i) < 0 && (EXTRA_HANDLES.indexOf(i.handle) >= 0 || i.props.some((p) => /^Design$|print file/i.test(p.k))));
  return {
    id: o.id, name: o.name, created: o.createdAt, cancelled: !!o.cancelledAt, paid: o.displayFinancialStatus,
    fulfilment: o.displayFulfillmentStatus, printed: (o.tags || []).indexOf("studio-printed") >= 0, note: o.note || "",
    books: book, extras,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad request." }); }

  if (!process.env.STUDIO_PASSWORD) return json(500, { error: "The Studio isn't set up yet (no STUDIO_PASSWORD in Netlify)." });
  if (!same(body.password, process.env.STUDIO_PASSWORD)) {
    await new Promise((r) => setTimeout(r, 1200)); // slow down guessing
    return json(401, { error: "That password isn't right." });
  }
  if (body.action === "ping") return json(200, { ok: true });
  if (!process.env.SHOPIFY_SHOP || !process.env.SHOPIFY_CLIENT_ID || !process.env.SHOPIFY_CLIENT_SECRET)
    return json(500, { error: "The Studio can't reach Shopify yet: add SHOPIFY_SHOP, SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in Netlify." });

  try {
    if (body.action === "orders") {
      const out = []; let after = null, pages = 0;
      do {
        const d = await gql(ORDERS, { first: 50, after });
        d.orders.nodes.forEach((o) => { const s = shape(o); if (s) out.push(s); });
        after = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
        pages++;
      } while (after && pages < (body.deep ? 6 : 2));
      return json(200, { orders: out, more: !!after });
    }

    if (body.action === "file") {
      let u;
      try { u = new URL(body.url); } catch { return json(400, { error: "Bad file link." }); }
      if (u.protocol !== "https:" || !FILE_HOSTS.some((re) => re.test(u.hostname))) return json(400, { error: "That file isn't from the shop." });
      const r = await fetch(u.href);
      if (!r.ok) return json(502, { error: "Couldn't fetch that file (" + r.status + ")." });
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 4.3 * 1024 * 1024) return json(413, { error: "That file is too big to open here – please download it from the order instead." });
      return json(200, { data: `data:${r.headers.get("content-type") || "image/png"};base64,${buf.toString("base64")}` });
    }

    if (body.action === "mark") {
      if (!/^gid:\/\/shopify\/Order\/\d+$/.test(body.id || "")) return json(400, { error: "Bad order." });
      const m = body.printed
        ? `mutation($id:ID!){ tagsAdd(id:$id, tags:["studio-printed"]) { userErrors { message } } }`
        : `mutation($id:ID!){ tagsRemove(id:$id, tags:["studio-printed"]) { userErrors { message } } }`;
      const d = await gql(m, { id: body.id });
      const errs = (d.tagsAdd || d.tagsRemove || {}).userErrors || [];
      if (errs.length) return json(400, { error: errs.map((e) => e.message).join("; ") });
      return json(200, { ok: true });
    }

    return json(400, { error: "Unknown action." });
  } catch (e) {
    console.error("Studio error:", String((e && e.message) || e));
    return json(502, { error: String((e && e.message) || e) });
  }
};
