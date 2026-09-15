/**
 * Recuperación semántica de fragmentos de transcripción.
 * Combina vector (pgvector) + FTS ligero + expansión de vecinos.
 * No modifica prompts; solo arma el contexto que recibe el LLM.
 */

import { contextFragments, expandAdjacentFragments } from "./chat-search.js";

/** Similitud coseno mínima (auditoría: off-topic ~0.59–0.63; temas reales ≥0.67). */
export const MIN_SIMILARITY = Number(process.env.CHAT_MIN_SIMILARITY || 0.65);
export const VECTOR_CANDIDATES = 12;
export const SEED_LIMIT = 4;
export const CONTEXT_MAX = 8;

function fragmentKey(row) {
  if (row?.id != null) return `id:${row.id}`;
  return `vp:${row?.video_id}:${row?.position}`;
}

/**
 * Filtra por umbral; si nadie pasa, degrada a los mejores topN (evita respuesta vacía).
 */
export function filterBySimilarity(rows, minSimilarity = MIN_SIMILARITY, fallbackTop = 3) {
  const list = Array.isArray(rows) ? rows : [];
  const passed = list.filter((row) => Number(row.similarity) >= minSimilarity);
  if (passed.length) return passed;
  return list.slice(0, fallbackTop);
}

/**
 * Fusiona hits vectoriales con FTS: si un fragmento aparece en ambos, sube de rank.
 */
export function mergeHybridCandidates(vectorRows, ftsRows, limit = SEED_LIMIT) {
  const byKey = new Map();

  for (const row of vectorRows || []) {
    const key = fragmentKey(row);
    byKey.set(key, {
      ...row,
      rankScore: Number(row.similarity) || 0,
      hybrid: false,
    });
  }

  for (const row of ftsRows || []) {
    const key = fragmentKey(row);
    const existing = byKey.get(key);
    if (existing) {
      existing.rankScore += 0.12;
      existing.hybrid = true;
      if (existing.id == null && row.id != null) existing.id = row.id;
      if (existing.word_count == null && row.word_count != null) {
        existing.word_count = row.word_count;
      }
    } else {
      byKey.set(key, {
        ...row,
        similarity: Number(row.similarity) || 0,
        // FTS-only: score suave para no desplazar a los mejores vectores.
        rankScore: 0.55 + Math.min(0.2, (Number(row.hits) || 0) * 0.03),
        hybrid: false,
        fromFts: true,
      });
    }
  }

  return [...byKey.values()]
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, limit);
}

/** Radio de vecinos: más contexto si el hit es corto o empieza a media frase. */
export function adjacentRadiusFor(fragment) {
  const words = Number(fragment?.word_count) || 0;
  const content = String(fragment?.content || "").trim();
  const startsMid =
    content.length > 0 &&
    !/^[¿¡A-ZÁÉÍÓÚÜÑ"']/.test(content) &&
    /^[a-záéíóúüñ]/.test(content);
  if (words > 0 && words < 120) return 2;
  if (startsMid) return 2;
  return 1;
}

/**
 * Pipeline completo: candidatos vector → umbral → híbrido FTS → expandir vecinos.
 */
export async function retrieveTranscriptContext(db, embeddingLiteral, question, opts = {}) {
  const minSimilarity = opts.minSimilarity ?? MIN_SIMILARITY;
  const candidateCount = opts.candidateCount ?? VECTOR_CANDIDATES;
  const seedLimit = opts.seedLimit ?? SEED_LIMIT;
  const contextMax = opts.contextMax ?? CONTEXT_MAX;

  const { rows: vectorRows } = await db.query(
    "SELECT * FROM match_fragments($1, $2, $3)",
    [embeddingLiteral, candidateCount, 0],
  );

  const filtered = filterBySimilarity(vectorRows, minSimilarity, 3);
  if (!filtered.length) return [];

  let ftsRows = [];
  try {
    ftsRows = await contextFragments(db, question, 6);
  } catch (err) {
    console.warn("[chat-retrieve] FTS hybrid skip:", err?.message || err);
  }

  const seeds = mergeHybridCandidates(filtered, ftsRows, seedLimit);
  if (!seeds.length) return [];

  const radius = Math.max(...seeds.map(adjacentRadiusFor), 1);
  const expanded = await expandAdjacentFragments(db, seeds, radius, contextMax);
  return expanded.length ? expanded : seeds;
}
