/**
 * bible-versions.js — Pasajes en TLA + Reina-Valera Antigua.
 *
 * El usuario puede cambiar de versión en la UI.
 * RVA viene de la base local; TLA de un snapshot en caché.
 */

import fs from "fs";
import path from "path";
import os from "os";

const norm = (s) =>
  String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

const TLA_URL = "https://mrk214.github.io/snapshots/es___spa___spa/TLA_vid_176.json";
export const TLA_LABEL = "Traducción en Lenguaje Actual";
export const RVA_LABEL = "Reina-Valera Antigua";

/** Códigos USFM para la Traducción en Lenguaje Actual (TLA). */
const USFM_BY_NORM = {
  genesis: "GEN",
  exodo: "EXO",
  levitico: "LEV",
  numeros: "NUM",
  deuteronomio: "DEU",
  josue: "JOS",
  jueces: "JDG",
  rut: "RUT",
  "1 samuel": "1SA",
  "2 samuel": "2SA",
  "1 reyes": "1KI",
  "2 reyes": "2KI",
  "1 cronicas": "1CH",
  "2 cronicas": "2CH",
  esdras: "EZR",
  nehemias: "NEH",
  ester: "EST",
  job: "JOB",
  salmos: "PSA",
  proverbios: "PRO",
  eclesiastes: "ECC",
  cantares: "SNG",
  cantar: "SNG",
  isaias: "ISA",
  jeremias: "JER",
  lamentaciones: "LAM",
  ezequiel: "EZK",
  daniel: "DAN",
  oseas: "HOS",
  joel: "JOL",
  amos: "AMO",
  abdias: "OBA",
  jonas: "JON",
  miqueas: "MIC",
  nahum: "NAM",
  habacuc: "HAB",
  sofonias: "ZEP",
  hageo: "HAG",
  zacarias: "ZEC",
  malaquias: "MAL",
  mateo: "MAT",
  "san mateo": "MAT",
  marcos: "MRK",
  "san marcos": "MRK",
  lucas: "LUK",
  "san lucas": "LUK",
  juan: "JHN",
  "san juan": "JHN",
  hechos: "ACT",
  romanos: "ROM",
  "1 corintios": "1CO",
  "2 corintios": "2CO",
  galatas: "GAL",
  efesios: "EPH",
  filipenses: "PHP",
  colosenses: "COL",
  "1 tesalonicenses": "1TH",
  "2 tesalonicenses": "2TH",
  "1 timoteo": "1TI",
  "2 timoteo": "2TI",
  tito: "TIT",
  filemon: "PHM",
  hebreos: "HEB",
  santiago: "JAS",
  "1 pedro": "1PE",
  "2 pedro": "2PE",
  "1 juan": "1JN",
  "2 juan": "2JN",
  "3 juan": "3JN",
  judas: "JUD",
  apocalipsis: "REV",
  revelacion: "REV",
};

function bookUsfm(bookName) {
  return USFM_BY_NORM[norm(bookName)] || null;
}

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

/** Referencias citadas en el texto de Grace, p. ej. (1 Juan 4:16). */
export function extractRefsFromAnswer(answer) {
  const text = String(answer ?? "");
  const refs = [];
  const seen = new Set();
  const re =
    /(\d\s+[A-Za-zÁÉÍÓÚáéíóúÑñ]+(?:\s+[A-Za-zÁÉÍÓÚáéíóúÑñ]+)?|[A-Za-zÁÉÍÓÚáéíóúÑñ]+(?:\s+[A-Za-zÁÉÍÓÚáéíóúÑñ]+)?)\s+(\d+)(?::(\d+)(?:\s*-\s*(\d+))?)?/gi;

  let m;
  while ((m = re.exec(text)) !== null) {
    const book = m[1].trim();
    const chapter = m[2];
    const verse = m[3];
    const ref = verse
      ? m[4]
        ? `${book} ${chapter}:${verse}-${m[4]}`
        : `${book} ${chapter}:${verse}`
      : `${book} ${chapter}`;
    if (!parseRef(ref)) continue;
    const key = norm(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
}

let tlaLoadPromise = null;

function tlaCachePath() {
  const base = process.env.DATA_DIR || os.tmpdir();
  return path.join(base, "tla-bible-cache.json");
}

async function loadTlaBible() {
  if (!tlaLoadPromise) {
    tlaLoadPromise = (async () => {
      const cacheFile = tlaCachePath();
      try {
        if (fs.existsSync(cacheFile)) {
          const age = Date.now() - fs.statSync(cacheFile).mtimeMs;
          if (age < 7 * 86400000) {
            return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
          }
        }
      } catch {
        /* cache corrupto: re-descargar */
      }

      const res = await fetch(TLA_URL, { signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`TLA ${res.status}`);
      const data = await res.json();

      try {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify(data));
      } catch {
        /* sin cache en disco no es fatal */
      }

      return data;
    })().catch((err) => {
      tlaLoadPromise = null;
      throw err;
    });
  }
  return tlaLoadPromise;
}

/** Precarga TLA en segundo plano para que la primera respuesta ya tenga la pestaña. */
export function preloadTlaBible() {
  loadTlaBible().catch((err) => console.warn("[chat] TLA preload", err.message));
}

async function fetchTlaVersion(parsed) {
  const usfm = bookUsfm(parsed.book);
  if (!usfm || parsed.startVerse == null) return null;

  try {
    const bible = await loadTlaBible();
    const book = bible.books?.find((b) => b.book_usfm === usfm);
    if (!book) return null;

    const ch = book.chapters?.find((c) => c.chapter_usfm === `${usfm}.${parsed.chapter}`);
    if (!ch) return null;

    const lo = parsed.startVerse;
    const hi = parsed.endVerse ?? parsed.startVerse;
    const chunks = [];

    for (const item of ch.items || []) {
      if (item.type !== "verse") continue;
      const text = (item.lines || []).join(" ").replace(/\s+/g, " ").trim();
      if (!text) continue;
      for (const vn of item.verse_numbers || []) {
        if (vn >= lo && vn <= hi) chunks.push(text);
      }
    }

    if (!chunks.length) return null;
    return [...new Set(chunks)].join(" ");
  } catch {
    return null;
  }
}

/**
 * Devuelve el pasaje con ambas versiones cuando existen (RVA + TLA).
 * Texto por defecto: TLA si hay; si no, Reina-Valera.
 */
export async function resolvePassageWithVersions(reference, resolvePassage) {
  const parsed = parseRef(reference);
  if (!parsed || parsed.startVerse == null) return null;

  const primary = await resolvePassage(reference);
  const tlaText = await fetchTlaVersion(parsed);

  if (!primary?.text && !tlaText) return null;

  const refLabel =
    parsed.startVerse === parsed.endVerse
      ? `${parsed.book} ${parsed.chapter}:${parsed.startVerse}`
      : `${parsed.book} ${parsed.chapter}:${parsed.startVerse}-${parsed.endVerse}`;

  const versions = [];
  if (primary?.text) {
    versions.push({
      id: "rva",
      bible_version: primary.bible_version || RVA_LABEL,
      text: primary.text,
    });
  }
  if (tlaText) {
    versions.push({
      id: "tla",
      bible_version: TLA_LABEL,
      text: tlaText,
    });
  }

  const preferred = versions.find((v) => v.id === "tla") || versions[0];

  return {
    reference: primary?.reference || refLabel,
    text: preferred.text,
    bible_version: preferred.bible_version,
    versions,
  };
}

const MAX_PASSAGES = 5;

/** Versículos citados en la explicación, con TLA + RVA cuando hay. */
export async function enrichPassagesFromAnswer(payload, resolvePassage) {
  if (!payload?.answer) return payload;

  const fromAnswer = extractRefsFromAnswer(payload.answer);
  const list =
    Array.isArray(payload.passages) && payload.passages.length
      ? [...payload.passages]
      : payload.passage?.reference
        ? [payload.passage]
        : [];

  const seen = new Set(list.map((p) => norm(p.reference)));

  for (const ref of fromAnswer) {
    if (seen.has(norm(ref))) continue;
    const resolved = await resolvePassageWithVersions(ref, resolvePassage);
    if (!resolved) continue;
    seen.add(norm(resolved.reference));
    list.push(resolved);
  }

  const enriched = [];
  for (const p of list.slice(0, MAX_PASSAGES)) {
    const dual = await resolvePassageWithVersions(p.reference, resolvePassage);
    if (dual) enriched.push(dual);
  }

  if (!enriched.length) {
    const { passage, passages, ...rest } = payload;
    return rest;
  }

  return {
    ...payload,
    passage: enriched[0],
    passages: enriched,
  };
}
