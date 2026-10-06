/**
 * knowledge-admin.js — API para ver/gestionar la base de conocimiento desde el dashboard.
 */

import pg from "pg";

const { Pool } = pg;
let pool = null;

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

/** GET /api/knowledge — lista entradas + stats. */
export async function handleKnowledgeList(_req, res) {
  const db = getPool();
  if (!db) return res.status(503).json({ ok: false, error: "db unavailable" });

  try {
    const { rows: stats } = await db.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE status = 'approved')::int AS approved,
         count(*) FILTER (WHERE status = 'stale')::int AS stale,
         count(*) FILTER (WHERE status = 'rejected')::int AS rejected,
         coalesce(sum(useful_count), 0)::int AS useful_votes,
         coalesce(sum(not_useful_count), 0)::int AS not_useful_votes
       FROM knowledge_entry`,
    );
    const { rows } = await db.query(
      `SELECT id, question_display, question_norm, answer, excerpt, source,
              video_title, video_episode, video_youtube_id, video_start_second,
              useful_count, not_useful_count, status, index_fingerprint,
              created_at, updated_at,
              CASE WHEN articles IS NULL THEN 0 ELSE jsonb_array_length(articles) END AS articles_n
         FROM knowledge_entry
        ORDER BY updated_at DESC
        LIMIT 200`,
    );
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, stats: stats[0] || {}, entries: rows });
  } catch (err) {
    if (/relation .*knowledge_entry.* does not exist/i.test(err.message)) {
      return res.json({
        ok: true,
        stats: { total: 0, approved: 0, stale: 0, rejected: 0, useful_votes: 0, not_useful_votes: 0 },
        entries: [],
        note: "Aplica db/migrations/20260926_knowledge_base.sql",
      });
    }
    console.error("[knowledge-list]", err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
}

/** PATCH /api/knowledge/:id — cambia status (approved|stale|rejected). */
export async function handleKnowledgePatch(req, res) {
  const db = getPool();
  if (!db) return res.status(503).json({ ok: false, error: "db unavailable" });
  const id = Number(req.params.id);
  const status = String(req.body?.status || "").trim();
  if (!id || !["approved", "stale", "rejected"].includes(status)) {
    return res.status(400).json({ ok: false, error: "id and status required" });
  }
  try {
    const { rows } = await db.query(
      `UPDATE knowledge_entry SET status = $2, updated_at = now()
        WHERE id = $1 RETURNING id, status`,
      [id, status],
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true, entry: rows[0] });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
}

/** DELETE /api/knowledge/:id */
export async function handleKnowledgeDelete(req, res) {
  const db = getPool();
  if (!db) return res.status(503).json({ ok: false, error: "db unavailable" });
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "id required" });
  try {
    await db.query(`DELETE FROM knowledge_feedback WHERE entry_id = $1`, [id]);
    const { rowCount } = await db.query(`DELETE FROM knowledge_entry WHERE id = $1`, [id]);
    if (!rowCount) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
}

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

function parseAliases(raw) {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((a) => String(a || "").trim()).filter((a) => a.length >= 2))].slice(0, 20);
  }
  return [
    ...new Set(
      String(raw || "")
        .split(/[,;\n]/)
        .map((a) => a.trim())
        .filter((a) => a.length >= 2),
    ),
  ].slice(0, 20);
}

/** GET /api/facts */
export async function handleFactsList(_req, res) {
  const db = getPool();
  if (!db) return res.status(503).json({ ok: false, error: "db unavailable" });
  try {
    const { rows } = await db.query(
      `SELECT id, category, title, content, aliases, status, created_at, updated_at
         FROM knowledge_fact
        ORDER BY
          CASE status WHEN 'active' THEN 0 ELSE 1 END,
          updated_at DESC
        LIMIT 300`,
    );
    const { rows: stats } = await db.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE status = 'active')::int AS active,
         count(*) FILTER (WHERE status = 'archived')::int AS archived
       FROM knowledge_fact`,
    );
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, stats: stats[0] || {}, facts: rows });
  } catch (err) {
    if (/relation .*knowledge_fact.* does not exist/i.test(err.message)) {
      return res.json({
        ok: true,
        stats: { total: 0, active: 0, archived: 0 },
        facts: [],
        note: "Aplica db/migrations/20260926_knowledge_facts.sql",
      });
    }
    res.status(502).json({ ok: false, error: err.message });
  }
}

/** POST /api/facts */
export async function handleFactCreate(req, res) {
  const db = getPool();
  if (!db) return res.status(503).json({ ok: false, error: "db unavailable" });

  const category = String(req.body?.category || "general").trim().toLowerCase();
  const title = String(req.body?.title || "").trim();
  const content = String(req.body?.content || "").trim();
  const aliases = parseAliases(req.body?.aliases);

  if (!FACT_CATEGORIES.has(category)) {
    return res.status(400).json({ ok: false, error: "categoría inválida" });
  }
  if (title.length < 2 || title.length > 200) {
    return res.status(400).json({ ok: false, error: "título requerido (2–200)" });
  }
  if (content.length < 2 || content.length > 4000) {
    return res.status(400).json({ ok: false, error: "contenido requerido (2–4000)" });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO knowledge_fact (category, title, content, aliases, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING *`,
      [category, title, content, aliases],
    );
    res.status(201).json({ ok: true, fact: rows[0] });
  } catch (err) {
    if (/relation .*knowledge_fact.* does not exist/i.test(err.message)) {
      return res.status(503).json({
        ok: false,
        error: "Falta la tabla knowledge_fact. Aplica la migración.",
      });
    }
    res.status(502).json({ ok: false, error: err.message });
  }
}

/** PATCH /api/facts/:id */
export async function handleFactPatch(req, res) {
  const db = getPool();
  if (!db) return res.status(503).json({ ok: false, error: "db unavailable" });
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "id required" });

  const fields = [];
  const vals = [id];
  const body = req.body || {};

  if (body.category != null) {
    const category = String(body.category).trim().toLowerCase();
    if (!FACT_CATEGORIES.has(category)) {
      return res.status(400).json({ ok: false, error: "categoría inválida" });
    }
    vals.push(category);
    fields.push(`category = $${vals.length}`);
  }
  if (body.title != null) {
    const title = String(body.title).trim();
    if (title.length < 2 || title.length > 200) {
      return res.status(400).json({ ok: false, error: "título inválido" });
    }
    vals.push(title);
    fields.push(`title = $${vals.length}`);
  }
  if (body.content != null) {
    const content = String(body.content).trim();
    if (content.length < 2 || content.length > 4000) {
      return res.status(400).json({ ok: false, error: "contenido inválido" });
    }
    vals.push(content);
    fields.push(`content = $${vals.length}`);
  }
  if (body.aliases != null) {
    vals.push(parseAliases(body.aliases));
    fields.push(`aliases = $${vals.length}`);
  }
  if (body.status != null) {
    const status = String(body.status).trim();
    if (!["active", "archived"].includes(status)) {
      return res.status(400).json({ ok: false, error: "status inválido" });
    }
    vals.push(status);
    fields.push(`status = $${vals.length}`);
  }

  if (!fields.length) {
    return res.status(400).json({ ok: false, error: "nada que actualizar" });
  }
  fields.push("updated_at = now()");

  try {
    const { rows } = await db.query(
      `UPDATE knowledge_fact SET ${fields.join(", ")} WHERE id = $1 RETURNING *`,
      vals,
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true, fact: rows[0] });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
}

/** DELETE /api/facts/:id */
export async function handleFactDelete(req, res) {
  const db = getPool();
  if (!db) return res.status(503).json({ ok: false, error: "db unavailable" });
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "id required" });
  try {
    const { rowCount } = await db.query(`DELETE FROM knowledge_fact WHERE id = $1`, [id]);
    if (!rowCount) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
}
