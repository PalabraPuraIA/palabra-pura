/**
 * Persistencia de consultas completas para el dashboard.
 * Postgres es la fuente canónica; analytics.json solo se migra como legado.
 */

import crypto from "node:crypto";
import pg from "pg";

const MAX_EVENTS = 5000;
const MAX_ANSWER = 8000;
const MAX_EXCERPT = 4000;

let pool;
let ready;

function dbConfig() {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
  if (!process.env.PGHOST) return null;
  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "palabra_pura",
    user: process.env.PGUSER || "palabra",
    password: process.env.PGPASSWORD || "",
  };
}

function getPool() {
  if (pool) return pool;
  const config = dbConfig();
  if (!config) return null;
  pool = new pg.Pool({
    ...config,
    max: 2,
    idleTimeoutMillis: 30000,
    query_timeout: 4000,
  });
  pool.on("error", (err) => console.error("[conversations] pg pool", err.message));
  return pool;
}

export async function initConversationStore() {
  if (ready) return ready;
  const db = getPool();
  if (!db) return false;

  ready = db
    .query("SELECT 1 FROM public.chat_interactions LIMIT 1")
    .then(() => true)
    .catch((err) => {
      ready = null;
      console.warn("[conversations] table unavailable", err.message);
      return false;
    });
  return ready;
}

const cleanText = (value, max) => {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
};

function cleanVideo(video) {
  if (!video || typeof video !== "object") return null;
  return {
    title: cleanText(video.title, 500),
    episode: Number.isFinite(Number(video.episode)) ? Number(video.episode) : null,
    youtube_id: cleanText(video.youtube_id, 32),
    start_second: Number.isFinite(Number(video.start_second))
      ? Math.max(0, Math.floor(Number(video.start_second)))
      : 0,
  };
}

function cleanPassages(payload) {
  const list =
    Array.isArray(payload?.passages) && payload.passages.length
      ? payload.passages
      : payload?.passage
        ? [payload.passage]
        : [];
  const passages = list
    .slice(0, 8)
    .map((p) => ({
      reference: cleanText(p?.reference, 120),
      bible_version: cleanText(p?.bible_version, 80),
    }))
    .filter((p) => p.reference);
  return passages.length ? passages : null;
}

function cleanRetrieval(payload) {
  const value = payload?.retrieval;
  if (!value || typeof value !== "object") return null;
  return {
    fragment_id: Number.isFinite(Number(value.fragment_id))
      ? Number(value.fragment_id)
      : null,
    position: Number.isFinite(Number(value.position)) ? Number(value.position) : null,
    score: Number.isFinite(Number(value.score)) ? Number(value.score) : null,
    sentence_start: Number.isFinite(Number(value.sentence_start))
      ? Number(value.sentence_start)
      : null,
    sentence_end: Number.isFinite(Number(value.sentence_end))
      ? Number(value.sentence_end)
      : null,
    strategy: cleanText(value.strategy, 80),
  };
}

export async function recordConversation({ question, response, topics = [], id, at }) {
  const db = getPool();
  if (!db || !(await initConversationStore())) return null;

  const q = cleanText(question, 500);
  if (!q || q.length < 2) return null;

  const eventId = cleanText(id, 160) || crypto.randomUUID();
  const createdAt = at && !Number.isNaN(Date.parse(at)) ? new Date(at) : new Date();

  await db.query(
    `INSERT INTO public.chat_interactions
       (id, question, answer, excerpt, source, mode, topics, video, passages, retrieval_meta, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11)
     ON CONFLICT (id) DO NOTHING`,
    [
      eventId,
      q,
      cleanText(response?.answer, MAX_ANSWER),
      cleanText(response?.excerpt, MAX_EXCERPT),
      cleanText(response?.source, 40),
      cleanText(response?.mode, 40),
      Array.isArray(topics) ? topics.slice(0, 12).map(String) : [],
      JSON.stringify(cleanVideo(response?.video)),
      JSON.stringify(cleanPassages(response)),
      JSON.stringify(cleanRetrieval(response)),
      createdAt,
    ],
  );

  return eventId;
}

export async function migrateLegacyEvents(events) {
  if (!Array.isArray(events) || !events.length) return 0;
  let migrated = 0;
  for (const event of events) {
    const id = `legacy:${cleanText(event?.id, 140) || crypto.randomUUID()}`;
    const saved = await recordConversation({
      id,
      question: event?.question,
      response: {},
      topics: event?.topics,
      at: event?.at,
    });
    if (saved) migrated += 1;
  }
  return migrated;
}

export async function readConversationEvents(limit = MAX_EVENTS) {
  const db = getPool();
  if (!db || !(await initConversationStore())) return null;
  const safeLimit = Math.min(MAX_EVENTS, Math.max(1, Number(limit) || MAX_EVENTS));
  const { rows } = await db.query(
    `SELECT id, question, answer, excerpt, source, mode, topics,
            video, passages, retrieval_meta AS retrieval, created_at AS at
       FROM public.chat_interactions
      ORDER BY created_at DESC
      LIMIT $1`,
    [safeLimit],
  );
  return rows.map((row) => ({
    ...row,
    at: row.at instanceof Date ? row.at.toISOString() : row.at,
  }));
}
