#!/usr/bin/env node
/**
 * Transcribe YouTube videos and index fragments in Supabase cloud.
 *
 *   node stack/scripts/ingest-youtube-cloud.mjs --youtube-id cGMdLR9tS4Y
 *   node stack/scripts/ingest-youtube-cloud.mjs --series globalismo
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SUPABASE_URL = "https://jkffgudzlcemapxprbws.supabase.co";
const EMBED_MODEL = "gemini-embedding-001";
const EMBED_DIMS = 3072;
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const TARGET_WORDS = 300;

const args = process.argv.slice(2);
const onlyId = argValue("--youtube-id");
const seriesName = argValue("--series");

loadEnv(path.join(ROOT, "stack/.env"));
loadEnv("/Users/fintekauto/Desktop/palabra-pura-copia-2026-09-15/stack/.env");

const GROQ_KEY = process.env.GROQ_API_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  ...(String(process.env.GEMINI_API_KEYS || "").split(",")),
]
  .map((k) => String(k || "").trim())
  .filter(Boolean);

const SERIES = {
  globalismo: [
    { youtube_id: "cGMdLR9tS4Y", episode: 1, title: "EL GLOBALISMO FALSO - 001 - PARTE 01 - PASTORA ADRIANA LEMES" },
    { youtube_id: "ON4UW_y5b0o", episode: 2, title: "EL GLOBALISMO FALSO - 002 - PARTE 02 - PASTORA ADRIANA LEMES" },
    { youtube_id: "VrrDzKE2Y0Q", episode: 3, title: "EL GLOBALISMO FALSO (PARTE 3) - PASTORA ADRIANA LEMES" },
    { youtube_id: "YgR9SivNOZw", episode: 4, title: "EL GLOBALISMO FALSO - 004 - PARTE 04 - PASTORA ADRIANA LEMES" },
    { youtube_id: "fBkVVmz7ziw", episode: 5, title: "EL GLOBALISMO FALSO - 005 - PARTE 05 - PASTORA ADRIANA LEMES" },
    { youtube_id: "zfDNCMhpXQ8", episode: 6, title: "EL GLOBALISMO FALSO - 006 - PARTE 06 - PASTORA ADRIANA LEMES" },
  ],
};

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

function sbHeaders(extra = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function sb(pathname, { method = "GET", query = "", body, extraHeaders } = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${pathname}${query ? `?${query}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: sbHeaders(extraHeaders),
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${pathname} ${res.status}: ${typeof data === "string" ? data.slice(0, 280) : JSON.stringify(data).slice(0, 280)}`);
  }
  return data;
}

function runYt(argsList, cwd) {
  const r = spawnSync("yt-dlp", argsList, { encoding: "utf8", cwd, stdio: "pipe" });
  if (r.status !== 0) {
    throw new Error(`yt-dlp: ${(r.stderr || r.stdout || "").slice(0, 400)}`);
  }
  return r;
}

function downloadCaptions(youtubeId, dir) {
  try {
    runYt(
      [
        "--write-auto-subs",
        "--sub-langs",
        "es-orig,es",
        "--skip-download",
        "--sub-format",
        "json3",
        "--no-playlist",
        "-o",
        path.join(dir, `${youtubeId}.%(ext)s`),
        `https://www.youtube.com/watch?v=${youtubeId}`,
      ],
      dir,
    );
  } catch {
    return null;
  }
  const file = fs.readdirSync(dir).find((n) => n.startsWith(`${youtubeId}.`) && n.endsWith(".json3"));
  if (!file) return null;
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const segments = (data.events || [])
      .map((event) => ({
        start: Number(event.tStartMs || 0) / 1000,
        text: (event.segs || [])
          .map((s) => s.utf8 || "")
          .join("")
          .replace(/\n/g, " ")
          .trim(),
      }))
      .filter((s) => s.text && !/^\[[^\]]+\]$/.test(s.text));
    return segments.length ? segments : null;
  } catch {
    return null;
  }
}

function downloadAudio(youtubeId, dir) {
  runYt(
    [
      "-f",
      "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best",
      "--no-playlist",
      "-o",
      path.join(dir, `${youtubeId}.%(ext)s`),
      `https://www.youtube.com/watch?v=${youtubeId}`,
    ],
    dir,
  );
  const file = fs.readdirSync(dir).find((n) => n.startsWith(`${youtubeId}.`) && !n.endsWith(".json3"));
  if (!file) throw new Error("yt-dlp no dejó audio");
  return path.join(dir, file);
}

async function transcribeGroq(audioPath) {
  if (!GROQ_KEY) throw new Error("Falta GROQ_API_KEY");
  const buf = fs.readFileSync(audioPath);
  if (buf.length > 24 * 1024 * 1024) {
    throw new Error(`Audio demasiado grande para Whisper (${Math.round(buf.length / 1024 / 1024)} MB)`);
  }
  const form = new FormData();
  form.append("file", new Blob([buf]), path.basename(audioPath));
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
  if (!segments.length) throw new Error("Transcripción vacía");
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
  if (!GEMINI_KEYS.length) throw new Error("Falta GEMINI_API_KEY");
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

async function upsertVideo(item) {
  const data = await sb("video", {
    method: "POST",
    query: "on_conflict=youtube_id",
    extraHeaders: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: {
      youtube_id: item.youtube_id,
      title: item.title,
      episode: item.episode,
    },
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.id) throw new Error("No pude guardar el video " + item.youtube_id);
  return row;
}

async function replaceFragments(videoId, chunks) {
  await sb("fragment", {
    method: "DELETE",
    query: `video_id=eq.${videoId}`,
  });
  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embedText(`${chunks[i].content}`);
    await sb("fragment", {
      method: "POST",
      extraHeaders: { Prefer: "return=minimal" },
      body: {
        video_id: videoId,
        position: i,
        content: chunks[i].content,
        embedding,
        start_second: chunks[i].start_second,
        word_count: chunks[i].word_count,
      },
    });
    process.stdout.write(`    frag ${i + 1}/${chunks.length}\r`);
  }
  process.stdout.write("\n");
}

async function markJobs(youtubeId, fragments) {
  const jobs = await sb("ingest_job", {
    query: `youtube_id=eq.${youtubeId}&select=id,status`,
  });
  for (const job of jobs || []) {
    await sb("ingest_job", {
      method: "PATCH",
      query: `id=eq.${job.id}`,
      extraHeaders: { Prefer: "return=minimal" },
      body: {
        status: "done",
        progress: `Listo · ${fragments} fragmentos`,
        fragments_created: fragments,
        finished_at: new Date().toISOString(),
        error: null,
      },
    });
  }
}

async function processOne(item) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pp-${item.youtube_id}-`));
  try {
    console.log(`\n== ${item.episode ?? "?"} ${item.youtube_id} ${item.title}`);
    let segments = downloadCaptions(item.youtube_id, dir);
    let source = "captions";
    if (!segments) {
      source = "whisper";
      console.log("  sin subtítulos útiles; transcribiendo con Whisper…");
      const audio = downloadAudio(item.youtube_id, dir);
      console.log("  audio", path.basename(audio), Math.round(fs.statSync(audio).size / 1024 / 1024) + "MB");
      segments = await transcribeGroq(audio);
    } else {
      console.log(`  subtítulos automáticos: ${segments.length} segmentos`);
    }
    const chunks = chunkSegments(segments);
    if (!chunks.length) throw new Error("Sin fragmentos");
    console.log(`  ${chunks.length} fragmentos (${source})`);
    const video = await upsertVideo(item);
    await replaceFragments(video.id, chunks);
    await markJobs(item.youtube_id, chunks.length);
    console.log(`  indexado video_id=${video.id}`);
    return chunks.length;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  if (!SERVICE_KEY) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");
  if (!GROQ_KEY && !process.env.ALLOW_CAPTIONS_ONLY) {
    console.warn("GROQ_API_KEY ausente: solo se usarán subtítulos si existen");
  }
  let items = [];
  if (seriesName && SERIES[seriesName]) items = SERIES[seriesName];
  else if (onlyId) items = [{ youtube_id: onlyId, episode: null, title: onlyId }];
  else if (SERIES.globalismo) items = SERIES.globalismo;
  else throw new Error("Nada que procesar");

  let total = 0;
  for (const item of items) {
    total += await processOne(item);
  }
  console.log(`\nListo. Fragmentos indexados: ${total}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
