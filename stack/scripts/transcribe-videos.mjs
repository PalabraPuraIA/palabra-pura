#!/usr/bin/env node
/**
 * transcribe-videos.mjs — Transcribe audios de YouTube faltantes e indexa fragmentos.
 *
 * Pipeline: yt-dlp → Groq Whisper → trozos ~300 palabras → Postgres (fragment).
 * Solo procesa videos con CERO fragmentos: nunca reemplaza una transcripción.
 * Embeddings: Gemini si hay clave; si no, vector cero marcado por la auditoría.
 *
 * Uso (en el servidor, desde la raíz del proyecto):
 *   node stack/scripts/transcribe-videos.mjs
 *   node stack/scripts/transcribe-videos.mjs --limit 3
 *   node stack/scripts/transcribe-videos.mjs --episode 215
 *   node stack/scripts/transcribe-videos.mjs --captions-first
 *   node stack/scripts/transcribe-videos.mjs --dry-run
 */

import pg from "pg";
import fs from "fs";
import path from "path";
import os from "os";
import { spawnSync, execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "../..");
const TARGET_WORDS = 300;
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const WHISPER_MODEL = "whisper-large-v3-turbo";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent";
const ZERO_EMBED = `[${"0,".repeat(3071)}0]`;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const captionsFirst =
  args.includes("--captions-first") || process.env.USE_YOUTUBE_CAPTIONS === "1";
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
const episodeIdx = args.indexOf("--episode");
const onlyEpisode = episodeIdx >= 0 ? Number(args[episodeIdx + 1]) : null;

loadEnv(process.env.ENV_FILE || path.join(ROOT, "stack/.env"));

const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const pool = new pg.Pool({
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 5488),
  database: process.env.PGDATABASE || "palabra_pura",
  user: process.env.PGUSER || "palabra",
  password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || "",
});

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function requireBin(name) {
  const r = spawnSync("which", [name], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`Falta ${name}. Instala: pip install yt-dlp  /  apt install ffmpeg`);
    process.exit(1);
  }
}

async function pendingVideos() {
  const { rows } = await pool.query(
    `SELECT v.id, v.episode, v.youtube_id, v.title, v.duration_seconds,
            count(f.id)::int AS frags
       FROM video v
       LEFT JOIN fragment f ON f.video_id = v.id
      GROUP BY v.id
     HAVING count(f.id) = 0
      ORDER BY v.episode ASC`,
  );
  if (onlyEpisode != null) return rows.filter((r) => r.episode === onlyEpisode);
  return rows;
}

function downloadAudio(youtubeId, outDir) {
  const out = path.join(outDir, `${youtubeId}.mp3`);
  if (fs.existsSync(out)) return out;

  const url = `https://www.youtube.com/watch?v=${youtubeId}`;
  const r = spawnSync(
    "yt-dlp",
    [
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "6",
      "--no-playlist",
      "-o",
      out.replace(/\.mp3$/, ".%(ext)s"),
      url,
    ],
    { encoding: "utf8", stdio: "pipe" },
  );

  if (r.status !== 0) {
    throw new Error(`yt-dlp: ${(r.stderr || r.stdout || "").slice(0, 400)}`);
  }
  if (!fs.existsSync(out)) {
    const alt = fs.readdirSync(outDir).find((f) => f.startsWith(youtubeId));
    if (alt) return path.join(outDir, alt);
    throw new Error("yt-dlp no generó archivo de audio");
  }
  return out;
}

function downloadCaptions(youtubeId, outDir) {
  const template = path.join(outDir, `${youtubeId}.%(ext)s`);
  const result = spawnSync(
    "yt-dlp",
    [
      "--write-auto-subs",
      "--sub-langs",
      "es-orig,es",
      "--skip-download",
      "--sub-format",
      "json3",
      "-o",
      template,
      `https://www.youtube.com/watch?v=${youtubeId}`,
    ],
    { encoding: "utf8", stdio: "pipe" },
  );
  if (result.status !== 0) return null;

  const file = fs
    .readdirSync(outDir)
    .find((name) => name.startsWith(`${youtubeId}.`) && name.endsWith(".json3"));
  if (!file) return null;

  try {
    const data = JSON.parse(fs.readFileSync(path.join(outDir, file), "utf8"));
    const segments = (data.events || [])
      .map((event) => ({
        start: Number(event.tStartMs || 0) / 1000,
        text: (event.segs || [])
          .map((segment) => segment.utf8 || "")
          .join("")
          .replace(/\n/g, " ")
          .trim(),
      }))
      .filter((segment) => segment.text && !/^\[[^\]]+\]$/.test(segment.text));
    return segments.length ? { segments, source: "youtube-auto-captions" } : null;
  } catch {
    return null;
  }
}

function shrinkIfNeeded(filePath) {
  const maxBytes = 24 * 1024 * 1024;
  if (fs.statSync(filePath).size <= maxBytes) return filePath;
  const small = filePath.replace(/\.mp3$/, ".small.mp3");
  spawnSync("ffmpeg", ["-y", "-i", filePath, "-b:a", "48k", small], {
    stdio: "ignore",
  });
  if (fs.existsSync(small)) return small;
  return filePath;
}

async function transcribeGroq(audioPath) {
  const form = new FormData();
  const buf = fs.readFileSync(audioPath);
  form.append("file", new Blob([buf]), path.basename(audioPath));
  form.append("model", WHISPER_MODEL);
  form.append("language", "es");
  form.append("response_format", "verbose_json");

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(600000),
  });

  if (!res.ok) {
    const err = await res.text();
    if (res.status === 429) throw new RateLimitError(err);
    throw new Error(`Groq ${res.status}: ${err.slice(0, 300)}`);
  }

  return res.json();
}

class RateLimitError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "RateLimitError";
  }
}

function chunkSegments(segments, titlePrefix = "") {
  const chunks = [];
  let buf = [];
  let words = 0;
  let startSecond = null;

  const flush = () => {
    if (!buf.length) return;
    let content = buf.join(" ").replace(/\s+/g, " ").trim();
    if (titlePrefix && chunks.length === 0) {
      content = `${titlePrefix}. ${content}`;
    }
    chunks.push({
      content,
      start_second: startSecond ?? 0,
      word_count: words,
    });
    buf = [];
    words = 0;
    startSecond = null;
  };

  for (const seg of segments || []) {
    const text = String(seg.text ?? "").trim();
    if (!text) continue;
    const n = text.split(/\s+/).filter(Boolean).length;
    if (startSecond == null) startSecond = Math.floor(Number(seg.start) || 0);
    buf.push(text);
    words += n;
    if (words >= TARGET_WORDS) flush();
  }
  flush();
  return chunks;
}

function seriesFromTitle(title) {
  const m = String(title).match(/-\s*\d+\s*-\s*([^(-]+?)(?:\s*\(|$)/i);
  return m ? m[1].trim() : String(title);
}

async function embedGemini(text) {
  if (!GEMINI_API_KEY) return ZERO_EMBED;

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY,
    },
    body: JSON.stringify({
      model: "models/gemini-embedding-001",
      content: { parts: [{ text: text.slice(0, 8000) }] },
      taskType: "RETRIEVAL_DOCUMENT",
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) return ZERO_EMBED;
  const data = await res.json();
  const emb = data?.embedding?.values;
  if (!emb || emb.length !== 3072) return ZERO_EMBED;
  return `[${emb.join(",")}]`;
}

async function saveFragments(videoId, chunks) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM video WHERE id = $1 FOR UPDATE", [videoId]);
    const existing = await client.query(
      "SELECT count(*)::int AS total FROM fragment WHERE video_id = $1",
      [videoId],
    );
    if (existing.rows[0].total > 0) {
      await client.query("ROLLBACK");
      return false;
    }

    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const emb = await embedGemini(c.content);
      await client.query(
        `INSERT INTO fragment (video_id, position, content, embedding, start_second, word_count)
         VALUES ($1, $2, $3, $4::halfvec, $5, $6)`,
        [videoId, i, c.content, emb, c.start_second, c.word_count],
      );
      process.stdout.write(".");
    }
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function processVideo(video, tmpDir) {
  console.log(`\n[ep ${video.episode}] ${video.title}`);
  console.log(`  youtube=${video.youtube_id}  frags_actuales=${video.frags}`);

  if (dryRun) {
    console.log("  (dry-run, omitido)");
    return;
  }

  let transcript = captionsFirst ? downloadCaptions(video.youtube_id, tmpDir) : null;
  if (transcript) {
    console.log("  fuente: subtítulos automáticos originales de YouTube");
  } else {
    const audio = shrinkIfNeeded(downloadAudio(video.youtube_id, tmpDir));
    console.log(`  audio: ${path.basename(audio)} (${Math.round(fs.statSync(audio).size / 1024 / 1024)} MB)`);
    transcript = await transcribeGroq(audio);
  }
  const segments = transcript.segments?.length
    ? transcript.segments
    : [{ start: 0, text: transcript.text || "" }];

  const series = seriesFromTitle(video.title);
  const chunks = chunkSegments(segments, series);
  console.log(`  fragmentos: ${chunks.length}`);

  if (chunks.length < 2) {
    throw new Error("Transcripcion muy corta o vacia");
  }

  const saved = await saveFragments(video.id, chunks);
  console.log(
    saved
      ? `  guardado OK (${chunks.length} fragmentos)`
      : "  omitido: otro proceso ya guardó esta transcripción",
  );
}

async function main() {
  if (!GROQ_API_KEY) {
    console.error("Falta GROQ_API_KEY en stack/.env");
    process.exit(1);
  }

  requireBin("yt-dlp");
  requireBin("ffmpeg");

  const pending = await pendingVideos();
  const todo = pending.slice(0, limit === Infinity ? pending.length : limit);

  console.log(`Videos pendientes: ${pending.length}  |  a procesar: ${todo.length}`);
  if (!todo.length) {
    await pool.end();
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-transcribe-"));
  let done = 0;

  for (const video of todo) {
    try {
      await processVideo(video, tmpDir);
      done++;
      if (!dryRun && done < todo.length) await sleep(15000);
    } catch (err) {
      if (err instanceof RateLimitError) {
        console.error("\n  Groq rate limit — esperando 5 min...");
        await sleep(300000);
        try {
          await processVideo(video, tmpDir);
          done++;
        } catch (e2) {
          console.error(`  REINTENTO FALLIDO ep ${video.episode}:`, e2.message);
        }
      } else {
        console.error(`  ERROR ep ${video.episode}:`, err.message);
      }
    }
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  await pool.end();
  console.log(`\nListo. Procesados: ${done}/${todo.length}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
