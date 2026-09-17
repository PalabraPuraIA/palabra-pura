import { createClient } from "jsr:@supabase/supabase-js@2";
// ---- Configuracion ----
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const OPENROUTER_MODEL = "google/gemini-2.5-flash";
// Cuantos capitulos-padre completos enviar como contexto (control de tokens).
const MAX_PARENTS = 2;
const MIN_SIMILARITY = 0.65;
const VECTOR_CANDIDATES = 12;
const SEED_LIMIT = 4;
const CONTEXT_MAX = 8;
const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
// ---- Prompts ----
// Primera etapa: SOLO videos. El LLM decide si puede responder o no.
const SYSTEM_VIDEO = `Eres una guia calida de la Iglesia Palabra Pura que acompana a personas que empiezan en la fe.
Responde UNICAMENTE con base en las transcripciones de video que se te entregan.
Si las transcripciones NO contienen lo necesario para responder la pregunta, responde EXACTAMENTE con: {"found": false}
Si SI puedes responder con base en los videos, responde con:
{"found": true, "answer": "tu respuesta en 2 a 4 frases", "reference": "referencia biblica si en el contexto se menciona un pasaje, o cadena vacia", "evidence": {"fragment": 1, "start_sentence": 1, "end_sentence": 3}}
Para "reference" usa el formato exacto "Libro Capitulo:Versiculo" o "Libro Capitulo:Versiculo-Versiculo" (ejemplos: "Juan 3:16", "Genesis 1:1-3"). Usa el nombre del libro tal como aparece en la Biblia Reina-Valera Antigua.
NUNCA inventes el texto del versiculo; solo devuelves la referencia. El texto lo pone el sistema.
En "evidence", elige un rango continuo de oraciones numeradas que sustente la respuesta.
Tono: sencillo, calido y respetuoso, en espanol. Responde SOLO con el objeto JSON, sin texto adicional.`;
// Segunda etapa: contexto biblico ampliado (capitulo completo via parent-child).
const SYSTEM_BIBLE = `Eres una guia calida de la Iglesia Palabra Pura que acompana a personas que empiezan en la fe.
Responde con base en el pasaje biblico (contexto ampliado) que se te entrega. Si el contexto no contiene la respuesta, dilo con humildad y no inventes nada.
Tono: sencillo, calido y respetuoso, en espanol, en 2 a 4 frases.
Si citas un pasaje, indica su referencia en formato exacto "Libro Capitulo:Versiculo" o "Libro Capitulo:Versiculo-Versiculo" (ej: "Juan 3:16", "Genesis 1:1-3"), con el nombre del libro tal como aparece en la Reina-Valera Antigua.
NUNCA inventes el texto del versiculo; solo devuelves la referencia. El texto lo pone el sistema.
Responde SOLO con este objeto JSON: {"answer": "tu respuesta", "reference": "Libro C:V o cadena vacia"}`;
// ---- Helpers ----
// Normaliza para comparar nombres de libros (minusculas, sin acentos).
const norm = (s)=>s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const clean = (s)=>String(s ?? "").replace(/\s+/g, " ").trim();
function sentences(content) {
  const raw = clean(content);
  if (!raw) return [];
  const parts = raw.split(/(?<=[.!?…])\s+(?=[¿¡A-ZÁÉÍÓÚÜÑ0-9"'])/).map(clean).filter(Boolean);
  return parts.length ? parts : [
    raw
  ];
}
function numberedFragments(fragments) {
  return fragments.map((f, fi)=>{
    const lines = sentences(f.content).map((s, si)=>`[F${fi + 1} S${si + 1}] ${s}`);
    return `Fragmento F${fi + 1} — video "${f.title}", episodio ${f.episode ?? "?"}:\n${lines.join("\n")}`;
  }).join("\n\n");
}
function literalExcerpt(fragments, evidence) {
  const fi = Number(evidence?.fragment) - 1;
  const start = Number(evidence?.start_sentence) - 1;
  const end = Number(evidence?.end_sentence);
  const fragment = fragments[fi] ?? fragments[0];
  const list = sentences(fragment?.content);
  const valid = fragment && Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= list.length && end - start <= 9;
  let excerpt = valid ? clean(list.slice(start, end).join(" ")) : clean(list.slice(0, Math.min(3, list.length)).join(" "));
  if (excerpt.length > 1800) excerpt = `${excerpt.slice(0, 1799).replace(/\s+\S*$/, "").trim()}…`;
  return {
    excerpt: excerpt || undefined,
    fragment,
    retrieval: {
      fragment_id: fragment?.id ?? null,
      position: fragment?.position ?? null,
      score: fragment?.similarity ?? null,
      sentence_start: valid ? start + 1 : 1,
      sentence_end: valid ? end : Math.min(3, list.length),
      strategy: valid ? "llm-sentence-range" : "first-sentences"
    }
  };
}
// Cache de la tabla `books` mientras el isolate esta caliente (66 filas, no cambia).
let booksCache = null;
async function getBooksMap() {
  if (booksCache) return booksCache;
  const { data, error } = await supabase.from("books").select("id, name, modern_name");
  const map = new Map();
  for (const b of data ?? []){
    if (b.name) map.set(norm(b.name), b.id);
    if (b.modern_name) map.set(norm(b.modern_name), b.id);
  }
  booksCache = map;
  return map;
}
// Parsea "Juan 3:16", "Genesis 1:1-3", "1 Juan 4:8", "Salmos 23".
function parseRef(ref) {
  const m = String(ref).trim().match(/^(.+?)\s+(\d+)(?::(\d+)(?:\s*-\s*(\d+))?)?$/);
  if (!m) return null;
  const startVerse = m[3] ? parseInt(m[3]) : null;
  return {
    book: m[1].trim(),
    chapter: parseInt(m[2]),
    startVerse,
    endVerse: m[4] ? parseInt(m[4]) : startVerse
  };
}
// Dada una referencia, devuelve el TEXTO EXACTO desde `verses` (nunca del LLM).
async function resolvePassage(reference) {
  if (!reference || typeof reference !== "string" || reference.trim() === "") return null;
  const parsed = parseRef(reference);
  if (!parsed) return null;
  const books = await getBooksMap();
  const bookId = books.get(norm(parsed.book));
  if (!bookId) return null;
  let q = supabase.from("verses").select("verse, text").eq("book_id", bookId).eq("chapter", parsed.chapter).order("verse");
  if (parsed.startVerse != null) {
    q = q.gte("verse", parsed.startVerse).lte("verse", parsed.endVerse);
  }
  const { data: verses } = await q;
  if (!verses || verses.length === 0) return null;
  const text = verses.map((v)=>v.text).join(" ");
  const label = parsed.startVerse == null ? `${parsed.book} ${parsed.chapter}` : parsed.startVerse === parsed.endVerse ? `${parsed.book} ${parsed.chapter}:${parsed.startVerse}` : `${parsed.book} ${parsed.chapter}:${parsed.startVerse}-${parsed.endVerse}`;
  return {
    reference: label,
    text
  };
}
function filterBySimilarity(rows, minSimilarity = MIN_SIMILARITY, fallbackTop = 3) {
  const list = Array.isArray(rows) ? rows : [];
  const passed = list.filter((row) => Number(row.similarity) >= minSimilarity);
  return passed.length ? passed : list.slice(0, fallbackTop);
}

async function expandAdjacent(seeds, radius = 1, max = CONTEXT_MAX) {
  const result = [];
  const seen = new Set();
  const push = (row) => {
    const key = `${row.video_id}:${row.position}`;
    if (seen.has(key) || result.length >= max) return;
    seen.add(key);
    result.push(row);
  };

  for (const match of seeds) {
    const { data, error } = await supabase
      .from("fragment")
      .select("id, position, content, start_second, word_count, video_id")
      .eq("video_id", match.video_id)
      .gte("position", Number(match.position) - radius)
      .lte("position", Number(match.position) + radius)
      .order("position");
    if (error || !data?.length) {
      push(match);
      continue;
    }
    // Adjuntar metadatos del video desde el seed.
    for (const row of data) {
      push({
        ...row,
        title: match.title,
        episode: match.episode,
        youtube_id: match.youtube_id,
        similarity: row.position === match.position ? match.similarity : undefined,
      });
    }
    if (result.length >= max) break;
  }
  return result.length ? result : seeds;
}

async function retrieveVideoFragments(embStr) {
  const { data: fragMatches, error: fragErr } = await supabase.rpc("match_fragments", {
    query_embedding: embStr,
    match_count: VECTOR_CANDIDATES,
  });
  if (fragErr) throw new Error("match_fragments: " + fragErr.message);
  const filtered = filterBySimilarity(fragMatches || []);
  if (!filtered.length) return [];
  const seeds = filtered.slice(0, SEED_LIMIT);
  const shortHit = seeds.some((s) => Number(s.word_count) > 0 && Number(s.word_count) < 120);
  return expandAdjacent(seeds, shortHit ? 2 : 1, CONTEXT_MAX);
}

// Embebe la pregunta del usuario.
async function embedQuery(question) {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY
    },
    body: JSON.stringify({
      content: {
        parts: [
          {
            text: question
          }
        ]
      },
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: 3072
    })
  });
  if (!res.ok) throw new Error("Gemini embedding: " + await res.text());
  const data = await res.json();
  return data.embedding.values;
}
// Llama al LLM (Gemini) y parsea el JSON de respuesta.
async function askLLM(system, userContent) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: userContent }] }],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: "application/json",
        },
      }),
    },
  );
  if (!res.ok) throw new Error("Gemini LLM: " + await res.text());
  const data = await res.json();
  const content = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  try {
    return JSON.parse(content);
  } catch {
    return { answer: content };
  }
}
// ---- Handler ----
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: cors
  });
  try {
    const { question } = await req.json();
    if (!question || typeof question !== "string") {
      return json({
        answer: "Escribeme una pregunta y con gusto te acompano."
      });
    }
    const embedding = await embedQuery(question);
    const embStr = JSON.stringify(embedding); // halfvec como texto "[...]"
    // ========== 1) VIDEOS primero ==========
    const fragMatches = await retrieveVideoFragments(embStr);
    if (fragMatches && fragMatches.length > 0) {
      const context = numberedFragments(fragMatches);
      const vid = await askLLM(SYSTEM_VIDEO, `Contexto de los videos:\n${context}\n\nPregunta: ${question}`);
      // Si el LLM pudo responder con los videos, terminamos aqui.
      if (vid.found) {
        const passage = await resolvePassage(vid.reference);
        const selected = literalExcerpt(fragMatches, vid.evidence);
        const top = selected.fragment;
        return json({
          answer: vid.answer ?? "",
          passage: passage ? {
            ...passage,
            bible_version: "Reina-Valera Antigua"
          } : undefined,
          excerpt: selected.excerpt,
          retrieval: selected.retrieval,
          video: {
            title: top.title,
            episode: top.episode,
            youtube_id: top.youtube_id,
            start_second: top.start_second ?? 0
          },
          source: "video"
        });
      }
    }
    // ========== 2) BIBLIA (solo si el video NO respondio) ==========
    const { data: chunkMatches, error: chunkErr } = await supabase.rpc("match_bible_chunks", {
      query_embedding: embStr,
      match_count: 5
    });
    if (chunkErr) throw new Error("match_bible_chunks: " + chunkErr.message);
    if (!chunkMatches || chunkMatches.length === 0) {
      return json({
        answer: "Todavia no encuentro material sobre eso. ¿Quieres preguntarlo de otra forma?"
      });
    }
    // Parent-child: recupera el/los capitulos completos (padres) de los mejores chunks.
    const parentIds = [
      ...new Set(chunkMatches.map((c)=>c.parent_id).filter(Boolean))
    ].slice(0, MAX_PARENTS);
    const { data: parents } = await supabase.from("bible_parents").select("id, book_id, chapter, parent_text").in("id", parentIds);
    // Contexto ampliado: si hay padres, mandamos el pasaje completo;
    // si por algo faltan, caemos a los chunks recuperados.
    const bibleContext = parents && parents.length > 0 ? parents.map((p)=>`Pasaje biblico (contexto ampliado):\n${p.parent_text}`).join("\n\n---\n\n") : chunkMatches.slice(0, 3).map((c)=>c.chunk_text).join("\n\n");
    const bib = await askLLM(SYSTEM_BIBLE, `Contexto biblico:\n${bibleContext}\n\nPregunta: ${question}`);
    const passage = await resolvePassage(bib.reference);
    return json({
      answer: bib.answer ?? "",
      passage: passage ? {
        ...passage,
        bible_version: "Reina-Valera Antigua"
      } : undefined,
      source: "biblia"
    });
  } catch (e) {
    console.error(e);
    return json({
      answer: "Tuve un problema para responder ahora mismo. Intenta de nuevo en un momento."
    });
  }
});
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json"
    }
  });
}
