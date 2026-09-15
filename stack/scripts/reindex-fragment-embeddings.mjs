#!/usr/bin/env node
/**
 * Reemplaza únicamente embeddings cero de fragmentos.
 * Idempotente: los vectores válidos nunca se recalculan.
 * Soporta varias keys Gemini (GEMINI_API_KEY / _2 / GEMINI_API_KEYS).
 */

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = process.env.PROJECT_ROOT || path.resolve(import.meta.dirname, "../..");
loadEnv(process.env.ENV_FILE || path.join(ROOT, "stack/.env"));

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitIndex = args.indexOf("--limit");
const limit = limitIndex >= 0 ? Math.max(1, Number(args[limitIndex + 1]) || 1) : 10000;

function geminiKeys() {
  return [
    ...new Set(
      [
        process.env.GEMINI_API_KEY,
        process.env.GEMINI_API_KEY_2,
        process.env.GEMINI_API_KEY_3,
        ...String(process.env.GEMINI_API_KEYS || "").split(","),
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ];
}

let preferredKeyIndex = 0;

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

async function embedWithKey(apiKey, text) {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        content: { parts: [{ text: String(text).slice(0, 8000) }] },
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: 3072,
      }),
      signal: AbortSignal.timeout(45000),
    },
  );
  if (!response.ok) {
    throw new Error(`Gemini ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const data = await response.json();
  const values = data?.embedding?.values;
  if (!Array.isArray(values) || values.length !== 3072) {
    throw new Error(`embedding inválido (${values?.length ?? 0} dimensiones)`);
  }
  return `[${values.join(",")}]`;
}

async function embed(text) {
  const keys = geminiKeys();
  if (!keys.length) throw new Error("Falta GEMINI_API_KEY en stack/.env");

  let lastError;
  for (let offset = 0; offset < keys.length; offset += 1) {
    const index = (preferredKeyIndex + offset) % keys.length;
    try {
      const vector = await embedWithKey(keys[index], text);
      preferredKeyIndex = index;
      return vector;
    } catch (err) {
      lastError = err;
      const message = String(err?.message || "");
      if (!/\b(429|403)\b/.test(message)) throw err;
      console.warn(`\nkey ${index + 1}/${keys.length} falló; probando otra`);
    }
  }
  throw lastError;
}

async function main() {
  const { rows } = await pool.query(
    `SELECT id, content
       FROM fragment
      WHERE l2_norm(embedding) = 0
      ORDER BY id
      LIMIT $1`,
    [limit],
  );
  console.log(`Embeddings cero a procesar: ${rows.length}`);
  console.log(`Gemini keys disponibles: ${geminiKeys().length}`);
  if (dryRun || !rows.length) return;
  if (!geminiKeys().length) throw new Error("Falta GEMINI_API_KEY en stack/.env");

  let done = 0;
  for (const row of rows) {
    const vector = await embed(row.content);
    await pool.query(
      `UPDATE fragment
          SET embedding = $1::halfvec
        WHERE id = $2 AND l2_norm(embedding) = 0`,
      [vector, row.id],
    );
    done += 1;
    process.stdout.write(`\rReindexados ${done}/${rows.length}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.log("\nDONE");
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
