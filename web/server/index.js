/**
 * Lightweight web server: static chat + analytics API + dashboard.
 * Stores questions in a JSON file (no external DB required).
 */

import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 80);
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "analytics.json");

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
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
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

app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  const index = path.join(PUBLIC_DIR, "index.html");
  if (fs.existsSync(index)) return res.sendFile(index);
  res.status(404).send("Not found");
});

ensureStore();
app.listen(PORT, "0.0.0.0", () => {
  console.log(`palabra-pura-web listening on :${PORT}`);
  console.log(`public=${PUBLIC_DIR} data=${DATA_FILE}`);
});
