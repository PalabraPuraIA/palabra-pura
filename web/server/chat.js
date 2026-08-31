/**
 * chat.js — Cerebro del chatbot dentro del mismo contenedor que la página.
 *
 * Modos (CHAT_MODE):
 *   local    → Postgres propio (pgvector) + Gemini embeddings + modelo de texto
 *   asistida → busca por texto en la base y un modelo redacta (sin embeddings)
 *   proxy    → reenvía a la Edge Function de Supabase (no requiere claves aquí)
 *   busqueda → sin modelo: busca la enseñanza por texto en la base propia
 *   auto     → el primero que esté disponible, en ese mismo orden
 */

import pg from "pg";

import { answerBySearch } from "./chat-search.js";
import { answerWithSearch, askAnyLLM, hasWriter } from "./chat-llm.js";

const MAX_PARENTS = 2;
const EMBED_DIMS = 3072;
const EMBED_MODEL = "gemini-embedding-001";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";

const SUPABASE_CHAT_URL = process.env.SUPABASE_CHAT_URL || "";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "";

const SYSTEM_VIDEO = `Eres una guia calida de la Iglesia Palabra Pura que acompana a personas que empiezan en la fe.
Responde UNICAMENTE con base en las transcripciones de video que se te entregan.
Si las transcripciones NO contienen lo necesario para responder la pregunta, responde EXACTAMENTE con: {"found": false}
Si SI puedes responder con base en los videos, responde con:
{"found": true, "answer": "tu respuesta en 2 a 4 frases", "reference": "referencia biblica si en el contexto se menciona un pasaje, o cadena vacia"}
Para "reference" usa el formato exacto "Libro Capitulo:Versiculo" o "Libro Capitulo:Versiculo-Versiculo" (ejemplos: "Juan 3:16", "Genesis 1:1-3"). Usa el nombre del libro tal como aparece en la Biblia Reina-Valera Antigua.
NUNCA inventes el texto del versiculo; solo devuelves la referencia. El texto lo pone el sistema.
Tono: sencillo, calido y respetuoso, en espanol. Responde SOLO con el objeto JSON, sin texto adicional.`;

const SYSTEM_BIBLE = `Eres una guia calida de la Iglesia Palabra Pura que acompana a personas que empiezan en la fe.
Responde con base en el pasaje biblico (contexto ampliado) que se te entrega. Si el contexto no contiene la respuesta, dilo con humildad y no inventes nada.
Tono: sencillo, calido y respetuoso, en espanol, en 2 a 4 frases.
Si citas un pasaje, indica su referencia en formato exacto "Libro Capitulo:Versiculo" o "Libro Capitulo:Versiculo-Versiculo" (ej: "Juan 3:16", "Genesis 1:1-3"), con el nombre del libro tal como aparece en la Reina-Valera Antigua.
NUNCA inventes el texto del versiculo; solo devuelves la referencia. El texto lo pone el sistema.
Responde SOLO con este objeto JSON: {"answer": "tu respuesta", "reference": "Libro C:V o cadena vacia"}`;

const BIBLE_VERSION = "Reina-Valera Antigua";

let pool = null;
let booksCache = null;

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
  const config = dbConfig();
  if (!config) return null;
  pool = new pg.Pool({ ...config, max: 4, idleTimeoutMillis: 30000 });
  pool.on("error", (err) => console.error("[chat] pg pool", err.message));
  return pool;
}

/** Modo efectivo según configuración disponible. */
export function chatMode() {
  const wanted = (process.env.CHAT_MODE || "auto").toLowerCase();
  const canSearch = Boolean(getPool());
  const canLocal = Boolean(canSearch && GEMINI_API_KEY && hasWriter());
  const canAssisted = Boolean(canSearch && hasWriter());
  const canProxy = Boolean(SUPABASE_CHAT_URL);

  if (wanted === "local") return canLocal ? "local" : "unconfigured";
  if (wanted === "asistida") return canAssisted ? "asistida" : "unconfigured";
  if (wanted === "proxy") return canProxy ? "proxy" : "unconfigured";
  if (wanted === "busqueda") return canSearch ? "busqueda" : "unconfigured";
  if (canLocal) return "local";
  if (canAssisted) return "asistida";
  if (canProxy) return "proxy";
  if (canSearch) return "busqueda";
  return "unconfigured";
}

const norm = (s) =>
  String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

async function getBooksMap() {
  if (booksCache) return booksCache;
  const { rows } = await getPool().query("SELECT id, name, modern_name FROM books");
  const map = new Map();
  for (const b of rows) {
    if (b.name) map.set(norm(b.name), b.id);
    if (b.modern_name) map.set(norm(b.modern_name), b.id);
  }
  booksCache = map;
  return map;
}

/** Parsea "Juan 3:16", "Genesis 1:1-3", "1 Juan 4:8", "Salmos 23". */
function parseRef(ref) {
  const m = String(ref).trim().match(/^(.+?)\s+(\d+)(?::(\d+)(?:\s*-\s*(\d+))?)?$/);
  if (!m) return null;
  const startVerse = m[3] ? Number(m[3]) : null;
  return {
    book: m[1].trim(),
    chapter: Number(m[2]),
    startVerse,
    endVerse: m[4] ? Number(m[4]) : startVerse,
  };
}

/** El texto del versículo sale de la base, nunca del modelo. */
async function resolvePassage(reference) {
  if (!reference || typeof reference !== "string" || !reference.trim()) return null;
  const parsed = parseRef(reference);
  if (!parsed) return null;

  const books = await getBooksMap();
  const bookId = books.get(norm(parsed.book));
  if (!bookId) return null;

  const params = [bookId, parsed.chapter];
  let sql =
    "SELECT verse, text FROM verses WHERE book_id = $1 AND chapter = $2";
  if (parsed.startVerse != null) {
    sql += " AND verse >= $3 AND verse <= $4";
    params.push(parsed.startVerse, parsed.endVerse);
  }
  sql += " ORDER BY verse";

  const { rows } = await getPool().query(sql, params);
  if (!rows.length) return null;

  const label =
    parsed.startVerse == null
      ? `${parsed.book} ${parsed.chapter}`
      : parsed.startVerse === parsed.endVerse
        ? `${parsed.book} ${parsed.chapter}:${parsed.startVerse}`
        : `${parsed.book} ${parsed.chapter}:${parsed.startVerse}-${parsed.endVerse}`;

  return {
    reference: label,
    text: rows.map((r) => r.text).join(" "),
    bible_version: BIBLE_VERSION,
  };
}

async function embedQuery(question) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
    body: JSON.stringify({
      content: { parts: [{ text: question }] },
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: EMBED_DIMS,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Gemini embedding ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.embedding.values;
}

/** Redacta con el primer proveedor disponible de la cadena. */
async function askLLM(system, userContent) {
  const reply = await askAnyLLM(system, userContent);
  if (!reply) throw new Error("ningun modelo de texto respondio");
  return reply;
}

function buildExcerpt(content) {
  const raw = String(content ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return undefined;
  return raw.length > 320 ? `${raw.slice(0, 317).trim()}…` : raw;
}

/** Pipeline completo: primero videos, luego Biblia. */
async function answerLocal(question) {
  const embedding = await embedQuery(question);
  const embStr = JSON.stringify(embedding);
  const db = getPool();

  const { rows: fragMatches } = await db.query(
    "SELECT * FROM match_fragments($1, $2)",
    [embStr, 5],
  );

  if (fragMatches.length) {
    const context = fragMatches
      .map(
        (m, i) =>
          `Fragmento ${i + 1} — video "${m.title}", episodio ${m.episode ?? "?"}:\n${m.content}`,
      )
      .join("\n\n");
    const vid = await askLLM(
      SYSTEM_VIDEO,
      `Contexto de los videos:\n${context}\n\nPregunta: ${question}`,
    );

    if (vid.found) {
      const top = fragMatches[0];
      return {
        answer: vid.answer ?? "",
        passage: (await resolvePassage(vid.reference)) ?? undefined,
        excerpt: buildExcerpt(top.content),
        video: {
          title: top.title,
          episode: top.episode,
          youtube_id: top.youtube_id,
          start_second: top.start_second ?? 0,
        },
        source: "video",
      };
    }
  }

  const { rows: chunkMatches } = await db.query(
    "SELECT * FROM match_bible_chunks($1::halfvec(3072), $2)",
    [embStr, 5],
  );
  if (!chunkMatches.length) {
    return {
      answer: "Todavia no encuentro material sobre eso. ¿Quieres preguntarlo de otra forma?",
    };
  }

  const parentIds = [...new Set(chunkMatches.map((c) => c.parent_id).filter(Boolean))].slice(
    0,
    MAX_PARENTS,
  );
  let parents = [];
  if (parentIds.length) {
    const { rows } = await db.query(
      "SELECT id, book_id, chapter, parent_text FROM bible_parents WHERE id = ANY($1::bigint[])",
      [parentIds],
    );
    parents = rows;
  }

  const bibleContext = parents.length
    ? parents.map((p) => `Pasaje biblico (contexto ampliado):\n${p.parent_text}`).join("\n\n---\n\n")
    : chunkMatches.slice(0, 3).map((c) => c.chunk_text).join("\n\n");

  const bib = await askLLM(
    SYSTEM_BIBLE,
    `Contexto biblico:\n${bibleContext}\n\nPregunta: ${question}`,
  );

  return {
    answer: bib.answer ?? "",
    passage: (await resolvePassage(bib.reference)) ?? undefined,
    source: "biblia",
  };
}

async function answerProxy(question) {
  const headers = { "Content-Type": "application/json" };
  if (SUPABASE_PUBLISHABLE_KEY) headers.apikey = SUPABASE_PUBLISHABLE_KEY;

  const res = await fetch(SUPABASE_CHAT_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ question }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Edge Function ${res.status}: ${await res.text()}`);
  return res.json();
}

const UPSTREAM_FAILED = /tuve un problema para responder/i;

const NOT_FOUND = {
  answer:
    "Todavía no encuentro material sobre eso en las enseñanzas. Prueba preguntarlo con otras palabras.",
};

function answerFor(mode, question) {
  if (mode === "local") return answerLocal(question);
  if (mode === "asistida") return answerAssisted(question);
  if (mode === "busqueda") return searchOrNothing(question);
  return answerProxy(question);
}

/**
 * El modelo explica lo que encontró la búsqueda.
 *
 * Si el modelo revisó el material y dijo que no responde la pregunta, se
 * respeta: repetir la búsqueda cruda solo devolvería el mismo video que él ya
 * descartó. El respaldo sin IA queda para cuando ningún proveedor contestó.
 */
async function answerAssisted(question) {
  const written = await answerWithSearch(getPool(), question, resolvePassage);
  if (written?.notFound) return NOT_FOUND;
  return written ?? (await searchOrNothing(question));
}

async function searchOrNothing(question) {
  const found = await searchFallback(question);
  return found ?? NOT_FOUND;
}

/** Respaldo sin modelo: nunca lanza, para no tapar el error original. */
async function searchFallback(question) {
  try {
    return await answerBySearch(getPool(), question, resolvePassage);
  } catch (err) {
    console.error("[chat] busqueda", err.message);
    return null;
  }
}

/** Handler de Express para POST /api/chat. */
export async function handleChat(req, res) {
  const question = String(req.body?.question ?? "").trim();
  if (question.length < 2) {
    return res.status(400).json({ answer: "Escríbeme una pregunta y con gusto te acompaño." });
  }
  if (question.length > 500) {
    return res.status(400).json({ answer: "La pregunta es muy larga. ¿Puedes resumirla?" });
  }

  const mode = chatMode();
  if (mode === "unconfigured") {
    return res.status(503).json({
      answer:
        "El chat no está configurado en este servidor. Falta la base de datos con claves, o la URL de la Edge Function.",
    });
  }

  res.set("Cache-Control", "no-store");

  try {
    const payload = await answerFor(mode, question);

    // La Edge Function contesta 200 con su propio texto de error: no sirve.
    if (mode === "proxy" && UPSTREAM_FAILED.test(payload?.answer ?? "")) {
      const rescued = await searchFallback(question);
      return res.json(rescued ? { ...rescued, mode: "busqueda" } : { ...NOT_FOUND, mode: "busqueda" });
    }

    res.json({ ...payload, mode });
  } catch (err) {
    console.error("[chat]", mode, err.message);

    const rescued = await searchFallback(question);
    if (rescued) return res.json({ ...rescued, mode: "busqueda" });

    res.status(502).json({
      answer: "Tuve un problema para responder ahora mismo. Intenta de nuevo en un momento.",
    });
  }
}

/** Diagnóstico rápido: modo activo y si la base responde. */
export async function handleChatStatus(_req, res) {
  const mode = chatMode();
  const status = {
    mode,
    hasDb: Boolean(dbConfig()),
    hasGeminiKey: Boolean(GEMINI_API_KEY),
    hasGroqKey: Boolean(process.env.GROQ_API_KEY),
    hasOpenRouterKey: Boolean(OPENROUTER_API_KEY),
    proxyUrl: SUPABASE_CHAT_URL || null,
  };

  if (status.hasDb) {
    try {
      const { rows } = await getPool().query(
        "SELECT (SELECT count(*) FROM video) AS videos, (SELECT count(*) FROM fragment) AS fragments, (SELECT count(*) FROM bible_chunks) AS chunks, (SELECT count(*) FROM verses) AS verses",
      );
      status.db = { ok: true, ...rows[0] };
    } catch (err) {
      status.db = { ok: false, error: err.message };
    }
  }

  res.set("Cache-Control", "no-store");
  res.json(status);
}
