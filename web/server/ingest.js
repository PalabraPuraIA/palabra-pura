/**
 * ingest.js — Encola y procesa links YouTube / audio / video:
 * transcribe → chunk → embed (Gemini 3072) → video + fragment en Postgres.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

const EMBED_MODEL = "gemini-embedding-001";
const EMBED_DIMS = 3072;
const CHUNK_WORDS = 300;
const GROQ_TRANSCRIBE = "https://api.groq.com/openai/v1/audio/transcriptions";

let pool = null;
let busy = false;

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

function ingestDir() {
  const base = process.env.INGEST_DIR || path.join(process.env.DATA_DIR || "/data", "ingest");
  fs.mkdirSync(base, { recursive: true });
  return base;
}

export function extractYoutubeId(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.split("/").filter(Boolean)[0];
      return id && id.length === 11 ? id : null;
    }
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v && v.length === 11) return v;
      const m = u.pathname.match(/\/(shorts|live|embed)\/([a-zA-Z0-9_-]{11})/);
      if (m) return m[2];
    }
  } catch {
    /* ignore */
  }
  const loose = s.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})(?:[&?]|$)/);
  return loose ? loose[1] : null;
}

async function setJob(db, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  sets.push("updated_at = now()");
  await db.query(
    `UPDATE ingest_job SET ${sets.join(", ")} WHERE id = $1`,
    [id, ...keys.map((k) => fields[k])],
  );
}

/** GET /api/ingest/jobs */
export async function handleIngestList(_req, res) {
  const db = getPool();
  if (!db) return res.status(503).json({ ok: false, error: "db unavailable" });
  try {
    const { rows } = await db.query(
      `SELECT id, source_type, source_url, title, youtube_id, video_id, status,
              progress, error, fragments_created, created_at, updated_at, finished_at
         FROM ingest_job
        ORDER BY created_at DESC
        LIMIT 50`,
    );
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, jobs: rows });
  } catch (err) {
    if (/relation .*ingest_job.* does not exist/i.test(err.message)) {
      return res.json({ ok: true, jobs: [], note: "Aplica db/migrations/20260926_ingest_jobs.sql" });
    }
    res.status(502).json({ ok: false, error: err.message });
  }
}

/** GET /api/ingest/jobs/:id */
export async function handleIngestGet(req, res) {
  const db = getPool();
  if (!db) return res.status(503).json({ ok: false, error: "db unavailable" });
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "id required" });
  try {
    const { rows } = await db.query(`SELECT * FROM ingest_job WHERE id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true, job: rows[0] });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
}

/**
 * POST /api/ingest — JSON { url, title? } o multipart (file + title?).
 * Multer deja req.file cuando hay archivo.
 */
export async function handleIngestCreate(req, res) {
  const db = getPool();
  if (!db) return res.status(503).json({ ok: false, error: "db unavailable" });

  const title = String(req.body?.title || "").trim() || null;
  const url = String(req.body?.url || req.body?.link || "").trim();
  const file = req.file;

  let sourceType;
  let sourceUrl = null;
  let localPath = null;
  let youtubeId = null;

  if (file) {
    const mime = String(file.mimetype || "");
    sourceType = mime.startsWith("video/") ? "video" : "audio";
    const ext = path.extname(file.originalname || "") || (sourceType === "video" ? ".mp4" : ".mp3");
    const dest = path.join(ingestDir(), `${Date.now()}-${randomBytes(4).toString("hex")}${ext}`);
    fs.renameSync(file.path, dest);
    localPath = dest;
  } else if (url) {
    youtubeId = extractYoutubeId(url);
    if (!youtubeId) {
      return res.status(400).json({ ok: false, error: "URL de YouTube inválida" });
    }
    sourceType = "youtube";
    sourceUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
  } else {
    return res.status(400).json({ ok: false, error: "Envía un link de YouTube o un archivo de audio/video" });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO ingest_job (source_type, source_url, local_path, title, youtube_id, status, progress)
       VALUES ($1, $2, $3, $4, $5, 'queued', 'En cola')
       RETURNING *`,
      [sourceType, sourceUrl, localPath, title, youtubeId],
    );
    const job = rows[0];
    res.status(201).json({ ok: true, job });
    kickWorker();
  } catch (err) {
    if (/relation .*ingest_job.* does not exist/i.test(err.message)) {
      return res.status(503).json({
        ok: false,
        error: "Falta la tabla ingest_job. Aplica db/migrations/20260926_ingest_jobs.sql",
      });
    }
    console.error("[ingest-create]", err);
    res.status(502).json({ ok: false, error: err.message });
  }
}

export function kickWorker() {
  if (busy) return;
  setImmediate(() => {
    processNext().catch((err) => console.error("[ingest-worker]", err));
  });
}

async function processNext() {
  if (busy) return;
  const db = getPool();
  if (!db) return;
  busy = true;
  try {
    for (;;) {
      const client = await db.connect();
      let job;
      try {
        await client.query("BEGIN");
        const { rows } = await client.query(
          `SELECT * FROM ingest_job
            WHERE status = 'queued'
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED`,
        );
        job = rows[0] || null;
        if (job) {
          await client.query(
            `UPDATE ingest_job SET status = 'running', progress = 'Iniciando…', updated_at = now()
              WHERE id = $1`,
            [job.id],
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      if (!job) break;
      job.status = "running";
      await runJob(db, job);
    }
  } finally {
    busy = false;
  }
}

async function runJob(db, job) {
  const id = job.id;
  try {
    await setJob(db, id, { status: "running", progress: "Iniciando…", error: null });

    let audioPath = job.local_path;
    let youtubeId = job.youtube_id;
    let title = job.title;
    let segments;

    if (job.source_type === "youtube") {
      await setJob(db, id, { progress: "Buscando subtítulos / audio de YouTube…" });
      const fromCaps = await tryYoutubeCaptions(youtubeId);
      if (fromCaps) {
        segments = fromCaps.segments;
        title = title || fromCaps.title || `YouTube ${youtubeId}`;
      } else {
        audioPath = await downloadYoutubeAudio(youtubeId, ingestDir());
        await setJob(db, id, { progress: "Transcribiendo con Whisper…" });
        const tr = await transcribeGroq(audioPath);
        segments = tr.segments;
        title = title || tr.title || `YouTube ${youtubeId}`;
      }
    } else {
      if (!audioPath || !fs.existsSync(audioPath)) {
        throw new Error("Archivo local no encontrado");
      }
      await setJob(db, id, { progress: "Transcribiendo con Whisper…" });
      const tr = await transcribeGroq(audioPath);
      segments = tr.segments;
      title = title || path.basename(job.local_path || "audio");
      youtubeId = youtubeId || `local-${id}-${randomBytes(3).toString("hex")}`;
    }

    if (!segments?.length) throw new Error("Transcripción vacía");

    await setJob(db, id, { progress: "Fragmentando texto…", title, youtube_id: youtubeId });
    const chunks = chunkSegments(segments, CHUNK_WORDS);
    if (!chunks.length) throw new Error("No se generaron fragmentos");

    await setJob(db, id, { progress: `Indexando ${chunks.length} fragmentos…` });
    const videoId = await upsertVideo(db, { youtubeId, title });
    const n = await saveFragments(db, videoId, chunks);

    await setJob(db, id, {
      status: "done",
      progress: `Listo · ${n} fragmentos`,
      video_id: videoId,
      youtube_id: youtubeId,
      title,
      fragments_created: n,
      finished_at: new Date().toISOString(),
      error: null,
    });
  } catch (err) {
    console.error(`[ingest #${id}]`, err);
    await setJob(db, id, {
      status: "error",
      progress: "Error",
      error: String(err.message || err).slice(0, 2000),
      finished_at: new Date().toISOString(),
    });
  }
}

async function tryYoutubeCaptions(youtubeId) {
  const langs = ["es", "es-419", "es-ES", "en"];
  for (const lang of langs) {
    for (const fmt of ["json3", "vtt"]) {
      try {
        const url = `https://www.youtube.com/api/timedtext?v=${youtubeId}&lang=${lang}&fmt=${fmt}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) continue;
        const text = await res.text();
        if (!text || text.length < 40) continue;
        const segments = fmt === "json3" ? parseJson3Captions(text) : parseVttCaptions(text);
        if (segments.length) {
          return { segments, title: null };
        }
      } catch {
        /* next */
      }
    }
  }
  return null;
}

function parseJson3Captions(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const events = data.events || [];
  const out = [];
  for (const ev of events) {
    if (!ev.segs) continue;
    const text = ev.segs.map((s) => s.utf8 || "").join("").replace(/\n/g, " ").trim();
    if (!text) continue;
    const start = (ev.tStartMs || 0) / 1000;
    const dur = (ev.dDurationMs || 0) / 1000;
    out.push({ start, end: start + dur, text });
  }
  return out;
}

function parseVttCaptions(raw) {
  const lines = String(raw).replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(
      /(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})/,
    );
    if (m) {
      const start = vttTime(m[1]);
      const end = vttTime(m[2]);
      i += 1;
      const parts = [];
      while (i < lines.length && lines[i].trim()) {
        parts.push(lines[i].replace(/<[^>]+>/g, ""));
        i += 1;
      }
      const text = parts.join(" ").replace(/\s+/g, " ").trim();
      if (text) out.push({ start, end, text });
    }
    i += 1;
  }
  return out;
}

function vttTime(s) {
  const [h, m, rest] = s.replace(",", ".").split(":");
  const sec = Number(rest);
  return Number(h) * 3600 + Number(m) * 60 + sec;
}

function downloadYoutubeAudio(youtubeId, dir) {
  return new Promise((resolve, reject) => {
    const outTpl = path.join(dir, `yt-${youtubeId}.%(ext)s`);
    const finalMp3 = path.join(dir, `yt-${youtubeId}.mp3`);
    const bin = process.env.YT_DLP_PATH || "yt-dlp";
    const args = [
      "-f", "bestaudio/best",
      "-x", "--audio-format", "mp3",
      "--audio-quality", "5",
      "-o", outTpl,
      "--no-playlist",
      `https://www.youtube.com/watch?v=${youtubeId}`,
    ];
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("error", (e) => {
      reject(new Error(
        `No se pudo descargar el audio (¿yt-dlp instalado?). Sube el archivo o usa un video con subtítulos. ${e.message}`,
      ));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(
          `yt-dlp falló (código ${code}). Si no hay subtítulos, sube el audio/video. ${err.slice(-400)}`,
        ));
      }
      if (fs.existsSync(finalMp3)) return resolve(finalMp3);
      const found = fs.readdirSync(dir).find((f) => f.startsWith(`yt-${youtubeId}.`));
      if (found) return resolve(path.join(dir, found));
      reject(new Error("yt-dlp terminó pero no hay archivo de audio"));
    });
  });
}

async function transcribeGroq(filePath) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("Falta GROQ_API_KEY para transcribir audio");

  const buf = fs.readFileSync(filePath);
  const name = path.basename(filePath);
  const form = new FormData();
  form.append("file", new Blob([buf]), name);
  form.append("model", "whisper-large-v3");
  form.append("response_format", "verbose_json");
  form.append("language", "es");

  const res = await fetch(GROQ_TRANSCRIBE, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(600000),
  });
  if (!res.ok) {
    throw new Error(`Groq Whisper ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const data = await res.json();
  const segments = (data.segments || []).map((s) => ({
    start: Number(s.start) || 0,
    end: Number(s.end) || 0,
    text: String(s.text || "").trim(),
  })).filter((s) => s.text);

  if (!segments.length && data.text) {
    segments.push({ start: 0, end: 0, text: String(data.text).trim() });
  }
  return { segments, title: null };
}

function chunkSegments(segments, maxWords) {
  const chunks = [];
  let buf = [];
  let words = 0;
  let start = segments[0]?.start ?? 0;

  const flush = () => {
    if (!buf.length) return;
    const content = buf.join(" ").replace(/\s+/g, " ").trim();
    if (!content) return;
    chunks.push({
      content,
      start_second: Math.max(0, Math.floor(start)),
      word_count: content.split(/\s+/).filter(Boolean).length,
    });
    buf = [];
    words = 0;
  };

  for (const seg of segments) {
    const w = seg.text.split(/\s+/).filter(Boolean);
    if (!buf.length) start = seg.start;
    if (words && words + w.length > maxWords) flush();
    if (!buf.length) start = seg.start;
    buf.push(seg.text);
    words += w.length;
  }
  flush();
  return chunks;
}

async function embedDocument(text) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Falta GEMINI_API_KEY para embeddings");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text }] },
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: EMBED_DIMS,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Gemini embed ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  const values = data.embedding?.values;
  if (!values || values.length !== EMBED_DIMS) {
    throw new Error(`Embedding inválido (${values?.length ?? 0} dims)`);
  }
  return values;
}

async function upsertVideo(db, { youtubeId, title }) {
  const { rows } = await db.query(
    `INSERT INTO video (youtube_id, title, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (youtube_id) DO UPDATE
       SET title = COALESCE(EXCLUDED.title, video.title),
           updated_at = now()
     RETURNING id`,
    [youtubeId, title || youtubeId],
  );
  return rows[0].id;
}

async function saveFragments(db, videoId, chunks) {
  await db.query(`DELETE FROM fragment WHERE video_id = $1`, [videoId]);
  let n = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const embedding = await embedDocument(c.content);
    await db.query(
      `INSERT INTO fragment (video_id, position, content, embedding, start_second, word_count)
       VALUES ($1, $2, $3, $4::halfvec, $5, $6)`,
      [videoId, i + 1, c.content, JSON.stringify(embedding), c.start_second, c.word_count],
    );
    n += 1;
    // suave rate-limit Gemini
    if (i % 5 === 4) await new Promise((r) => setTimeout(r, 400));
  }
  return n;
}

/** Stats del corpus indexado (videos/fragmentos) para el dashboard. */
export async function handleCorpusStats(_req, res) {
  const db = getPool();
  if (!db) return res.status(503).json({ ok: false, error: "db unavailable" });
  try {
    const { rows } = await db.query(
      `SELECT
         (SELECT count(*)::int FROM video) AS videos,
         (SELECT count(*)::int FROM fragment) AS fragments,
         (SELECT count(*)::int FROM knowledge_entry) AS knowledge,
         (SELECT count(*)::int FROM knowledge_entry WHERE status = 'approved') AS knowledge_approved`,
    );
    const { rows: recent } = await db.query(
      `SELECT id, youtube_id, title, episode, duration_seconds, created_at, updated_at,
              (SELECT count(*)::int FROM fragment f WHERE f.video_id = v.id) AS fragments
         FROM video v
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 40`,
    );
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, stats: rows[0], videos: recent });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
}

// Arranca cola al cargar el módulo (por si quedó algo en queued).
setTimeout(() => kickWorker(), 3000);
