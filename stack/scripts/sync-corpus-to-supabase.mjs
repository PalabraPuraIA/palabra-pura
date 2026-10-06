#!/usr/bin/env node
/**
 * Copia videos y fragmentos del Postgres local a Supabase nube.
 * Pages lee esa nube: una serie nueva transcrita solo en el server
 * no aparece en el chat público hasta correr este script.
 *
 *   node stack/scripts/sync-corpus-to-supabase.mjs
 *   node stack/scripts/sync-corpus-to-supabase.mjs --dry-run
 *   node stack/scripts/sync-corpus-to-supabase.mjs --youtube-id XXX
 */

import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "../..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const ytIdx = args.indexOf("--youtube-id");
const onlyYoutube = ytIdx >= 0 ? String(args[ytIdx + 1] || "").trim() : "";

loadEnv(process.env.ENV_FILE || path.join(ROOT, "stack/.env"));

const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://jkffgudzlcemapxprbws.supabase.co").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

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

function pgConfig() {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
  return {
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || 5488),
    database: process.env.PGDATABASE || "palabra_pura",
    user: process.env.PGUSER || "palabra",
    password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || "",
  };
}

function sbHeaders(extra = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function sb(pathName, { method = "GET", query = "", body, extraHeaders } = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${pathName}${query ? `?${query}` : ""}`;
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
    throw new Error(`${method} ${pathName} ${res.status}: ${typeof data === "string" ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300)}`);
  }
  return { res, data };
}

async function countCloud(table, filter = "") {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=id${filter ? `&${filter}` : ""}`;
  const res = await fetch(url, {
    headers: {
      ...sbHeaders(),
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  const range = res.headers.get("content-range") || "";
  const total = Number(range.split("/")[1]);
  return Number.isFinite(total) ? total : null;
}

async function upsertVideo(row) {
  const { data } = await sb("video", {
    method: "POST",
    query: "on_conflict=youtube_id",
    extraHeaders: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: {
      youtube_id: row.youtube_id,
      title: row.title,
      episode: row.episode,
      duration_seconds: row.duration_seconds,
      published_at: row.published_at,
    },
  });
  return Array.isArray(data) ? data[0] : data;
}

async function insertFragments(videoId, fragments) {
  for (const frag of fragments) {
    await sb("fragment", {
      method: "POST",
      extraHeaders: { Prefer: "return=minimal" },
      body: {
        video_id: videoId,
        position: frag.position,
        content: frag.content,
        embedding: frag.embedding,
        start_second: frag.start_second,
        word_count: frag.word_count,
      },
    });
  }
}

async function main() {
  if (!SERVICE_KEY) {
    console.error("Falta SUPABASE_SERVICE_ROLE_KEY en stack/.env");
    process.exit(1);
  }

  const pool = new pg.Pool(pgConfig());
  const local = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM video) AS videos,
       (SELECT count(*)::int FROM fragment) AS fragments,
       (SELECT count(*)::int FROM fragment WHERE embedding IS NULL) AS missing_emb`,
  );
  const cloudVideos = await countCloud("video");
  const cloudFrags = await countCloud("fragment");
  console.log("Local:", local.rows[0]);
  console.log("Nube:", { videos: cloudVideos, fragments: cloudFrags });

  const { rows } = await pool.query(
    `SELECT v.youtube_id, v.title, v.episode, v.duration_seconds, v.published_at,
            f.position, f.content, f.embedding::text AS embedding,
            f.start_second, f.word_count
       FROM video v
       JOIN fragment f ON f.video_id = v.id
      WHERE ($1 = '' OR v.youtube_id = $1)
      ORDER BY v.episode NULLS LAST, v.youtube_id, f.position`,
    [onlyYoutube],
  );

  const byVideo = new Map();
  for (const row of rows) {
    if (!byVideo.has(row.youtube_id)) {
      byVideo.set(row.youtube_id, {
        youtube_id: row.youtube_id,
        title: row.title,
        episode: row.episode,
        duration_seconds: row.duration_seconds,
        published_at: row.published_at,
        fragments: [],
      });
    }
    byVideo.get(row.youtube_id).fragments.push({
      position: row.position,
      content: row.content,
      embedding: row.embedding,
      start_second: row.start_second,
      word_count: row.word_count,
    });
  }

  let copied = 0;
  let skipped = 0;
  for (const video of byVideo.values()) {
    const existing = await countCloud("video", `youtube_id=eq.${encodeURIComponent(video.youtube_id)}`);
    let cloudVideoId = null;
    if (existing) {
      const found = await sb("video", {
        query: `select=id,youtube_id&youtube_id=eq.${encodeURIComponent(video.youtube_id)}`,
      });
      cloudVideoId = found.data?.[0]?.id ?? null;
      const fragCount = cloudVideoId
        ? await countCloud("fragment", `video_id=eq.${cloudVideoId}`)
        : 0;
      if (fragCount > 0) {
        console.log(`  skip ${video.youtube_id} — ya tiene ${fragCount} fragmentos en la nube`);
        skipped += 1;
        continue;
      }
    }

    console.log(`  sync ${video.youtube_id} — ${video.fragments.length} fragmentos — ${video.title}`);
    if (dryRun) {
      copied += 1;
      continue;
    }

    const upserted = await upsertVideo(video);
    cloudVideoId = upserted?.id;
    if (!cloudVideoId) throw new Error(`No pude upsertar ${video.youtube_id}`);
    await insertFragments(cloudVideoId, video.fragments);
    copied += 1;
  }

  await pool.end();
  console.log(`Listo. Copiados: ${copied}  |  ya estaban: ${skipped}${dryRun ? "  (dry-run)" : ""}`);
  console.log("Después de una serie nueva: transcribe local y vuelve a correr este script.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
