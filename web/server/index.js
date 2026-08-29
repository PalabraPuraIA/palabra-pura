/**
 * Lightweight web server: static chat + analytics API + dashboard.
 * Stores questions in a JSON file (no external DB required).
 */

import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chatMode, handleChat, handleChatStatus } from "./chat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 80);
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "analytics.json");
const PUBLIC_URL_FILE = process.env.PUBLIC_URL_FILE || path.join(DATA_DIR, "public-url.json");

const STOPWORDS = new Set([
  "a", "al", "algo", "como", "con", "de", "del", "el", "en", "es", "esta", "este",
  "la", "las", "lo", "los", "me", "mi", "no", "o", "para", "pero", "por", "que",
  "se", "si", "su", "te", "tu", "un", "una", "y", "ya", "yo", "qué", "cómo",
  "dice", "dios", "significa", "puedo", "puede", "hacer", "tengo", "tiene", "ser",
]);

/** Curated topics for the dashboard (keyword → theme). */
const TOPICS = [
  { id: "fe", label: "Fe y confianza", keywords: ["fe", "confiar", "confianza", "creer", "temor", "miedo", "ansiedad"] },
  { id: "oracion", label: "Oración", keywords: ["orar", "oracion", "reza", "rezo", "clamar"] },
  { id: "sanidad", label: "Sanidad", keywords: ["sanidad", "sanar", "sano", "enfermedad", "enfermedad", "milagro", "sintoma", "cura"] },
  { id: "palabra", label: "La Palabra", keywords: ["palabra", "biblia", "escritura", "versiculo", "leer"] },
  { id: "nuevo", label: "Nuevo nacimiento / salvación", keywords: ["nacer", "nuevo", "salvacion", "salvo", "evangelio", "cruz"] },
  { id: "dones", label: "Dones espirituales", keywords: ["dones", "espiritu", "carisma", "ministerio"] },
  { id: "familia", label: "Familia y matrimonio", keywords: ["familia", "matrimonio", "esposo", "esposa", "hijos", "pareja"] },
  { id: "testimonio", label: "Testimonios / restauración", keywords: ["testimonio", "restaurar", "restauracion", "perdon"] },
];

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ version: 1, events: [] }, null, 2));
  }
}

function readStore() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return { version: 1, events: [] };
  }
}

function writeStore(store) {
  ensureStore();
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function normalizeTokens(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function detectTopics(question) {
  const tokens = new Set(normalizeTokens(question));
  const hit = [];
  for (const topic of TOPICS) {
    if (topic.keywords.some((k) => tokens.has(k) || String(question).toLowerCase().includes(k))) {
      hit.push(topic.id);
    }
  }
  return hit.length ? hit : ["otros"];
}

function buildSummary(store) {
  const events = Array.isArray(store.events) ? store.events : [];
  const topicCounts = Object.fromEntries(TOPICS.map((t) => [t.id, 0]));
  topicCounts.otros = 0;

  const termCounts = new Map();

  for (const ev of events) {
    for (const tid of ev.topics || []) {
      topicCounts[tid] = (topicCounts[tid] || 0) + 1;
    }
    for (const term of normalizeTokens(ev.question)) {
      termCounts.set(term, (termCounts.get(term) || 0) + 1);
    }
  }

  const topics = [
    ...TOPICS.map((t) => ({
      id: t.id,
      label: t.label,
      count: topicCounts[t.id] || 0,
    })),
    { id: "otros", label: "Otros temas", count: topicCounts.otros || 0 },
  ]
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);

  const topTerms = [...termCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([term, count]) => ({ term, count }));

  const recent = [...events]
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 25)
    .map((e) => ({
      id: e.id,
      question: e.question,
      at: e.at,
      topics: e.topics,
    }));

  const total = events.length;
  const last24h = events.filter((e) => Date.now() - Date.parse(e.at) < 24 * 3600 * 1000).length;

  return {
    totalQuestions: total,
    last24h,
    topics,
    topTerms,
    recent,
    generatedAt: new Date().toISOString(),
  };
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "32kb" }));

// Allow stable entry page(s) to embed this UI in an iframe.
app.use((_req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    [
      "frame-ancestors",
      "'self'",
      "https://*.supabase.co",
      "https://roxbekpxdgvqbosepmdd.supabase.co",
      "https://palabrapuraia.github.io",
    ].join(" "),
  );
  res.removeHeader("X-Frame-Options");
  next();
});

const WP_POSTS_URL = process.env.WP_POSTS_URL
  || "https://iglesiapalabrapura.com/site/wp-json/wp/v2/posts";
const WP_CATEGORY = process.env.WP_ARTICLES_CATEGORY || "50";

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#8211;/g, "–")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulArticleTitle(title) {
  const t = String(title || "").trim().toLowerCase();
  if (!t) return false;
  if (t === "testimonios" || /^testimonios\s*\d*$/i.test(t)) return false;
  return true;
}

function extractTerms(question, maxTerms = 5) {
  const stop = STOPWORDS;
  const tokens = String(question || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !stop.has(t));
  const unique = [...new Set(tokens)];
  unique.sort((a, b) => b.length - a.length);
  return unique.slice(0, maxTerms);
}

async function fetchWpPosts(search, perPage = 6) {
  const url = new URL(WP_POSTS_URL);
  url.searchParams.set("search", search);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("categories", WP_CATEGORY);
  url.searchParams.set("_fields", "id,date,title,link,excerpt");

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`WP HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data)) return [];
  return data.map((post) => ({
    id: post.id,
    title: stripHtml(post.title?.rendered ?? post.title ?? "Artículo"),
    excerpt: stripHtml(post.excerpt?.rendered ?? post.excerpt ?? ""),
    link: post.link,
    date: post.date ? String(post.date).slice(0, 10) : "",
  }));
}

/** Sinónimos / variantes frecuentes (WP no busca por stemming). */
const TERM_SYNONYMS = {
  orar: ["oracion", "oración", "orar"],
  oracion: ["oracion", "oración", "orar"],
  miedo: ["miedo", "temor", "confianza", "fe"],
  temor: ["temor", "miedo", "fe"],
  fe: ["fe", "confianza", "creer"],
  nacer: ["nacer", "nuevo", "salvacion"],
  dones: ["dones", "espiritu", "carisma"],
  sanidad: ["sanidad", "sanar", "milagro"],
};

/**
 * WordPress trata varias palabras como AND → a menudo [].
 * Buscamos término a término (con sinónimos) y unimos resultados.
 */
async function recommendArticles(question, limit = 3) {
  const terms = extractTerms(question);
  const base = terms.length ? terms.slice(0, 4) : [String(question || "").trim()].filter(Boolean);
  const queries = [];
  for (const term of base) {
    const extras = TERM_SYNONYMS[term] || [term];
    for (const q of extras) {
      if (!queries.includes(q)) queries.push(q);
    }
  }
  const byId = new Map();

  for (const term of queries) {
    try {
      const posts = await fetchWpPosts(term, Math.max(limit + 3, 6));
      for (const post of posts) {
        if (!post.link || !isUsefulArticleTitle(post.title)) continue;
        if (!byId.has(post.id)) byId.set(post.id, post);
      }
      if (byId.size >= limit) break;
    } catch (err) {
      console.warn("[articles]", term, err.message);
    }
  }

  return [...byId.values()].slice(0, limit);
}

app.get("/api/health", (_req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, chatMode: chatMode() });
});

// Cerebro del chat en el mismo contenedor que la página.
app.post("/api/chat", handleChat);
app.get("/api/chat/status", handleChatStatus);

/** Current public Cloudflare quick-tunnel URLs (updated by tunnel-watchdog). */
app.get("/api/public-url", (_req, res) => {
  try {
    if (!fs.existsSync(PUBLIC_URL_FILE)) {
      return res.json({
        ok: false,
        status: "unknown",
        chatUrl: null,
        dashboardUrl: null,
        note: "Aún no hay URL pública registrada. El watchdog la escribirá al recuperar el túnel.",
        updatedAt: null,
      });
    }
    const data = JSON.parse(fs.readFileSync(PUBLIC_URL_FILE, "utf8"));
    res.set("Cache-Control", "no-store");
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok: false, status: "error", error: String(err.message || err) });
  }
});

app.get("/api/articles", async (req, res) => {
  const q = String(req.query.q || req.query.search || "").trim();
  const limit = Math.min(8, Math.max(1, Number(req.query.limit) || 3));
  if (!q || q.length < 2) {
    return res.status(400).json({ error: "q required", articles: [] });
  }
  try {
    const articles = await recommendArticles(q, limit);
    res.set("Cache-Control", "public, max-age=60");
    res.json({ ok: true, q, articles });
  } catch (err) {
    console.error("[articles]", err);
    res.status(502).json({ ok: false, error: "articles unavailable", articles: [] });
  }
});

app.post("/api/analytics/event", (req, res) => {
  const question = String(req.body?.question || "").trim();
  if (!question || question.length < 2) {
    return res.status(400).json({ error: "question required" });
  }
  if (question.length > 500) {
    return res.status(400).json({ error: "question too long" });
  }

  const store = readStore();
  const event = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    question,
    topics: detectTopics(question),
    at: new Date().toISOString(),
  };
  store.events.push(event);
  // keep last 5000
  if (store.events.length > 5000) store.events = store.events.slice(-5000);
  writeStore(store);

  res.status(201).json({ ok: true, id: event.id, topics: event.topics });
});

app.get("/api/analytics/summary", (_req, res) => {
  res.json(buildSummary(readStore()));
});

app.use(express.static(PUBLIC_DIR, {
  extensions: ["html"],
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache");
    }
  },
}));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  // No convertir assets faltantes en index.html (rompe módulos ES).
  if (/\.[a-z0-9]+$/i.test(req.path)) {
    return res.status(404).type("text").send("Not found");
  }
  const index = path.join(PUBLIC_DIR, "index.html");
  if (fs.existsSync(index)) return res.sendFile(index);
  res.status(404).send("Not found");
});

ensureStore();
app.listen(PORT, "0.0.0.0", () => {
  console.log(`palabra-pura-web listening on :${PORT}`);
  console.log(`public=${PUBLIC_DIR} data=${DATA_FILE}`);
  console.log(`chat mode=${chatMode()}`);
});
