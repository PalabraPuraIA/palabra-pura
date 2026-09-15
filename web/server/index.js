/**
 * Lightweight web server: static chat + analytics API + dashboard.
 * Stores questions in a JSON file (no external DB required).
 */

import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chatMode, handleChat, handleChatStatus, handleLifeAreas } from "./chat.js";
import {
  initConversationStore,
  migrateLegacyEvents,
  readConversationEvents,
  recordConversation,
} from "./conversation-store.js";

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
      answer: e.answer ?? null,
      excerpt: e.excerpt ?? null,
      source: e.source ?? null,
      mode: e.mode ?? null,
      video: e.video ?? null,
      passages: e.passages ?? null,
      retrieval: e.retrieval ?? null,
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
  url.searchParams.set("orderby", "relevance");
  url.searchParams.set("_fields", "id,date,title,link,excerpt,content");

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
    // Solo para puntuar; no se envía al navegador.
    body: stripHtml(post.content?.rendered ?? post.content ?? "").slice(0, 6000),
    link: post.link,
    date: post.date ? String(post.date).slice(0, 10) : "",
  }));
}

/** Debajo de esta puntuación el artículo se considera no relacionado. */
const MIN_ARTICLE_SCORE = 5;

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

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Un término cuenta si aparece como palabra o como raíz (dones ⊂ donaciones). */
function countTerm(haystack, term) {
  if (term.length < 3) return 0;
  const root = term.length > 5 ? term.slice(0, -1) : term;
  const matches = haystack.match(new RegExp(`\\b${root}`, "g"));
  return matches ? matches.length : 0;
}

/**
 * Puntúa un artículo frente a la pregunta. El título pesa más que el resumen,
 * los sinónimos aportan menos que las palabras que la persona escribió, y el
 * término con el que WordPress encontró el artículo suma porque indica
 * coincidencia en el cuerpo completo, que aquí no se descarga.
 */
function scoreArticle(post, terms, matchedQueries) {
  const title = normalizeText(post.title);
  const body = normalizeText(`${post.excerpt} ${post.body ?? ""}`);
  let score = 0;

  for (const term of terms) {
    if (countTerm(title, term)) score += 5;
    score += Math.min(countTerm(body, term), 4);
  }
  for (const query of matchedQueries) {
    if (terms.includes(query)) continue;
    if (countTerm(title, query)) score += 3;
    score += Math.min(countTerm(body, query), 2);
  }
  return score;
}

/**
 * WordPress trata varias palabras como AND → a menudo [].
 * Buscamos término a término (con sinónimos), unimos los resultados y
 * devolvemos solo los que realmente hablan de lo que se preguntó.
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
        const known = byId.get(post.id);
        if (known) known.matched.add(normalizeText(term));
        else byId.set(post.id, { post, matched: new Set([normalizeText(term)]) });
      }
    } catch (err) {
      console.warn("[articles]", term, err.message);
    }
  }

  const normalizedTerms = base.map(normalizeText);

  const ranked = [...byId.values()]
    .map(({ post, matched }) => ({ post, score: scoreArticle(post, normalizedTerms, matched) }))
    .filter((entry) => entry.score >= MIN_ARTICLE_SCORE)
    .sort((a, b) => b.score - a.score || String(b.post.date).localeCompare(String(a.post.date)));

  return ranked.slice(0, limit).map(({ post }) => ({
    id: post.id,
    title: post.title,
    excerpt: post.excerpt,
    link: post.link,
    date: post.date,
  }));
}

app.get("/api/health", (_req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, chatMode: chatMode() });
});

// Cerebro del chat en el mismo contenedor que la página.
// Captura exactamente el payload que recibió el usuario y lo guarda antes de
// enviarlo. Así pregunta, respuesta y extracto siempre pertenecen al mismo evento.
app.post("/api/chat", (req, res, next) => {
  const question = String(req.body?.question || "").trim();
  const sendJson = res.json.bind(res);
  let captured = false;

  res.json = (payload) => {
    if (captured || !question || res.statusCode < 200 || res.statusCode >= 400) {
      return sendJson(payload);
    }
    captured = true;
    recordConversation({
      question,
      response: payload,
      topics: detectTopics(question),
    })
      .catch((err) => console.warn("[conversations] save", err.message))
      .finally(() => sendJson(payload));
    return res;
  };

  Promise.resolve(handleChat(req, res)).catch(next);
});
app.get("/api/chat/status", handleChatStatus);
app.get("/api/life-areas", handleLifeAreas);

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

app.post("/api/analytics/event", async (req, res) => {
  const question = String(req.body?.question || "").trim();
  if (!question || question.length < 2) {
    return res.status(400).json({ error: "question required" });
  }
  if (question.length > 500) {
    return res.status(400).json({ error: "question too long" });
  }

  // Compatibilidad con clientes antiguos/directos. La app nueva registra
  // server-side en /api/chat; este endpoint acepta el intercambio completo.
  const topics = detectTopics(question);
  try {
    const id = await recordConversation({
      question,
      response: req.body?.response || {
        answer: req.body?.answer,
        excerpt: req.body?.excerpt,
        source: req.body?.source,
        mode: req.body?.mode,
        video: req.body?.video,
        passages: req.body?.passages,
        retrieval: req.body?.retrieval,
      },
      topics,
    });
    if (!id) return res.status(503).json({ error: "conversation store unavailable" });
    res.status(201).json({ ok: true, id, topics });
  } catch (err) {
    console.warn("[conversations] legacy event", err.message);
    res.status(503).json({ error: "conversation store unavailable" });
  }
});

app.get("/api/analytics/summary", async (_req, res) => {
  try {
    const events = await readConversationEvents();
    res.json(buildSummary({ events: events || readStore().events }));
  } catch (err) {
    console.warn("[conversations] summary", err.message);
    res.json(buildSummary(readStore()));
  }
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
initConversationStore()
  .then(async (available) => {
    if (!available) return;
    const legacy = readStore().events;
    if (legacy?.length) {
      const migrated = await migrateLegacyEvents(legacy);
      console.log(`[conversations] legacy events checked=${migrated}`);
    }
  })
  .catch((err) => console.warn("[conversations] init", err.message));
app.listen(PORT, "0.0.0.0", () => {
  console.log(`palabra-pura-web listening on :${PORT}`);
  console.log(`public=${PUBLIC_DIR} data=${DATA_FILE}`);
  console.log(`chat mode=${chatMode()}`);
});
