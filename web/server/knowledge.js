/**
 * knowledge.js — Base de conocimiento (FAQ cache + feedback).
 *
 * Guarda respuestas bien valoradas (audio, versículos, artículos) para no
 * repetir la búsqueda RAG. Escribe en Postgres local y, si hay credenciales,
 * sincroniza a Supabase (segunda base).
 */

import pg from "pg";

const { Pool } = pg;

let pool = null;

function dbConfig() {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
  const host = process.env.PGHOST;
  if (!host) return null;
  return {
    host,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "palabra_pura",
    user: process.env.PGUSER || "palabra",
    password: process.env.PGPASSWORD || "",
  };
}

function getPool() {
  if (pool) return pool;
  const cfg = dbConfig();
  if (!cfg) return null;
  pool = new Pool(cfg);
  return pool;
}

export function normalizeQuestion(question) {
  return String(question ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?¡!.,;:"'`´]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Huella del índice: si crece el corpus, las entradas pueden marcarse stale. */
export async function indexFingerprint(db = getPool()) {
  if (!db) return "0";
  try {
    const { rows } = await db.query(
      `SELECT
         (SELECT count(*)::text FROM fragment) AS fragments,
         (SELECT count(*)::text FROM video) AS videos`,
    );
    const r = rows[0] || {};
    return `f${r.fragments || 0}-v${r.videos || 0}`;
  } catch {
    return "0";
  }
}

function rowToPayload(row) {
  if (!row) return null;
  const video =
    row.video_youtube_id || row.video_title
      ? {
          title: row.video_title || undefined,
          episode: row.video_episode ?? undefined,
          youtube_id: row.video_youtube_id || undefined,
          start_second: row.video_start_second ?? 0,
        }
      : undefined;

  return {
    answer: row.answer,
    excerpt: row.excerpt || undefined,
    passage: row.passage || undefined,
    passages: row.passages || undefined,
    video,
    source: row.source || (video ? "video" : "biblia"),
    knowledgeId: row.id,
    fromKnowledge: true,
    articles: row.articles || undefined,
  };
}

/**
 * Busca una entrada aprobada y aún válida para la pregunta.
 * @returns {Promise<object|null>}
 */
export async function findKnowledge(question) {
  const db = getPool();
  if (!db) return null;
  const norm = normalizeQuestion(question);
  if (norm.length < 4) return null;

  try {
    const fp = await indexFingerprint(db);
    const { rows } = await db.query(
      `SELECT * FROM knowledge_entry
        WHERE question_norm = $1
          AND status = 'approved'
          AND useful_count >= not_useful_count
        LIMIT 1`,
      [norm],
    );
    const row = rows[0];
    if (!row) return null;

    // Corpus creció mucho respecto a cuando se guardó → no usar (puede haber mejor audio).
    if (row.index_fingerprint && row.index_fingerprint !== fp) {
      await db.query(
        `UPDATE knowledge_entry SET status = 'stale', updated_at = now() WHERE id = $1`,
        [row.id],
      );
      await syncSupabaseUpdate(row.id, { status: "stale" });
      return null;
    }

    return rowToPayload(row);
  } catch (err) {
    console.error("[knowledge] find", err.message);
    return null;
  }
}

function normalizeAlias(value) {
  return normalizeQuestion(value);
}

/**
 * Datos puntuales (horarios, pastores, terminología).
 * Se evalúa antes del FAQ y del RAG.
 */
export async function findFact(question) {
  const db = getPool();
  if (!db) return null;
  const norm = normalizeQuestion(question);
  if (norm.length < 3) return null;

  try {
    const { rows } = await db.query(
      `SELECT id, category, title, content, aliases
         FROM knowledge_fact
        WHERE status = 'active'
        ORDER BY updated_at DESC
        LIMIT 300`,
    );
    if (!rows.length) return null;

    let best = null;
    let bestScore = 0;

    for (const row of rows) {
      const titleNorm = normalizeAlias(row.title);
      const aliases = [
        titleNorm,
        ...(Array.isArray(row.aliases) ? row.aliases.map(normalizeAlias) : []),
      ].filter((a) => a.length >= 2);

      let score = 0;
      for (const alias of aliases) {
        if (norm === alias) score = Math.max(score, 100 + alias.length);
        else if (norm.includes(alias) && alias.length >= 4) {
          score = Math.max(score, 60 + Math.min(alias.length, 40));
        } else if (alias.includes(norm) && norm.length >= 6) {
          score = Math.max(score, 45);
        } else {
          const words = alias.split(" ").filter((w) => w.length > 2);
          if (words.length >= 2 && words.every((w) => norm.includes(w))) {
            score = Math.max(score, 40 + words.length * 5);
          }
        }
      }

      if (score > bestScore) {
        bestScore = score;
        best = row;
      }
    }

    // Umbral: evita disparar con palabras sueltas demasiado cortas.
    if (!best || bestScore < 45) return null;

    return {
      answer: best.content,
      source: "dato",
      knowledgeId: `fact-${best.id}`,
      fromKnowledge: true,
      fromFact: true,
      factCategory: best.category,
      factTitle: best.title,
    };
  } catch (err) {
    if (/relation .*knowledge_fact.* does not exist/i.test(err.message)) return null;
    console.error("[knowledge] findFact", err.message);
    return null;
  }
}

function payloadFields(question, payload, articles, fingerprint) {
  const video = payload?.video || {};
  return {
    question_norm: normalizeQuestion(question),
    question_display: String(question).trim(),
    answer: String(payload?.answer || "").trim(),
    excerpt: payload?.excerpt || null,
    source: payload?.source || null,
    video_title: video.title || null,
    video_episode: video.episode ?? null,
    video_youtube_id: video.youtube_id || null,
    video_start_second: video.start_second ?? null,
    passage: payload?.passage || null,
    passages: payload?.passages || null,
    articles: Array.isArray(articles) && articles.length ? articles : payload?.articles || null,
    index_fingerprint: fingerprint,
  };
}

/** Registra voto y crea/actualiza la entrada en ambas bases cuando aplica. */
export async function recordFeedback({
  vote,
  question,
  knowledgeId = null,
  payload = null,
  articles = null,
}) {
  const db = getPool();
  if (!db) return { ok: false, error: "db unavailable" };

  const v = vote === "not_useful" ? "not_useful" : "useful";
  const norm = normalizeQuestion(question);
  if (norm.length < 4) return { ok: false, error: "question too short" };

  try {
    const fp = await indexFingerprint(db);
    let entryId = knowledgeId ? Number(knowledgeId) : null;

    if (v === "useful") {
      if (entryId) {
        const { rows } = await db.query(
          `UPDATE knowledge_entry
              SET useful_count = useful_count + 1,
                  status = 'approved',
                  updated_at = now()
            WHERE id = $1
            RETURNING *`,
          [entryId],
        );
        const row = rows[0];
        if (row) {
          const fields = payloadFields(question, rowToPayload(row), articles, row.index_fingerprint);
          fields.useful_count = row.useful_count;
          fields.not_useful_count = row.not_useful_count;
          fields.status = row.status;
          await syncSupabaseUpsert(fields, row.id);
        }
      } else if (payload?.answer) {
        const fields = payloadFields(question, payload, articles, fp);
        const { rows } = await db.query(
          `INSERT INTO knowledge_entry (
             question_norm, question_display, answer, excerpt, source,
             video_title, video_episode, video_youtube_id, video_start_second,
             passage, passages, articles, useful_count, status, index_fingerprint
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,1,'approved',$13
           )
           ON CONFLICT (question_norm) DO UPDATE SET
             question_display = EXCLUDED.question_display,
             answer = EXCLUDED.answer,
             excerpt = EXCLUDED.excerpt,
             source = EXCLUDED.source,
             video_title = EXCLUDED.video_title,
             video_episode = EXCLUDED.video_episode,
             video_youtube_id = EXCLUDED.video_youtube_id,
             video_start_second = EXCLUDED.video_start_second,
             passage = EXCLUDED.passage,
             passages = EXCLUDED.passages,
             articles = COALESCE(EXCLUDED.articles, knowledge_entry.articles),
             useful_count = knowledge_entry.useful_count + 1,
             status = 'approved',
             index_fingerprint = EXCLUDED.index_fingerprint,
             updated_at = now()
           RETURNING id`,
          [
            fields.question_norm,
            fields.question_display,
            fields.answer,
            fields.excerpt,
            fields.source,
            fields.video_title,
            fields.video_episode,
            fields.video_youtube_id,
            fields.video_start_second,
            fields.passage ? JSON.stringify(fields.passage) : null,
            fields.passages ? JSON.stringify(fields.passages) : null,
            fields.articles ? JSON.stringify(fields.articles) : null,
            fields.index_fingerprint,
          ],
        );
        entryId = rows[0]?.id ?? null;
        await syncSupabaseUpsert(fields, entryId);
      }
    } else {
      // not_useful
      if (entryId) {
        const { rows } = await db.query(
          `UPDATE knowledge_entry
              SET not_useful_count = not_useful_count + 1,
                  status = CASE
                    WHEN not_useful_count + 1 > useful_count THEN 'rejected'
                    ELSE status
                  END,
                  updated_at = now()
            WHERE id = $1
            RETURNING id, status, useful_count, not_useful_count`,
          [entryId],
        );
        const updated = rows[0];
        if (updated) {
          await syncSupabaseUpdate(updated.id, {
            status: updated.status,
            not_useful_count: updated.not_useful_count,
            useful_count: updated.useful_count,
          });
        }
      } else if (payload?.answer) {
        // Marca negativa sin entrada: crea rejected para no promover ese desfase.
        const fields = payloadFields(question, payload, articles, fp);
        const { rows } = await db.query(
          `INSERT INTO knowledge_entry (
             question_norm, question_display, answer, excerpt, source,
             video_title, video_episode, video_youtube_id, video_start_second,
             passage, passages, articles, useful_count, not_useful_count, status, index_fingerprint
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,0,1,'rejected',$13
           )
           ON CONFLICT (question_norm) DO UPDATE SET
             not_useful_count = knowledge_entry.not_useful_count + 1,
             status = CASE
               WHEN knowledge_entry.not_useful_count + 1 > knowledge_entry.useful_count THEN 'rejected'
               ELSE knowledge_entry.status
             END,
             updated_at = now()
           RETURNING id`,
          [
            fields.question_norm,
            fields.question_display,
            fields.answer,
            fields.excerpt,
            fields.source,
            fields.video_title,
            fields.video_episode,
            fields.video_youtube_id,
            fields.video_start_second,
            fields.passage ? JSON.stringify(fields.passage) : null,
            fields.passages ? JSON.stringify(fields.passages) : null,
            fields.articles ? JSON.stringify(fields.articles) : null,
            fields.index_fingerprint,
          ],
        );
        entryId = rows[0]?.id ?? null;
      }
    }

    await db.query(
      `INSERT INTO knowledge_feedback (entry_id, question_norm, vote) VALUES ($1,$2,$3)`,
      [entryId, norm, v],
    );

    return { ok: true, entryId, vote: v };
  } catch (err) {
    console.error("[knowledge] feedback", err.message);
    return { ok: false, error: err.message };
  }
}

/** Marca stale todas las entradas cuando el índice crece (opcional tras ingesta). */
export async function staleAllKnowledge() {
  const db = getPool();
  if (!db) return { ok: false };
  try {
    const fp = await indexFingerprint(db);
    await db.query(
      `UPDATE knowledge_entry
          SET status = 'stale', updated_at = now()
        WHERE status = 'approved' AND index_fingerprint IS DISTINCT FROM $1`,
      [fp],
    );
    return { ok: true, fingerprint: fp };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function handleKnowledgeFeedback(req, res) {
  const vote = req.body?.vote;
  const question = String(req.body?.question ?? "").trim();
  if (!vote || !question) {
    return res.status(400).json({ ok: false, error: "vote and question required" });
  }
  const result = await recordFeedback({
    vote,
    question,
    knowledgeId: req.body?.knowledgeId ?? null,
    payload: req.body?.payload ?? null,
    articles: req.body?.articles ?? null,
  });
  const status = result.ok ? 200 : 502;
  res.status(status).json(result);
}

// —— Dual-write a Supabase (segunda base) ——

function supabaseConfig() {
  const url = process.env.SUPABASE_URL || "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

async function syncSupabaseUpsert(fields, localId) {
  const cfg = supabaseConfig();
  if (!cfg) return;
  try {
    const body = {
      question_norm: fields.question_norm,
      question_display: fields.question_display,
      answer: fields.answer,
      excerpt: fields.excerpt,
      source: fields.source,
      video_title: fields.video_title,
      video_episode: fields.video_episode,
      video_youtube_id: fields.video_youtube_id,
      video_start_second: fields.video_start_second,
      passage: fields.passage,
      passages: fields.passages,
      articles: fields.articles,
      useful_count: fields.useful_count ?? 1,
      not_useful_count: fields.not_useful_count ?? 0,
      status: fields.status || "approved",
      index_fingerprint: fields.index_fingerprint,
      updated_at: new Date().toISOString(),
    };
    const res = await fetch(`${cfg.url}/rest/v1/knowledge_entry?on_conflict=question_norm`, {
      method: "POST",
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error("[knowledge] supabase upsert", res.status, (await res.text()).slice(0, 200));
    }
  } catch (err) {
    console.error("[knowledge] supabase upsert", err.message);
  }
}

async function syncSupabaseUpdate(id, patch) {
  const cfg = supabaseConfig();
  if (!cfg || !id) return;
  try {
    // Actualiza por id local solo si los ids coinciden; si no, por question no disponible aquí.
    // Preferimos patch por id cuando ambas bases se migraron juntas.
    const res = await fetch(`${cfg.url}/rest/v1/knowledge_entry?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error("[knowledge] supabase patch", res.status, (await res.text()).slice(0, 200));
    }
  } catch (err) {
    console.error("[knowledge] supabase patch", err.message);
  }
}
