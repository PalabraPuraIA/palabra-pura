/**
 * knowledge-hub.js — API local espejo de la Edge Function knowledge-hub.
 */

import pg from "pg";

const { Pool } = pg;
let pool = null;

const FACT_CATEGORIES = new Set([
  "horario",
  "persona",
  "terminologia",
  "lugar",
  "contacto",
  "redes",
  "evento",
  "general",
]);

function getPool() {
  if (pool) return pool;
  if (process.env.DATABASE_URL) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    return pool;
  }
  if (!process.env.PGHOST) return null;
  pool = new Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "palabra_pura",
    user: process.env.PGUSER || "palabra",
    password: process.env.PGPASSWORD || "",
  });
  return pool;
}

function parseAliases(raw) {
  const list = Array.isArray(raw)
    ? raw.map((a) => String(a || "").trim())
    : String(raw || "").split(/[,;\n]/).map((a) => a.trim());
  return [...new Set(list.filter((a) => a.length >= 2))].slice(0, 24);
}

function youtubeId(raw) {
  const text = String(raw || "").trim();
  const m = text.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|^[a-zA-Z0-9_-]{11}$)([a-zA-Z0-9_-]{11})/,
  );
  if (m?.[1]) return m[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(text)) return text;
  try {
    const url = new URL(text);
    const v = url.searchParams.get("v");
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
  } catch {
    /* ignore */
  }
  return "";
}

function chunkText(text, target = 350) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const chunks = [];
  for (let i = 0; i < words.length; i += target) {
    const part = words.slice(i, i + target).join(" ").trim();
    if (part.length >= 20) chunks.push(part);
  }
  return chunks.slice(0, 80);
}

function geminiKeys() {
  return [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    ...(String(process.env.GEMINI_API_KEYS || "").split(",")),
  ]
    .map((k) => String(k || "").trim())
    .filter(Boolean);
}

async function embedDocument(text) {
  const keys = geminiKeys();
  if (!keys.length) return null;
  let last = "unknown";
  for (const key of keys) {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          content: { parts: [{ text: String(text).slice(0, 8000) }] },
          taskType: "RETRIEVAL_DOCUMENT",
          outputDimensionality: 3072,
        }),
      },
    );
    if (!res.ok) {
      last = await res.text();
      continue;
    }
    const data = await res.json();
    const values = data?.embedding?.values;
    if (!values || values.length !== 3072) {
      last = `dims ${values?.length ?? 0}`;
      continue;
    }
    return `[${values.join(",")}]`;
  }
  throw new Error("Gemini embedding: " + String(last).slice(0, 220));
}

async function youtubeTitle(id, fallback = "") {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`,
    );
    if (!res.ok) return fallback || id;
    const data = await res.json();
    return String(data.title || fallback || id).slice(0, 240);
  } catch {
    return fallback || id;
  }
}

async function listAll(db) {
  const facts = await db.query(
    `SELECT id, category, title, content, aliases, status, created_at, updated_at
       FROM ministry_fact ORDER BY updated_at DESC LIMIT 400`,
  ).catch(() => ({ rows: [] }));
  const documents = await db.query(
    `SELECT id, title, category, source_name, status, chunk_count, content, created_at, updated_at
       FROM knowledge_document ORDER BY updated_at DESC LIMIT 200`,
  ).catch(() => ({ rows: [] }));
  const videos = await db.query(
    `SELECT id, youtube_id, title, episode, updated_at, created_at
       FROM video ORDER BY episode DESC NULLS LAST LIMIT 400`,
  ).catch(() => ({ rows: [] }));
  const offers = await db.query(
    `SELECT youtube_id, access_mode, offer_url, offer_label, title FROM content_offer`,
  ).catch(() => ({ rows: [] }));
  const jobs = await db.query(
    `SELECT id, source_type, source_url, title, youtube_id, status, progress, error, fragments_created, created_at, updated_at
       FROM ingest_job ORDER BY created_at DESC LIMIT 80`,
  ).catch(() => ({ rows: [] }));
  const counts = await db.query(`SELECT * FROM video_fragment_counts()`).catch(() => ({ rows: [] }));
  const fragCounts = new Map(counts.rows.map((r) => [Number(r.video_id), r.fragments]));
  const offerMap = new Map(offers.rows.map((o) => [o.youtube_id, o]));
  const catalog = videos.rows.map((v) => {
    const offer = offerMap.get(v.youtube_id);
    return {
      ...v,
      fragments: fragCounts.get(Number(v.id)) ?? 0,
      access_mode: offer?.access_mode || "free",
      offer_url: offer?.offer_url || "",
      offer_label: offer?.offer_label || "",
    };
  });
  return {
    ok: true,
    facts: facts.rows,
    documents: documents.rows.map((d) => ({
      id: d.id,
      title: d.title,
      category: d.category,
      chunks: d.chunk_count || 0,
      preview: String(d.content || "").slice(0, 180),
      status: d.status,
      updated_at: d.updated_at,
    })),
    videos: catalog,
    jobs: jobs.rows,
    stats: {
      facts: facts.rows.filter((f) => f.status === "active").length,
      documents: documents.rows.filter((d) => d.status === "active").length,
      videos: catalog.length,
      paid: catalog.filter((v) => v.access_mode === "paid").length,
      queued: jobs.rows.filter((j) => j.status === "queued" || j.status === "running").length,
    },
  };
}

export async function handleKnowledgeHub(req, res) {
  const db = getPool();
  if (!db) return res.status(503).json({ ok: false, error: "db unavailable" });
  const body = req.method === "GET" ? { action: "list" } : req.body || {};
  const action = String(body.action || body.op || "list").trim();
  res.set("Cache-Control", "no-store");

  try {
    if (action === "list") return res.json(await listAll(db));

    if (action === "saveFact") {
      const category = String(body.category || "general").trim().toLowerCase();
      const title = String(body.title || "").trim();
      const content = String(body.content || "").trim();
      const aliases = parseAliases(body.aliases);
      if (!FACT_CATEGORIES.has(category)) return res.status(400).json({ ok: false, error: "categoría inválida" });
      if (title.length < 2 || content.length < 2) {
        return res.status(400).json({ ok: false, error: "título y contenido requeridos" });
      }
      let embedding = null;
      try {
        embedding = await embedDocument(`${title}. ${content}. ${aliases.join(", ")}`);
      } catch (err) {
        console.warn("[knowledge-hub] fact embed", err.message);
      }
      const { rows } = await db.query(
        `INSERT INTO ministry_fact (category, title, content, aliases, status, embedding)
         VALUES ($1, $2, $3, $4, 'active', $5::halfvec)
         RETURNING *`,
        [category, title, content, aliases, embedding],
      );
      return res.json({ ok: true, fact: rows[0] });
    }

    if (action === "deleteFact") {
      await db.query(`DELETE FROM ministry_fact WHERE id = $1`, [Number(body.id)]);
      return res.json({ ok: true });
    }

    if (action === "saveDocument") {
      const title = String(body.title || "").trim();
      const content = String(body.content || "").trim();
      if (title.length < 2 || content.length < 20) {
        return res.status(400).json({ ok: false, error: "título y texto (mínimo 20 caracteres) requeridos" });
      }
      const chunks = chunkText(content);
      if (!chunks.length) return res.status(400).json({ ok: false, error: "el texto es demasiado corto para indexar" });
      const { rows } = await db.query(
        `INSERT INTO knowledge_document (title, content, category, source_name, chunk_count)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [title, content, String(body.category || "general").slice(0, 40), String(body.source_name || "").slice(0, 160) || null, chunks.length],
      );
      const doc = rows[0];
      for (let i = 0; i < chunks.length; i++) {
        const embedding = await embedDocument(`${title}. ${chunks[i]}`);
        await db.query(
          `INSERT INTO knowledge_doc_chunk (document_id, chunk_pos, content, embedding)
           VALUES ($1, $2, $3, $4::halfvec)`,
          [doc.id, i, chunks[i], embedding],
        );
      }
      return res.json({ ok: true, document: doc, chunks: chunks.length });
    }

    if (action === "deleteDocument") {
      await db.query(`DELETE FROM knowledge_document WHERE id = $1`, [Number(body.id)]);
      return res.json({ ok: true });
    }

    if (action === "queueVideo") {
      const id = youtubeId(String(body.url || body.youtube_id || ""));
      if (!id) return res.status(400).json({ ok: false, error: "link de YouTube inválido" });
      const title = String(body.title || "").trim() || (await youtubeTitle(id));
      const video = await db.query(
        `INSERT INTO video (youtube_id, title, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (youtube_id) DO UPDATE SET title = EXCLUDED.title, updated_at = now()
         RETURNING id, youtube_id, title`,
        [id, title],
      );
      const job = await db.query(
        `INSERT INTO ingest_job (source_type, source_url, title, youtube_id, video_id, status, progress)
         VALUES ('youtube', $1, $2, $3, $4, 'queued', 'En cola para transcribir.')
         RETURNING *`,
        [`https://www.youtube.com/watch?v=${id}`, title, id, video.rows[0].id],
      );
      return res.json({ ok: true, video: video.rows[0], job: job.rows[0] });
    }

    if (action === "setVideoAccess") {
      const id = youtubeId(String(body.youtube_id || body.url || ""));
      if (!id) return res.status(400).json({ ok: false, error: "youtube_id requerido" });
      const access = body.access_mode === "paid" ? "paid" : "free";
      const offerUrl = String(body.offer_url || "").trim().slice(0, 400) || null;
      const offerLabel = String(body.offer_label || "").trim().slice(0, 80) || (access === "paid" ? "Comprar esta enseñanza" : null);
      const { rows } = await db.query(
        `INSERT INTO content_offer (youtube_id, access_mode, offer_url, offer_label, title, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (youtube_id) DO UPDATE
           SET access_mode = EXCLUDED.access_mode,
               offer_url = EXCLUDED.offer_url,
               offer_label = EXCLUDED.offer_label,
               title = COALESCE(EXCLUDED.title, content_offer.title),
               updated_at = now()
         RETURNING *`,
        [id, access, offerUrl, offerLabel, String(body.title || "").trim() || null],
      );
      return res.json({ ok: true, offer: rows[0] });
    }

    return res.status(400).json({ ok: false, error: "acción desconocida" });
  } catch (err) {
    console.error("[knowledge-hub]", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
