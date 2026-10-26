/**
 * tlaPassage.js — Completa pasajes con texto TLA en el navegador.
 * Útil en GitHub Pages cuando la edge aún no devolvió versions[].
 */

const TLA_URL = "https://mrk214.github.io/snapshots/es___spa___spa/TLA_vid_176.json";
const TLA_LABEL = "Traducción en Lenguaje Actual";

const USFM_BY_NORM = {
  genesis: "GEN", exodo: "EXO", levitico: "LEV", numeros: "NUM", deuteronomio: "DEU",
  josue: "JOS", jueces: "JDG", rut: "RUT", "1 samuel": "1SA", "2 samuel": "2SA",
  "1 reyes": "1KI", "2 reyes": "2KI", "1 cronicas": "1CH", "2 cronicas": "2CH",
  esdras: "EZR", nehemias: "NEH", ester: "EST", job: "JOB", salmos: "PSA",
  proverbios: "PRO", eclesiastes: "ECC", cantares: "SNG", cantar: "SNG",
  isaias: "ISA", jeremias: "JER", lamentaciones: "LAM", ezequiel: "EZK", daniel: "DAN",
  oseas: "HOS", joel: "JOL", amos: "AMO", abdias: "OBA", jonas: "JON", miqueas: "MIC",
  nahum: "NAM", habacuc: "HAB", sofonias: "ZEP", hageo: "HAG", zacarias: "ZEC",
  malaquias: "MAL", mateo: "MAT", "san mateo": "MAT", marcos: "MRK", "san marcos": "MRK",
  lucas: "LUK", "san lucas": "LUK", juan: "JHN", "san juan": "JHN", hechos: "ACT",
  romanos: "ROM", "1 corintios": "1CO", "2 corintios": "2CO", galatas: "GAL",
  efesios: "EPH", filipenses: "PHP", colosenses: "COL", "1 tesalonicenses": "1TH",
  "2 tesalonicenses": "2TH", "1 timoteo": "1TI", "2 timoteo": "2TI", tito: "TIT",
  filemon: "PHM", hebreos: "HEB", santiago: "JAS", "1 pedro": "1PE", "2 pedro": "2PE",
  "1 juan": "1JN", "2 juan": "2JN", "3 juan": "3JN", judas: "JUD", apocalipsis: "REV",
  revelacion: "REV",
};

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

function parseRef(ref) {
  const m = String(ref || "")
    .trim()
    .match(/^(.+?)\s+(\d+)(?::(\d+)(?:\s*-\s*(\d+))?)?$/);
  if (!m) return null;
  const startVerse = m[3] ? Number(m[3]) : null;
  return {
    book: m[1].trim(),
    chapter: Number(m[2]),
    startVerse,
    endVerse: m[4] ? Number(m[4]) : startVerse,
  };
}

let tlaPromise = null;

function loadTlaBible() {
  if (!tlaPromise) {
    tlaPromise = fetch(TLA_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`TLA ${res.status}`);
        return res.json();
      })
      .catch((err) => {
        tlaPromise = null;
        throw err;
      });
  }
  return tlaPromise;
}

async function fetchTlaText(reference) {
  const parsed = parseRef(reference);
  if (!parsed || parsed.startVerse == null) return null;
  const usfm = USFM_BY_NORM[norm(parsed.book)];
  if (!usfm) return null;
  try {
    const bible = await loadTlaBible();
    const book = bible.books?.find((b) => b.book_usfm === usfm);
    const ch = book?.chapters?.find((c) => c.chapter_usfm === `${usfm}.${parsed.chapter}`);
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

function hasTla(passage) {
  if (!passage) return false;
  if (/tla|lenguaje actual/i.test(String(passage.bible_version || ""))) return true;
  return (passage.versions || []).some(
    (v) => v.id === "tla" || /tla|lenguaje actual/i.test(String(v.bible_version || "")),
  );
}

/** Añade TLA al pasaje si falta; deja RVA como alternativa. */
export async function ensureTlaPassage(passage) {
  if (!passage?.reference || hasTla(passage)) return passage;
  const tlaText = await fetchTlaText(passage.reference);
  if (!tlaText) return passage;

  const versions = Array.isArray(passage.versions) ? [...passage.versions] : [];
  if (passage.text && !versions.length) {
    versions.push({
      id: /tla|lenguaje actual/i.test(String(passage.bible_version || "")) ? "tla" : "rva",
      bible_version: passage.bible_version || "Reina-Valera Antigua",
      text: passage.text,
    });
  }
  if (!versions.some((v) => v.id === "tla")) {
    versions.unshift({ id: "tla", bible_version: TLA_LABEL, text: tlaText });
  }

  return {
    ...passage,
    text: tlaText,
    bible_version: TLA_LABEL,
    versions,
  };
}

export async function ensureTlaInResponse(response) {
  if (!response || typeof response !== "object") return response;
  const next = { ...response };
  if (next.passage) next.passage = await ensureTlaPassage(next.passage);
  if (Array.isArray(next.passages) && next.passages.length) {
    next.passages = await Promise.all(next.passages.map((p) => ensureTlaPassage(p)));
  }
  return next;
}

/** Precarga el snapshot TLA en segundo plano. */
export function preloadTlaBible() {
  loadTlaBible().catch(() => {});
}
