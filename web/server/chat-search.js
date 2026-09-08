/**
 * chat-search.js — Respaldo sin IA para responder desde la base propia.
 *
 * Cuando no hay claves de modelo, o cuando la Edge Function no logra responder,
 * buscamos la enseñanza por texto completo en las transcripciones y, si hace
 * falta, en la Biblia. No se redacta nada: se entrega lo que dijo el ministerio
 * y el pasaje tal como está en la base.
 */

const STOPWORDS = new Set([
  "que", "como", "cual", "cuales", "para", "por", "con", "sin", "los", "las", "del",
  "una", "unos", "unas", "esto", "esta", "este", "eso", "sobre", "dice", "dios",
  "puedo", "quiero", "hago", "hacer", "tengo", "soy", "son", "muy", "mas", "pero",
  "cuando", "donde", "porque", "significa", "significado", "quien", "hay", "sirve",
  "de", "la", "el", "en", "un", "es", "se", "lo", "al", "mi", "me", "te", "su", "yo",
  "ser", "hay", "asi", "ese", "esa", "tan", "sus", "nos", "ver", "dar", "van", "voy",
  "si", "caso", "sea", "solo", "todo", "toda", "todos", "todas", "bien", "mal",
  // Preguntas frecuentes: no deben exigir coincidencia en el audio
  "cuantas", "cuantos", "cuanta", "cuanto", "estamos", "estan", "estoy", "somos",
  "existe", "existen", "actualmente", "ahora", "hoy", "entonces", "aqui", "alla",
  "algun", "alguna", "algunas", "algunos", "mismo", "misma", "decir", "explica",
  "explicame", "hablame", "dime", "saber", "sabes", "podrias", "puede", "pueden",
]);

/**
 * Sinónimos / formas cortas para temas del ministerio.
 * Evita que "dispensacion" (sin tilde) falle en FTS español.
 */
const TERM_ALIASES = {
  dispensacion: ["dispens", "gracia"],
  dispensaciones: ["dispens", "gracia"],
  dispensacional: ["dispens", "gracia"],
  rapto: ["rapto", "iglesia"],
  sellado: ["sellado", "espiritu"],
  sellar: ["sellado", "espiritu"],
};

const REF_PATTERN =
  /\b((?:[1-3]\s+)?[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)\s+(\d{1,3}):(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?/g;

/** En los videos las citas se dicen en voz alta: "Juan capítulo 3 versículo 16". */
const SPOKEN_REF_PATTERN =
  /\b((?:[1-3]\s+)?[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)\s+cap[íi]tulo\s+(\d{1,3})[,\s]+vers[íi]culos?\s+(\d{1,3})/gi;

/**
 * Palabras útiles de la pregunta, recortadas a su raíz.
 *
 * Se busca por prefijo porque el ministerio habla de "oración" cuando alguien
 * pregunta "cómo orar": sin el recorte, esas dos palabras no se encuentran.
 * Las palabras largas se acortan (p. ej. dispensacion → dispensa) para que el
 * FTS español coincida con "dispensación" en las transcripciones.
 */
export function searchTerms(question) {
  const words = String(question)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));

  const roots = [];
  for (const w of words) {
    if (TERM_ALIASES[w]) {
      roots.push(...TERM_ALIASES[w]);
      continue;
    }
    // Raíz corta: FTS español stemmea "dispensaciones"→dispens, pero
    // "dispensacion" (sin tilde) no; el prefijo de 7 letras sí empareja.
    if (w.length >= 8) roots.push(w.slice(0, 7));
    else if (w.length >= 5) roots.push(w.slice(0, 5));
    else roots.push(w);
  }
  return [...new Set(roots)].slice(0, 8);
}

/**
 * Cuántas raíces debe contener un texto para considerarlo relevante.
 * Con una sola palabra clave basta; con varias, al menos la mitad (mín. 1).
 */
function minHits(terms) {
  if (terms.length <= 1) return 1;
  if (terms.length === 2) return 1;
  return Math.max(1, Math.ceil(terms.length / 2));
}

function prefixQuery(terms) {
  return terms.map((t) => `${t}:*`).join(" | ");
}

/** Terminos extra para buscar pasajes biblicos sobre el tema de la pregunta. */
function bibleTerms(question) {
  return searchTerms(question);
}

/** Pasajes biblicos sobre gracia, justicia y la dispensacion (no ley/condena). */
export async function graceBibleVerses(db, limit = 5) {
  if (!db) return [];

  const terms = ["graci", "justif", "conden", "ident", "perdon", "crist", "ley"];
  const buckets = [];

  for (const term of terms) {
    const { rows } = await db.query(
      `SELECT b.name AS book, v.chapter, v.verse, v.text,
              ts_rank_cd(to_tsvector('spanish', v.text), to_tsquery('spanish', $1)) AS score
         FROM verses v
         JOIN books b ON b.id = v.book_id
        WHERE to_tsvector('spanish', v.text) @@ to_tsquery('spanish', $1)
        ORDER BY score DESC
        LIMIT 2`,
      [`${term}:*`],
    );
    buckets.push(rows);
  }

  const seen = new Set();
  const collected = [];
  for (const rows of buckets) {
    for (const row of rows) {
      const key = `${row.book}:${row.chapter}:${row.verse}`;
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(row);
      if (collected.length >= limit) break;
    }
    if (collected.length >= limit) break;
  }

  return collected;
}

/** Enseñanzas del ministerio sobre gracia, dispensacion y dividir la Palabra. */
export async function ministryGraceFragments(db, limit = 3) {
  if (!db) return [];

  const { rows } = await db.query(
    `WITH q AS (
       SELECT to_tsquery(
         'spanish',
         'dispens:* | graci:* | justif:* | conden:* | divide:* & palabr:* | ley:* & graci:*'
       ) AS tsq
     )
     SELECT f.content, f.start_second, v.title, v.episode, v.youtube_id,
            ts_rank_cd(to_tsvector('spanish', f.content), q.tsq) AS score,
            CASE
              WHEN v.title ILIKE '%divide%' OR v.title ILIKE '%graci%' OR v.title ILIKE '%dispens%' THEN 2
              WHEN to_tsvector('spanish', f.content) @@ to_tsquery('spanish', 'dispens:*') THEN 1
              ELSE 0
            END AS boost
       FROM fragment f
       JOIN video v ON v.id = f.video_id, q
      WHERE to_tsvector('spanish', f.content) @@ q.tsq
      ORDER BY boost DESC, score DESC
      LIMIT $1`,
    [limit],
  );

  return rows;
}

/**
 * Los fragmentos se cortan por duración, así que suelen empezar a media frase.
 * Si la primera oración viene partida, arrancamos en la siguiente.
 */
export function buildExcerpt(content, limit = 420) {
  let raw = String(content ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return undefined;

  if (/^[a-záéíóúüñ,]/.test(raw)) {
    const cut = raw.search(/[.?!]\s+[¿¡A-ZÁÉÍÓÚÑ]/);
    if (cut > -1 && cut < 160) raw = raw.slice(cut + 1).trim();
  }

  return raw.length > limit ? `${raw.slice(0, limit - 1).trim()}…` : raw;
}

/** Referencias bíblicas citadas en el fragmento, en orden de aparición. */
export function findReferences(text) {
  const refs = [];
  for (const m of String(text).matchAll(REF_PATTERN)) {
    const end = m[4] ? `-${m[4]}` : "";
    refs.push(`${m[1].trim()} ${m[2]}:${m[3]}${end}`);
  }
  for (const m of String(text).matchAll(SPOKEN_REF_PATTERN)) {
    refs.push(`${m[1].trim()} ${m[2]}:${m[3]}`);
  }
  return refs;
}

/**
 * Ordena por cuántas palabras de la pregunta aparecen y, entre esas, por
 * cercanía entre ellas (ts_rank_cd), que es lo que distingue una enseñanza
 * sobre el tema de una mención de paso.
 */
async function searchFragments(db, terms) {
  const { rows } = await db.query(
    `WITH q AS (SELECT to_tsquery('spanish', $1) AS tsq),
          cand AS (
            SELECT f.content, f.start_second, v.title, v.episode, v.youtube_id,
                   ts_rank_cd(
                     to_tsvector('spanish', coalesce(f.content, '') || ' ' || coalesce(v.title, '')),
                     q.tsq
                   ) AS score
              FROM fragment f
              JOIN video v ON v.id = f.video_id, q
             WHERE to_tsvector('spanish', coalesce(f.content, '') || ' ' || coalesce(v.title, '')) @@ q.tsq
             ORDER BY score DESC
             LIMIT 400
          ),
          scored AS (
            SELECT c.*,
                   (SELECT count(*) FROM unnest($2::text[]) AS t
                     WHERE to_tsvector('spanish', coalesce(c.content, '') || ' ' || coalesce(c.title, ''))
                           @@ to_tsquery('spanish', t || ':*')) AS hits,
                   (SELECT count(*) FROM unnest($2::text[]) AS t
                     WHERE to_tsvector('spanish', c.title) @@ to_tsquery('spanish', t || ':*')) AS title_hits
              FROM cand c
          )
     SELECT * FROM scored
      ORDER BY hits DESC, (score + 0.4 * title_hits) DESC
      LIMIT 1`,
    [prefixQuery(terms), terms],
  );
  return rows[0] ?? null;
}

/** Nombre corto de la serie dentro del titulo del video. */
function seriesFromTitle(title) {
  const m = String(title).match(/-\s*\d+\s*-\s*([^(-]+?)(?:\s*\(|$)/i);
  return m ? m[1].trim() : String(title);
}

/**
 * Videos cuyo titulo coincide con la pregunta (audios sin transcripcion indexada).
 * Muchos episodios recientes solo tienen titulo en la base, no fragmentos.
 */
export async function searchVideosByTitle(db, question, limit = 3) {
  if (!db) return [];
  const terms = searchTerms(question);
  if (!terms.length) return [];

  const needed = minHits(terms);

  const { rows } = await db.query(
    `SELECT v.id, v.title, v.episode, v.youtube_id,
            (SELECT count(*) FROM unnest($1::text[]) AS t
              WHERE lower(v.title) LIKE '%' || t || '%') AS hits
       FROM video v
      WHERE EXISTS (
        SELECT 1 FROM unnest($1::text[]) AS t
        WHERE lower(v.title) LIKE '%' || t || '%'
      )
      ORDER BY hits DESC, v.episode ASC
      LIMIT $2`,
    [terms, limit],
  );

  return rows.filter((r) => Number(r.hits) >= needed);
}

/**
 * Fragmentos de uno o varios videos concretos (p. ej. al coincidir el título).
 * Orden: inicio del audio primero, para resumir la enseñanza completa.
 */
export async function fragmentsForVideos(db, videoIds, limit = 8) {
  if (!db || !videoIds?.length) return [];

  const { rows } = await db.query(
    `SELECT f.content, f.start_second, v.id AS video_id, v.title, v.episode, v.youtube_id
       FROM fragment f
       JOIN video v ON v.id = f.video_id
      WHERE f.video_id = ANY($1::bigint[])
        AND coalesce(trim(f.content), '') <> ''
      ORDER BY v.episode ASC, f.start_second ASC NULLS LAST
      LIMIT $2`,
    [videoIds, limit],
  );

  return rows;
}

/** Respuesta directa cuando hay video por titulo pero sin transcripcion. */
export async function answerByTitleSearch(db, question) {
  const videos = await searchVideosByTitle(db, question, 3);
  if (!videos.length) return null;

  const v = videos[0];
  const series = seriesFromTitle(v.title);
  const parts = videos.length > 1 ? ` (${videos.length} partes en la biblioteca)` : "";

  return {
    answer: `Sí, el ministerio tiene una serie sobre «${series}»${parts}. Te comparto el primer video para que lo escuches; ahí el pastor explica el tema con detalle.`,
    video: {
      title: v.title,
      episode: v.episode,
      youtube_id: v.youtube_id,
      start_second: 0,
    },
    source: "video",
    matchedByTitle: true,
  };
}

async function searchVerses(db, terms) {
  const { rows } = await db.query(
    `WITH q AS (SELECT to_tsquery('spanish', $1) AS tsq),
          cand AS (
            SELECT b.name AS book, v.chapter, v.verse, v.text,
                   ts_rank_cd(to_tsvector('spanish', v.text), q.tsq) AS score
              FROM verses v
              JOIN books b ON b.id = v.book_id, q
             WHERE to_tsvector('spanish', v.text) @@ q.tsq
             ORDER BY score DESC
             LIMIT 200
          )
     SELECT c.*,
            (SELECT count(*) FROM unnest($2::text[]) AS t
              WHERE to_tsvector('spanish', c.text) @@ to_tsquery('spanish', t || ':*')) AS hits
       FROM cand c
      ORDER BY hits DESC, score DESC
      LIMIT 1`,
    [prefixQuery(terms), terms],
  );
  return rows[0] ?? null;
}

/**
 * Los mejores fragmentos para dárselos a un modelo como contexto.
 * @returns {Promise<object[]>} vacío si nada alcanza el mínimo de relevancia.
 */
export async function contextFragments(db, question, limit = 5) {
  if (!db) return [];
  const terms = searchTerms(question);
  if (!terms.length) return [];

  const { rows } = await db.query(
    `WITH q AS (SELECT to_tsquery('spanish', $1) AS tsq),
          cand AS (
            SELECT f.content, f.start_second, v.title, v.episode, v.youtube_id,
                   ts_rank_cd(
                     to_tsvector('spanish', coalesce(f.content, '') || ' ' || coalesce(v.title, '')),
                     q.tsq
                   ) AS score
              FROM fragment f
              JOIN video v ON v.id = f.video_id, q
             WHERE to_tsvector('spanish', coalesce(f.content, '') || ' ' || coalesce(v.title, '')) @@ q.tsq
             ORDER BY score DESC
             LIMIT 400
          ),
          scored AS (
            SELECT c.*,
                   (SELECT count(*) FROM unnest($2::text[]) AS t
                     WHERE to_tsvector('spanish', coalesce(c.content, '') || ' ' || coalesce(c.title, ''))
                           @@ to_tsquery('spanish', t || ':*')) AS hits,
                   (SELECT count(*) FROM unnest($2::text[]) AS t
                     WHERE to_tsvector('spanish', c.title) @@ to_tsquery('spanish', t || ':*')) AS title_hits
              FROM cand c
          )
     SELECT * FROM scored
      WHERE hits >= $3
      ORDER BY hits DESC, (score + 0.4 * title_hits) DESC
      LIMIT $4`,
    [prefixQuery(terms), terms, minHits(terms), limit],
  );

  return rows;
}


/**
 * Versículos de la Biblia relacionados con la pregunta (hasta `limit`).
 * @returns {Promise<object[]>}
 */
export async function relatedVerses(db, question, limit = 3) {
  if (!db) return [];
  const terms = searchTerms(question);
  if (!terms.length) return [];

  const { rows } = await db.query(
    `WITH q AS (SELECT to_tsquery('spanish', $1) AS tsq),
          cand AS (
            SELECT b.name AS book, v.chapter, v.verse, v.text,
                   ts_rank_cd(to_tsvector('spanish', v.text), q.tsq) AS score
              FROM verses v
              JOIN books b ON b.id = v.book_id, q
             WHERE to_tsvector('spanish', v.text) @@ q.tsq
             ORDER BY score DESC
             LIMIT 120
          ),
          scored AS (
            SELECT c.*,
                   (SELECT count(*) FROM unnest($2::text[]) AS t
                     WHERE to_tsvector('spanish', c.text) @@ to_tsquery('spanish', t || ':*')) AS hits
              FROM cand c
          )
     SELECT * FROM scored
      WHERE hits >= $3
      ORDER BY hits DESC, score DESC
      LIMIT $4`,
    [prefixQuery(terms), terms, minHits(terms), limit],
  );
  return rows;
}

/** Pasajes biblicos mas relevantes para explicar una pregunta (sin umbral estricto). */
export async function bibleVersesForQuestion(db, question, limit = 5) {
  if (!db) return [];
  const terms = bibleTerms(question);
  if (!terms.length) return [];

  const ordered = [...terms].sort((a, b) => b.length - a.length);
  const buckets = [];

  for (const [i, term] of ordered.entries()) {
    const perTerm = i === 0 ? 5 : 2;
    const { rows } = await db.query(
      `SELECT b.name AS book, v.chapter, v.verse, v.text,
              ts_rank_cd(to_tsvector('spanish', v.text), to_tsquery('spanish', $1)) AS score
         FROM verses v
         JOIN books b ON b.id = v.book_id
        WHERE to_tsvector('spanish', v.text) @@ to_tsquery('spanish', $1)
        ORDER BY score DESC
        LIMIT $2`,
      [`${term}:*`, perTerm],
    );
    buckets.push(rows);
  }

  const seen = new Set();
  const collected = [];
  for (const rows of buckets) {
    for (const row of rows) {
      const key = `${row.book}:${row.chapter}:${row.verse}`;
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(row);
      if (collected.length >= limit) break;
    }
    if (collected.length >= limit) break;
  }

  return collected;
}

/**
 * Busca una respuesta en la base sin usar ningún modelo.
 * @param {import("pg").Pool} db
 * @param {string} question
 * @param {(ref: string) => Promise<object|null>} resolvePassage
 * @returns {Promise<object|null>} null cuando nada alcanza el mínimo de relevancia.
 */
export async function answerBySearch(db, question, resolvePassage) {
  if (!db) return null;
  const terms = searchTerms(question);
  if (!terms.length) return null;
  const needed = minHits(terms);

  const fragment = await searchFragments(db, terms);
  if (fragment && Number(fragment.hits) >= needed) {
    let passage = null;
    for (const ref of findReferences(fragment.content)) {
      passage = await resolvePassage(ref);
      if (passage) break;
    }

    return {
      answer:
        "Encontré esta enseñanza del ministerio que habla de tu pregunta. Te dejo el fragmento y el video para que lo escuches desde el minuto exacto.",
      excerpt: buildExcerpt(fragment.content, 650),
      transcript: buildExcerpt(fragment.content, 1800),
      passage: passage ?? undefined,
      video: {
        title: fragment.title,
        episode: fragment.episode,
        youtube_id: fragment.youtube_id,
        start_second: fragment.start_second ?? 0,
      },
      source: "video",
    };
  }

  const byTitle = await answerByTitleSearch(db, question);
  if (byTitle) return byTitle;

  const verse = await searchVerses(db, terms);
  if (verse && Number(verse.hits) >= needed) {
    return {
      answer:
        "No encontré una enseñanza en video sobre eso, pero sí este pasaje de la Biblia para que lo leas y lo medites.",
      passage: await resolvePassage(`${verse.book} ${verse.chapter}:${verse.verse}`),
      source: "biblia",
    };
  }

  return null;
}
