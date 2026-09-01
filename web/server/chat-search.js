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
]);

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
 */
export function searchTerms(question) {
  const words = String(question)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));

  const roots = words.map((w) => (w.length <= 4 ? w : w.slice(0, w.length <= 5 ? 3 : 4)));
  return [...new Set(roots)].slice(0, 8);
}

/**
 * Cuántas raíces debe contener un texto para considerarlo relevante.
 * Con pocas palabras exigimos todas; con muchas, la mitad.
 */
function minHits(terms) {
  return terms.length <= 2 ? terms.length : Math.ceil(terms.length / 2);
}

function prefixQuery(terms) {
  return terms.map((t) => `${t}:*`).join(" | ");
}

/**
 * Los fragmentos se cortan por duración, así que suelen empezar a media frase.
 * Si la primera oración viene partida, arrancamos en la siguiente.
 */
function buildExcerpt(content, limit = 420) {
  let raw = String(content ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return undefined;

  if (/^[a-záéíóúüñ,]/.test(raw)) {
    const cut = raw.search(/[.?!]\s+[¿¡A-ZÁÉÍÓÚÑ]/);
    if (cut > -1 && cut < 160) raw = raw.slice(cut + 1).trim();
  }

  return raw.length > limit ? `${raw.slice(0, limit - 1).trim()}…` : raw;
}

/** Referencias bíblicas citadas en el fragmento, en orden de aparición. */
function findReferences(text) {
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
                   ts_rank_cd(to_tsvector('spanish', f.content), q.tsq) AS score
              FROM fragment f
              JOIN video v ON v.id = f.video_id, q
             WHERE to_tsvector('spanish', f.content) @@ q.tsq
             ORDER BY score DESC
             LIMIT 400
          ),
          scored AS (
            SELECT c.*,
                   (SELECT count(*) FROM unnest($2::text[]) AS t
                     WHERE to_tsvector('spanish', c.content) @@ to_tsquery('spanish', t || ':*')) AS hits,
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
                   ts_rank_cd(to_tsvector('spanish', f.content), q.tsq) AS score
              FROM fragment f
              JOIN video v ON v.id = f.video_id, q
             WHERE to_tsvector('spanish', f.content) @@ q.tsq
             ORDER BY score DESC
             LIMIT 400
          ),
          scored AS (
            SELECT c.*,
                   (SELECT count(*) FROM unnest($2::text[]) AS t
                     WHERE to_tsvector('spanish', c.content) @@ to_tsquery('spanish', t || ':*')) AS hits,
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
    [prefixQuery(terms), terms, Math.max(1, minHits(terms) - 1), limit],
  );
  return rows;
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
      excerpt: buildExcerpt(fragment.content),
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
