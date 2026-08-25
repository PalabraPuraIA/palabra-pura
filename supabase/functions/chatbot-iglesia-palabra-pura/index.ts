import { createClient } from "jsr:@supabase/supabase-js@2";
// ---- Configuracion ----
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const OPENROUTER_MODEL = "google/gemini-2.5-flash";
// Cuantos capitulos-padre completos enviar como contexto (control de tokens).
const MAX_PARENTS = 2;
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
{"found": true, "answer": "tu respuesta en 2 a 4 frases", "reference": "referencia biblica si en el contexto se menciona un pasaje, o cadena vacia"}
Para "reference" usa el formato exacto "Libro Capitulo:Versiculo" o "Libro Capitulo:Versiculo-Versiculo" (ejemplos: "Juan 3:16", "Genesis 1:1-3"). Usa el nombre del libro tal como aparece en la Biblia Reina-Valera Antigua.
NUNCA inventes el texto del versiculo; solo devuelves la referencia. El texto lo pone el sistema.
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
// Llama al LLM (OpenRouter) y parsea el JSON de respuesta.
async function askLLM(system, userContent) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      temperature: 0.3,
      response_format: {
        type: "json_object"
      },
      messages: [
        {
          role: "system",
          content: system
        },
        {
          role: "user",
          content: userContent
        }
      ]
    })
  });
  if (!res.ok) throw new Error("OpenRouter: " + await res.text());
  const data = await res.json();
  try {
    return JSON.parse(data.choices[0].message.content);
  } catch  {
    return {
      answer: data?.choices?.[0]?.message?.content ?? ""
    };
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
    const { data: fragMatches, error: fragErr } = await supabase.rpc("match_fragments", {
      query_embedding: embStr,
      match_count: 5
    });
    if (fragErr) throw new Error("match_fragments: " + fragErr.message);
    if (fragMatches && fragMatches.length > 0) {
      const context = fragMatches.map((m, i)=>`Fragmento ${i + 1} — video "${m.title}", episodio ${m.episode ?? "?"}:\n${m.content}`).join("\n\n");
      const vid = await askLLM(SYSTEM_VIDEO, `Contexto de los videos:\n${context}\n\nPregunta: ${question}`);
      // Si el LLM pudo responder con los videos, terminamos aqui.
      if (vid.found) {
        const passage = await resolvePassage(vid.reference);
        const top = fragMatches[0];
        return json({
          answer: vid.answer ?? "",
          passage: passage ?? undefined,
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
      passage: passage ?? undefined,
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
