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

import { answerBySearch, relatedVerses, graceBibleVerses, answerByTitleSearch, findReferences, suggestTopics } from "./chat-search.js";
import { answerWithSearch, askAnyLLM, hasWriter, explainFromTranscript, answerFromBible } from "./chat-llm.js";
import { enrichPassagesFromAnswer, resolvePassageWithVersions } from "./bible-versions.js";
import { detectLifeArea, passagesForLifeArea, resolveAllLifeAreas, resolveLifeArea, getLifeAreaById, topicVersesFor, WELCOME_PROMISES } from "./life-areas.js";
import { guardQuestion, offTopicAnswer, sanitizeAnswer } from "./chat-guard.js";
import { formatFragmentsForModel, selectLiteralExcerpt } from "./excerpt.js";
import { retrieveTranscriptContext } from "./chat-retrieve.js";

const MAX_PARENTS = 2;
const EMBED_DIMS = 3072;
const EMBED_MODEL = "gemini-embedding-001";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";

/** Una o más keys: GEMINI_API_KEY, GEMINI_API_KEY_2… o GEMINI_API_KEYS=a,b */
function geminiApiKeys() {
  const listed = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    ...(String(process.env.GEMINI_API_KEYS || "").split(",")),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return [...new Set(listed)];
}

let preferredGeminiKeyIndex = 0;

const SUPABASE_CHAT_URL = process.env.SUPABASE_CHAT_URL || "";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "";

const GRACE_LENS = `
Marco doctrinal obligatorio — dispensacion de la gracia:
- La Escuela Biblica de Palabra Pura ensena bajo la dispensacion de la gracia, NO bajo la ley ni el Antiguo Pacto como norma para el creyente hoy.
- Cristo cumplio la ley; la justicia es por fe en lo que El hizo, no por obras de la ley ni por meritos propios.
- NUNCA condenes, clasifiques pecado ni des veredictos morales usando la ley de Moises, Mateo 19, Marcos 10, carta de divorcio o adulterio como regla para la Iglesia.
- Si la pregunta es etica (divorcio, volver a casarse, pecado, matrimonio), responde desde gracia: identidad en Cristo, no condenacion, justicia recibida, perdon, nueva criatura — NO desde legalismo.
- Divide correctamente la Palabra: no apliques mandatos del Antiguo Testamento sin la luz del Nuevo y de la gracia.
- Cada respuesta debe sonar a evangelio de la gracia, no a ministerio de condenacion de la ley.`;

const SYSTEM_VIDEO = `Eres una guia calida de la Iglesia Palabra Pura que acompana a personas que empiezan en la fe.
Responde UNICAMENTE con base en las transcripciones de video que se te entregan.
${GRACE_LENS}
NUNCA uses groserias, insultos, palabras soeces ni tono agresivo.
Si la pregunta es una bobada, broma, groseria o algo SIN relacion con la Escuela Biblica, la fe, la Biblia o las ensenanzas del ministerio, responde EXACTAMENTE con: {"found": false, "off_topic": true}
Si el audio solo menciona palabras parecidas por casualidad (comida, chistes, ejemplos del supermercado, etc.) pero NO ensena sobre lo que preguntaron, responde EXACTAMENTE con: {"found": false, "off_topic": true}
Si las transcripciones NO contienen lo necesario para responder la pregunta, responde EXACTAMENTE con: {"found": false}
Si SI puedes responder con base en los videos, responde con:
{"found": true, "answer": "tu respuesta en 2 a 4 frases bajo la dispensacion de la gracia", "reference": "referencia biblica si en el contexto se menciona un pasaje, o cadena vacia", "evidence": {"fragment": 1, "start_sentence": 1, "end_sentence": 3}}
Para "reference" usa el formato exacto "Libro Capitulo:Versiculo" o "Libro Capitulo:Versiculo-Versiculo" (ejemplos: "Juan 3:16", "Genesis 1:1-3"). Usa el nombre del libro tal como aparece en la Biblia Reina-Valera Antigua.
NUNCA inventes el texto del versiculo; solo devuelves la referencia. El texto lo pone el sistema.
En "evidence", elige un rango continuo de las oraciones numeradas que realmente sustente la respuesta.
Tono: sencillo, calido y respetuoso, en espanol. Responde SOLO con el objeto JSON, sin texto adicional.`;

const SYSTEM_BIBLE = `Eres una guia calida de la Iglesia Palabra Pura que acompana a personas que empiezan en la fe.
Responde con base en el pasaje biblico (contexto ampliado) que se te entrega.
${GRACE_LENS}
NUNCA uses groserias, insultos ni palabras soeces.
Si la pregunta no tiene relacion con la fe, la Biblia o la Escuela Biblica, responde: {"answer": "", "reference": "", "off_topic": true}
Si el contexto no contiene la respuesta, dilo con humildad y no inventes nada.
Tono: sencillo, calido y respetuoso, en espanol, en 2 a 4 frases bajo la dispensacion de la gracia.
Si citas un pasaje, indica su referencia en formato exacto "Libro Capitulo:Versiculo" o "Libro Capitulo:Versiculo-Versiculo" (ej: "Juan 3:16", "Genesis 1:1-3"), con el nombre del libro tal como aparece en la Reina-Valera Antigua.
NUNCA inventes el texto del versiculo; solo devuelves la referencia. El texto lo pone el sistema.
Responde SOLO con este objeto JSON: {"answer": "tu respuesta", "reference": "Libro C:V o cadena vacia"}`;

const BIBLE_VERSION = "Reina-Valera Antigua";
const RELATED_VERSE_LIMIT = 3;

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
  const canLocal = Boolean(canSearch && geminiApiKeys().length && hasWriter());
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

async function embedQueryWithKey(apiKey, question) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
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

/** Si una key se acaba (429/403), prueba la siguiente y se queda en la que funciona. */
async function embedQuery(question) {
  const keys = geminiApiKeys();
  if (!keys.length) throw new Error("Falta GEMINI_API_KEY");

  let lastError;
  for (let offset = 0; offset < keys.length; offset += 1) {
    const index = (preferredGeminiKeyIndex + offset) % keys.length;
    try {
      const values = await embedQueryWithKey(keys[index], question);
      preferredGeminiKeyIndex = index;
      return values;
    } catch (err) {
      lastError = err;
      const message = String(err?.message || "");
      if (!/\b(429|403)\b/.test(message)) throw err;
      console.warn(
        `[chat] gemini key ${index + 1}/${keys.length} falló; probando otra`,
        message.slice(0, 160),
      );
    }
  }
  throw lastError;
}

/** Redacta con el primer proveedor disponible de la cadena. */
async function askLLM(system, userContent) {
  const reply = await askAnyLLM(system, userContent);
  if (!reply) throw new Error("ningun modelo de texto respondio");
  return reply;
}

/** Pipeline completo: primero videos, luego Biblia. */
async function answerLocal(question) {
  const embedding = await embedQuery(question);
  const embStr = JSON.stringify(embedding);
  const db = getPool();

  const fragMatches = await retrieveTranscriptContext(db, embStr, question);

  if (fragMatches.length) {
    const context = formatFragmentsForModel(fragMatches);
    const vid = await askLLM(
      SYSTEM_VIDEO,
      `Contexto de los videos:\n${context}\n\nPregunta: ${question}`,
    );

    if (vid.found) {
      const selected = selectLiteralExcerpt(fragMatches, question, vid.evidence);
      const top = selected.fragment || fragMatches[0];
      return {
        answer: vid.answer ?? "",
        passage: (await resolvePassage(vid.reference)) ?? undefined,
        excerpt: selected.excerpt,
        retrieval: selected.retrieval,
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
    "Todavía no encuentro material claro sobre eso en las enseñanzas. Puedes elegir un tema de lo que sí está en los audios transcritos:",
};

async function withSuggestions(payload, question) {
  if (!payload) return payload;
  const needsHelp =
    payload.mode === "guard" ||
    payload === NOT_FOUND ||
    payload.answer === NOT_FOUND.answer ||
    (!payload.video && !payload.passage && !payload.passages?.length);

  if (!needsHelp && payload.suggestions) return payload;
  if (!needsHelp) return payload;

  try {
    const suggestions = await suggestTopics(getPool(), question, 6);
    if (suggestions.length) return { ...payload, suggestions };
  } catch (err) {
    console.error("[chat] suggestions", err.message);
  }
  return payload;
}

function normalizePayload(payload) {
  if (!payload) return payload;
  if (payload.off_topic || payload.notFound === "off_topic") {
    return offTopicAnswer();
  }
  if (payload.answer) {
    let answer = sanitizeAnswer(payload.answer);
    // La IA resume; el audio va aparte. Máximo 3 frases.
    if (payload.source === "video" || payload.excerpt) {
      const parts = String(answer).match(/[^.!?…]+[.!?…]*/g);
      if (parts && parts.length > 3) answer = parts.slice(0, 3).join("").trim();
    }
    return { ...payload, answer };
  }
  return payload;
}

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
  const greeting = await answerGreeting(question);
  if (greeting) return greeting;

  const written = await answerWithSearch(getPool(), question, resolvePassage);
  if (written?.off_topic || written?.notFound === "off_topic") return offTopicAnswer();
  if (written && !written.notFound) return written;

  const byTitle = await answerByTitleSearch(getPool(), question);
  if (byTitle) return byTitle;

  const bible = await answerFromBible(getPool(), question, resolvePassage);
  if (bible?.off_topic) return offTopicAnswer();
  if (bible) return bible;

  if (written?.notFound) return withSuggestions({ ...NOT_FOUND }, question);
  return withSuggestions((await searchOrNothing(question)) ?? { ...NOT_FOUND }, question);
}

function isGreeting(question) {
  const q = String(question ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  return /^(hola+|holi|buenas|buen(os|as)?\s+(dias|tardes|noches)|hey|hi|hello|saludos|que tal|como estas)(\s|!|\.|\?|¿|¡)*$/i.test(
    q,
  );
}

/** Bienvenida cálida + promesa bíblica completa en TLA. */
async function answerGreeting(question) {
  if (!isGreeting(question)) return null;

  const pick = WELCOME_PROMISES[Math.floor(Math.random() * WELCOME_PROMISES.length)];
  const passage = await resolvePassageWithVersions(pick.reference, resolvePassage);
  const promiseText = passage?.text?.trim();
  const promiseBlock = promiseText
    ? `Hoy te dejo esta promesa (${passage.reference}): “${promiseText}”`
    : `Hoy te dejo esta promesa de ${pick.reference}.`;

  return {
    answer:
      "¡Hola! Bienvenido(a) a la Escuela Bíblica de Palabra Pura. Soy Grace, y estoy aquí para acompañarte con las enseñanzas del ministerio. " +
      "Pregúntame lo que tengas en el corazón —un tema, un título de enseñanza o una duda— y te ayudo con claridad. " +
      promiseBlock,
    passage: passage ?? undefined,
    passages: passage ? [passage] : undefined,
    source: "biblia",
    lifeArea: {
      id: "bienvenida",
      label: "Bienvenida",
      promise: promiseText
        ? `${passage.reference}: “${promiseText}”`
        : "Dios tiene planes de bien para tu vida. Estás en el lugar correcto para crecer en Su gracia.",
    },
  };
}

function isNotFoundAnswer(answer) {
  return /todav[ií]a no encuentro material/i.test(answer ?? "");
}

async function searchOrNothing(question) {
  const found = await searchFallback(question);
  return found ?? NOT_FOUND;
}

function prefersGraceContext(question) {
  return /divorc|repud|adulter|matrimon|cas(a|o|ar|arse|arme)|pecad|fornic|conden/i.test(
    String(question),
  );
}

/** ¿El texto del versículo se relaciona con la pregunta? */
function passageLooksRelevant(passage, question) {
  if (!passage?.text) return false;
  const terms = String(question ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  if (!terms.length) return true;
  const text = String(passage.text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const hits = terms.filter((t) => text.includes(t.slice(0, Math.min(6, t.length))));
  return hits.length >= 1;
}

/** Agrega versículos. En video: SOLO citas dichas en la transcripción. */
async function enrichWithRelatedPassages(payload, question) {
  if (!payload?.answer || payload.notFound || isNotFoundAnswer(payload.answer)) return payload;
  if (payload.matchedByTitle) return payload;
  if (payload.source === "biblia" && payload.passages?.length && isGreeting(question)) {
    return payload;
  }

  const seen = new Set();
  const passages = [];

  const pushResolved = async (ref, { requireRelevant = false } = {}) => {
    if (!ref || passages.length >= RELATED_VERSE_LIMIT) return;
    const key = String(ref).toLowerCase();
    if (seen.has(key)) return;
    const resolved = await resolvePassageWithVersions(ref, resolvePassage);
    if (!resolved) return;
    if (requireRelevant && !passageLooksRelevant(resolved, question)) return;
    seen.add(resolved.reference.toLowerCase());
    seen.add(key);
    passages.push(resolved);
  };

  // --- Respuesta desde VIDEO: solo versículos que salen del audio ---
  if (payload.source === "video") {
    const transcriptBlob = [payload.transcript, payload.excerpt].filter(Boolean).join("\n");
    const spoken = [
      ...(Array.isArray(payload.spokenRefs) ? payload.spokenRefs : []),
      ...findReferences(transcriptBlob),
    ].filter(Boolean);
    const uniqueSpoken = [...new Set(spoken)];

    // Preferir citas del audio que también encajen con la pregunta.
    for (const ref of uniqueSpoken) {
      await pushResolved(ref, { requireRelevant: true });
    }
    // Si ninguna pasó el filtro de relevancia, al menos las dichas en el audio.
    if (!passages.length) {
      for (const ref of uniqueSpoken) {
        await pushResolved(ref);
      }
    }

    // Referencia del modelo / answer solo si también está en el audio.
    const spokenNorm = uniqueSpoken.map((r) => r.toLowerCase().replace(/\s+/g, " "));
    const candidates = [
      ...(payload.passages || []),
      ...(payload.passage ? [payload.passage] : []),
    ];
    for (const p of candidates) {
      if (!p?.reference || passages.length >= RELATED_VERSE_LIMIT) break;
      const ref = String(p.reference).toLowerCase().replace(/\s+/g, " ");
      const inAudio = spokenNorm.some(
        (s) => s.includes(ref) || ref.includes(s) || s.startsWith(ref.slice(0, 10)),
      );
      if (!inAudio) continue;
      const key = p.reference.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      passages.push(p);
    }

    if (!passages.length) {
      const { passage, passages: _drop, spokenRefs, transcript, ...rest } = payload;
      return rest;
    }

    const { spokenRefs, transcript, ...rest } = payload;
    return {
      ...rest,
      passage: passages[0],
      passages: passages.slice(0, RELATED_VERSE_LIMIT),
    };
  }

  // --- Sin video (Biblia / FAQ / etc.): curados + relevancia ---
  for (const ref of topicVersesFor(question)) {
    await pushResolved(ref);
  }

  const lifeArea = detectLifeArea(question);
  if (lifeArea && passages.length < RELATED_VERSE_LIMIT) {
    const areaPassages = await passagesForLifeArea(
      lifeArea,
      resolvePassageWithVersions,
      resolvePassage,
      RELATED_VERSE_LIMIT,
    );
    for (const p of areaPassages) {
      if (passages.length >= RELATED_VERSE_LIMIT) break;
      const key = p.reference.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      passages.push(p);
    }
  }

  const candidates = [
    ...(payload.passages || []),
    ...(payload.passage ? [payload.passage] : []),
  ];
  for (const p of candidates) {
    if (!p?.reference || passages.length >= RELATED_VERSE_LIMIT) break;
    const key = p.reference.toLowerCase();
    if (seen.has(key)) continue;
    if (passages.length === 0 || passageLooksRelevant(p, question)) {
      seen.add(key);
      passages.push(p);
    }
  }

  const db = getPool();
  if (db && !passages.length) {
    const hits = prefersGraceContext(question)
      ? await graceBibleVerses(db, RELATED_VERSE_LIMIT)
      : await relatedVerses(db, question, RELATED_VERSE_LIMIT);

    for (const row of hits) {
      if (passages.length >= RELATED_VERSE_LIMIT) break;
      await pushResolved(`${row.book} ${row.chapter}:${row.verse}`, { requireRelevant: true });
    }
  }

  if (!passages.length) {
    const { passage, passages: _drop, ...rest } = payload;
    return rest;
  }

  return {
    ...payload,
    passage: passages[0],
    passages: passages.slice(0, RELATED_VERSE_LIMIT),
    lifeArea: lifeArea
      ? { id: lifeArea.id, label: lifeArea.label, promise: lifeArea.promise }
      : payload.lifeArea,
  };
}

/** API: promesas y versículos por área de vida (TLA). */
export async function handleLifeAreas(req, res) {
  const id = String(req.query.id || req.query.area || "").trim();
  const q = String(req.query.q || "").trim();

  try {
    if (q) {
      const area = detectLifeArea(q);
      if (!area) return res.json({ ok: true, match: null, areas: [] });
      const resolved = await resolveLifeArea(area, resolvePassageWithVersions, resolvePassage);
      return res.json({ ok: true, match: resolved, areas: resolved ? [resolved] : [] });
    }

    if (id) {
      const area = getLifeAreaById(id);
      if (!area) return res.status(404).json({ ok: false, error: "area not found" });
      const resolved = await resolveLifeArea(area, resolvePassageWithVersions, resolvePassage);
      return res.json({ ok: true, area: resolved });
    }

    const areas = await resolveAllLifeAreas(resolvePassageWithVersions, resolvePassage);
    res.set("Cache-Control", "public, max-age=300");
    res.json({ ok: true, areas });
  } catch (err) {
    console.error("[life-areas]", err);
    res.status(502).json({ ok: false, error: "life-areas unavailable" });
  }
}

/** Respaldo sin modelo: si hay IA disponible, redacta explicacion intuitiva del audio. */
async function searchFallback(question) {
  try {
    const found = await answerBySearch(getPool(), question, resolvePassage);
    if (!found?.video) return found;

    const generic =
      /encontr[eé] esta ense[nñ]anza del ministerio/i.test(found.answer ?? "") ||
      /te dejo el fragmento/i.test(found.answer ?? "");

    if (!generic || !hasWriter()) return found;

    const explained = await explainFromTranscript(
      question,
      found.transcript || found.excerpt,
      found.video?.title,
    );
    if (!explained?.answer) return found;

    return {
      ...found,
      answer: explained.answer,
      passage: (await resolvePassage(explained.reference)) ?? found.passage,
    };
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

  res.set("Cache-Control", "no-store");

  // Filtro previo: pastores, groserías y bobadas fuera de la Escuela Bíblica.
  const guarded = guardQuestion(question);
  if (guarded) {
    const withTips =
      guarded.mode === "guard" ? await withSuggestions(guarded, question) : guarded;
    return res.json(withTips);
  }

  const mode = chatMode();
  if (mode === "unconfigured") {
    return res.status(503).json({
      answer:
        "El chat no está configurado en este servidor. Falta la base de datos con claves, o la URL de la Edge Function.",
    });
  }

  try {
    let payload = await answerFor(mode, question);

    // La Edge Function contesta 200 con su propio texto de error: no sirve.
    if (mode === "proxy" && UPSTREAM_FAILED.test(payload?.answer ?? "")) {
      const rescued = await searchFallback(question);
      payload = rescued ? { ...rescued, mode: "busqueda" } : { ...NOT_FOUND, mode: "busqueda" };
    } else {
      payload = { ...payload, mode };
    }

    payload = normalizePayload(payload);
    if (payload?.mode === "guard") {
      return res.json(await withSuggestions(payload, question));
    }

    // En video no sacamos versículos del texto de Grace: solo de la transcripción.
    if (payload?.source !== "video") {
      payload = await enrichPassagesFromAnswer(payload, resolvePassage);
    }
    payload = await enrichWithRelatedPassages(payload, question);
    if (payload?.transcript) delete payload.transcript;
    if (payload?.spokenRefs) delete payload.spokenRefs;
    // Conservamos excerpt: pedazo curado de la transcripción para mostrar aparte.
    if (payload?.matchedByTitle) delete payload.matchedByTitle;
    if (payload?.answer) payload.answer = sanitizeAnswer(payload.answer);

    if (!payload?.video && !payload?.passage && !payload?.passages?.length) {
      payload = await withSuggestions(payload, question);
    }
    res.json(payload);
  } catch (err) {
    console.error("[chat]", mode, err.message);

    const rescued = await searchFallback(question);
    if (rescued) {
      let enriched = await enrichPassagesFromAnswer({ ...rescued, mode: "busqueda" }, resolvePassage);
      enriched = await enrichWithRelatedPassages(enriched, question);
      if (enriched?.transcript) delete enriched.transcript;
      if (enriched?.matchedByTitle) delete enriched.matchedByTitle;
      if (enriched?.answer) enriched.answer = sanitizeAnswer(enriched.answer);
      return res.json(enriched);
    }

    res.status(502).json(
      await withSuggestions(
        {
          answer: "Tuve un problema para responder ahora mismo. Intenta de nuevo en un momento.",
        },
        question,
      ),
    );
  }
}

/** Diagnóstico rápido: modo activo y si la base responde. */
export async function handleChatStatus(_req, res) {
  const mode = chatMode();
  const status = {
    mode,
    hasDb: Boolean(dbConfig()),
    hasGeminiKey: geminiApiKeys().length > 0,
    geminiKeys: geminiApiKeys().length,
    hasGroqKey: Boolean(process.env.GROQ_API_KEY),
    hasDolaKey: Boolean(process.env.DOLA_API_KEY || process.env.BYTEPLUS_API_KEY),
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
