#!/usr/bin/env node
/**
 * Transcribe a local audio file with Groq Whisper and index it in Palabra Pura cloud.
 *
 *   node stack/scripts/ingest-audio-cloud.mjs --file "/path/audio.mp3" --title "METAMORFOSIS - 038 - AUDIO" --paid
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SUPABASE_URL = "https://jkffgudzlcemapxprbws.supabase.co";
const HUB = `${SUPABASE_URL}/functions/v1/knowledge-hub`;
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const EMBED_MODEL = "gemini-embedding-001";
const EMBED_DIMS = 3072;
const ANON = "sb_publishable_WVH-EXfKrrBn9P8US9OA0w_Py4FSmzW";
const CHUNK_SEC = 12 * 60;
const TARGET_WORDS = 300;

const args = process.argv.slice(2);
const filePath = argValue("--file");
const title = argValue("--title") || "Audio";
const episode = Number(argValue("--episode") || 0) || null;
const paid = args.includes("--paid");
const partsDir = argValue("--parts-dir");

loadEnv(path.join(ROOT, "stack/.env"));
loadEnv("/Users/fintekauto/Desktop/palabra-pura-copia-2026-09-15/stack/.env");

const GROQ_KEY = process.env.GROQ_API_KEY || "";
const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
]
  .map((k) => String(k || "").trim())
  .filter(Boolean);
const DB_PASS = process.env.SUPABASE_DB_PASSWORD || process.env.POSTGRES_PASSWORD || "";

function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? String(args[i + 1] || "").trim() : "";
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function splitAudio(src) {
  if (partsDir && fs.existsSync(partsDir)) {
    const existing = fs.readdirSync(partsDir).filter((n) => n.endsWith(".mp3")).sort();
    if (existing.length) {
      return existing.map((n, i) => ({ path: path.join(partsDir, n), offsetSec: i * CHUNK_SEC }));
    }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-audio-"));
  const pattern = path.join(dir, "part-%03d.mp3");
  const r = spawnSync("ffmpeg", [
    "-y", "-i", src,
    "-f", "segment",
    "-segment_time", String(CHUNK_SEC),
    "-c:a", "libmp3lame",
    "-b:a", "64k",
    "-ac", "1",
    pattern,
  ], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`ffmpeg: ${(r.stderr || r.stdout || "").slice(-400)}`);
  }
  return fs.readdirSync(dir)
    .filter((n) => n.endsWith(".mp3"))
    .sort()
    .map((n, i) => ({ path: path.join(dir, n), offsetSec: i * CHUNK_SEC }));
}

async function transcribePart(partPath) {
  const buf = fs.readFileSync(partPath);
  const form = new FormData();
  form.append("file", new Blob([buf]), path.basename(partPath));
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "es");
  form.append("response_format", "verbose_json");
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_KEY}` },
    body: form,
    signal: AbortSignal.timeout(600000),
  });
  if (!res.ok) throw new Error(`Groq Whisper ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  const segments = (data.segments || [])
    .map((s) => ({ start: Number(s.start) || 0, text: String(s.text || "").trim() }))
    .filter((s) => s.text);
  if (!segments.length && data.text) segments.push({ start: 0, text: String(data.text).trim() });
  return segments;
}

function chunkSegments(segments) {
  const chunks = [];
  let buf = [];
  let words = 0;
  let start = 0;
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
    const n = seg.text.split(/\s+/).filter(Boolean).length;
    if (!buf.length) start = seg.start;
    if (words && words + n > TARGET_WORDS) flush();
    if (!buf.length) start = seg.start;
    buf.push(seg.text);
    words += n;
  }
  flush();
  return chunks;
}

async function embedText(text) {
  let last = "unknown";
  for (const key of GEMINI_KEYS) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text: text.slice(0, 8000) }] },
          taskType: "RETRIEVAL_DOCUMENT",
          outputDimensionality: EMBED_DIMS,
        }),
        signal: AbortSignal.timeout(45000),
      },
    );
    if (!res.ok) {
      last = await res.text();
      continue;
    }
    const values = (await res.json())?.embedding?.values;
    if (!values || values.length !== EMBED_DIMS) {
      last = `dims ${values?.length ?? 0}`;
      continue;
    }
    return `[${values.join(",")}]`;
  }
  throw new Error("Gemini embedding: " + String(last).slice(0, 220));
}

async function saveViaHub(segments) {
  const chunks = chunkSegments(segments);
  const sourceId = argValue("--id") || title;
  const imported = await fetch(HUB, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ANON}`,
      apikey: ANON,
    },
    body: JSON.stringify({
      action: "importTranscriptChunks",
      title,
      youtube_id: sourceId,
      chunks,
    }),
    signal: AbortSignal.timeout(600000),
  });
  const importedData = await imported.json().catch(() => ({}));
  if (imported.ok && importedData.ok !== false) {
    if (paid) {
      await fetch(HUB, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ANON}`,
          apikey: ANON,
        },
        body: JSON.stringify({
          action: "setVideoAccess",
          youtube_id: sourceId,
          access_mode: "paid",
          title,
          offer_label: "Comprar esta enseñanza",
          offer_url: "https://iglesiapalabrapura.com/site/product/metamorfosis/",
        }),
      }).catch(() => {});
    }
    return { ...importedData, fragments: importedData.fragments || chunks.length };
  }
  const res = await fetch(HUB, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ANON}`,
      apikey: ANON,
    },
    body: JSON.stringify({
      action: "ingestTranscript",
      title,
      episode,
      youtube_id: sourceId,
      access_mode: paid ? "paid" : "free",
      offer_label: paid ? "Comprar esta enseñanza" : "",
      segments,
    }),
    signal: AbortSignal.timeout(600000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Hub ${res.status}`);
  }
  return data;
}

async function sb(pathName, { method = "GET", query = "", body } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathName}${query ? `?${query}` : ""}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    throw new Error(`${method} ${pathName} ${res.status}: ${typeof data === "string" ? data.slice(0, 240) : JSON.stringify(data).slice(0, 240)}`);
  }
  return data;
}

async function saveViaKnowledgeChunks(chunks) {
  const sourceId = String(argValue("--id") || "audio38meta");
  const stub = `«${title}» es una enseñanza de pago del ministerio. No se entrega completa en el chat. Puedes adquirirla aquí: https://iglesiapalabrapura.com/site/product/metamorfosis/`;
  const fullText = chunks.map((c, i) => `[${i + 1}] ${c.content}`).join("\n\n");
  const docs = await sb("knowledge_document", {
    method: "POST",
    body: {
      title,
      content: fullText,
      category: "paid",
      source_name: sourceId,
      chunk_count: chunks.length,
      status: "active",
    },
  });
  const doc = Array.isArray(docs) ? docs[0] : docs;
  if (!doc?.id) throw new Error("No se pudo crear el documento");
  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embedText(chunks[i].content);
    await sb("knowledge_doc_chunk", {
      method: "POST",
      body: {
        document_id: doc.id,
        chunk_pos: i,
        content: stub,
        embedding,
      },
    });
    process.stdout.write(`  chunk ${i + 1}/${chunks.length}\r`);
  }
  process.stdout.write("\n");
  return { document: doc, fragments: chunks.length, mode: "paid-doc" };
}

async function saveViaPostgres(chunks) {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const pg = require("/tmp/pp-pg/node_modules/pg");
  if (!DB_PASS) throw new Error("Falta SUPABASE_DB_PASSWORD");
  const client = new pg.Client({
    host: "aws-0-us-west-2.pooler.supabase.com",
    port: 5432,
    database: "postgres",
    user: "postgres.jkffgudzlcemapxprbws",
    password: DB_PASS,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const sourceId = String(argValue("--id") || "audio-38-metamorfosis");
    const upsert = await client.query(
      `INSERT INTO video (youtube_id, title, episode, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (youtube_id) DO UPDATE SET title = EXCLUDED.title, episode = EXCLUDED.episode, updated_at = now()
       RETURNING id, youtube_id, title`,
      [sourceId, title, episode],
    );
    const videoId = upsert.rows[0].id;
    await client.query("DELETE FROM fragment WHERE video_id = $1", [videoId]);
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await embedText(chunks[i].content);
      await client.query(
        `INSERT INTO fragment (video_id, position, content, embedding, start_second, word_count)
         VALUES ($1, $2, $3, $4::halfvec, $5, $6)`,
        [videoId, i, chunks[i].content, embedding, chunks[i].start_second, chunks[i].word_count],
      );
      process.stdout.write(`  frag ${i + 1}/${chunks.length}\r`);
    }
    process.stdout.write("\n");
    await client.query(
      `INSERT INTO content_offer (youtube_id, video_id, title, access_mode, offer_label, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (youtube_id) DO UPDATE
         SET video_id = EXCLUDED.video_id,
             title = EXCLUDED.title,
             access_mode = EXCLUDED.access_mode,
             offer_label = EXCLUDED.offer_label,
             updated_at = now()`,
      [sourceId, videoId, title, paid ? "paid" : "free", paid ? "Comprar esta enseñanza" : null],
    );
    return { video: upsert.rows[0], fragments: chunks.length };
  } finally {
    await client.end();
  }
}

async function main() {
  if (!GROQ_KEY) throw new Error("Falta GROQ_API_KEY");
  if (!filePath && !partsDir) throw new Error("Pasa --file o --parts-dir");
  const cache = path.join(os.tmpdir(), "pp-meta-segments.json");
  let segments = [];
  if (fs.existsSync(cache) && args.includes("--reuse-transcript")) {
    segments = JSON.parse(fs.readFileSync(cache, "utf8"));
    console.log("Reusando transcripción", segments.length, "segmentos");
  } else {
    const parts = splitAudio(filePath || "");
    if (!parts.length) throw new Error("No hay partes de audio");
    console.log(`${parts.length} partes`);
    for (const part of parts) {
      console.log("Whisper", path.basename(part.path), `${part.offsetSec}s`);
      const chunk = await transcribePart(part.path);
      for (const seg of chunk) {
        segments.push({ start: seg.start + part.offsetSec, text: seg.text });
      }
      console.log(`  +${chunk.length} segmentos (total ${segments.length})`);
    }
    fs.writeFileSync(cache, JSON.stringify(segments));
  }
  if (!segments.length) throw new Error("Transcripción vacía");

  try {
    const data = await saveViaHub(segments);
    console.log("Indexado vía hub", data.video, "fragmentos", data.fragments, "acceso", data.offer?.access_mode);
    return;
  } catch (err) {
    console.warn("Hub no disponible:", err.message);
  }
  const chunks = chunkSegments(segments);
  console.log(chunks.length, "fragmentos");
  try {
    const data = await saveViaKnowledgeChunks(chunks);
    console.log("Indexado como documento de pago", data.document?.id, "chunks", data.fragments);
    return;
  } catch (err) {
    console.warn("Documento REST no disponible:", err.message);
  }
  console.log("Indexando en Postgres…");
  const data = await saveViaPostgres(chunks);
  console.log("Indexado", data.video, "fragmentos", data.fragments);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
