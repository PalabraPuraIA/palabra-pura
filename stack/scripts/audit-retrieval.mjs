#!/usr/bin/env node
/** Auditoría reproducible del corpus y sus índices. Solo lectura. */

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = process.env.PROJECT_ROOT || path.resolve(import.meta.dirname, "../..");
loadEnv(process.env.ENV_FILE || path.join(ROOT, "stack/.env"));

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
    const value = line.trim();
    if (!value || value.startsWith("#")) continue;
    const at = value.indexOf("=");
    if (at < 1) continue;
    const key = value.slice(0, at).trim();
    const raw = value.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (!process.env[key]) process.env[key] = raw;
  }
}

async function main() {
  const corpus = await pool.query(`
    SELECT count(*)::int AS fragments,
           count(DISTINCT video_id)::int AS videos_with_fragments,
           count(*) FILTER (WHERE trim(content) = '')::int AS empty,
           count(*) FILTER (WHERE l2_norm(embedding) = 0)::int AS zero_embeddings,
           round(avg(word_count), 1) AS avg_words,
           min(word_count)::int AS min_words,
           max(word_count)::int AS max_words
      FROM fragment`);
  const videos = await pool.query(`
    SELECT count(*)::int AS videos,
           count(*) FILTER (
             WHERE NOT EXISTS (SELECT 1 FROM fragment f WHERE f.video_id = v.id)
           )::int AS without_transcript
      FROM video v`);
  const duplicates = await pool.query(`
    SELECT count(*)::int AS duplicate_positions
      FROM (
        SELECT video_id, position
          FROM fragment
         GROUP BY video_id, position
        HAVING count(*) > 1
      ) d`);
  const indexes = await pool.query(`
    SELECT indexname
      FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename IN ('fragment', 'video', 'chat_interactions')
     ORDER BY indexname`);

  console.log(JSON.stringify({
    ...corpus.rows[0],
    ...videos.rows[0],
    ...duplicates.rows[0],
    indexes: indexes.rows.map((row) => row.indexname),
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
