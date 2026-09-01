/**
 * chat-llm.js — Redacta la respuesta con el primer proveedor que conteste.
 *
 * Las capas gratuitas se agotan por día o por minuto, así que se prueban en
 * cadena: si una falla, sigue la siguiente. Cuando ninguna responde, quien
 * contesta es la búsqueda por texto, sin explicación redactada.
 *
 * El contexto sale de las transcripciones propias: el modelo solo redacta lo
 * que ya enseñó el ministerio, nunca inventa doctrina.
 */

import { contextFragments, buildExcerpt } from "./chat-search.js";

const SYSTEM = `Eres Grace, guia calida de la Escuela Biblica de Palabra Pura.
Tu tarea es responder la pregunta del usuario de forma clara, intuitiva y directa, usando UNICAMENTE las transcripciones de audio de los videos que se te entregan.

Reglas:
- Responde lo que la persona pregunto, con palabras sencillas, como si la acompanaras paso a paso.
- NO digas frases vacias como "encontre una ensenanza" o "te dejo el fragmento". Explica el contenido.
- Basa cada idea en lo que el pastor enseno en el audio. No inventes doctrina ni versiculos.
- Si el audio no alcanza para responder la pregunta, responde EXACTAMENTE con: {"found": false}
- Si SI puedes responder, responde con:
{"found": true, "answer": "tu explicacion en 3 a 5 frases, concretas y utiles", "reference": "referencia biblica principal si se menciona en el audio, o cadena vacia"}
Para "reference" usa el formato exacto "Libro Capitulo:Versiculo" o "Libro Capitulo:Versiculo-Versiculo" (ejemplos: "Juan 3:16", "Genesis 1:1-3"). Usa el nombre del libro tal como aparece en la Biblia Reina-Valera Antigua.
NUNCA inventes el texto del versiculo; solo devuelves la referencia. El texto lo pone el sistema.
Tono: cercano, respetuoso, en espanol. Responde SOLO con el objeto JSON, sin texto adicional.`;

/** Proveedores en orden de preferencia. Dola primero si hay clave. */
const PROVIDERS = [
  {
    name: "dola",
    key: () => process.env.DOLA_API_KEY || process.env.BYTEPLUS_API_KEY,
    url:
      process.env.DOLA_API_URL ||
      "https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions",
    model: () => process.env.DOLA_MODEL || "dola-seed-2-1-turbo-260628",
  },
  {
    name: "groq",
    key: () => process.env.GROQ_API_KEY,
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: () => process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  },
  {
    name: "groq-mini",
    key: () => process.env.GROQ_API_KEY,
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: () => process.env.GROQ_MODEL_FALLBACK || "openai/gpt-oss-20b",
  },
  {
    name: "openrouter",
    key: () => process.env.OPENROUTER_API_KEY,
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: () => process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash",
  },
  {
    name: "cerebras",
    key: () => process.env.CEREBRAS_API_KEY,
    url: "https://api.cerebras.ai/v1/chat/completions",
    model: () => process.env.CEREBRAS_MODEL || "llama-3.3-70b",
  },
];

/** True si hay al menos un proveedor con clave. */
export function hasWriter() {
  return PROVIDERS.some((p) => Boolean(p.key()));
}

async function callProvider(provider, system, userContent) {
  const res = await fetch(provider.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.key()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model(),
      temperature: 0.45,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`${provider.name} ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  try {
    return JSON.parse(content);
  } catch {
    return { found: true, answer: content };
  }
}

/** Recorre la cadena hasta que uno conteste. Null si ninguno pudo. */
export async function askAnyLLM(system, userContent) {
  for (const provider of PROVIDERS) {
    if (!provider.key()) continue;
    try {
      return await callProvider(provider, system, userContent);
    } catch (err) {
      console.error("[chat] llm", err.message);
    }
  }
  return null;
}

/** Pide al modelo que explique un fragmento de transcripcion para la pregunta. */
export async function explainFromTranscript(question, transcript, videoTitle = "") {
  if (!transcript?.trim()) return null;

  const title = videoTitle ? ` del video "${videoTitle}"` : "";
  const reply = await askAnyLLM(
    SYSTEM,
    `Transcripcion de audio${title}:\n${String(transcript).slice(0, 1800)}\n\nPregunta del usuario: ${question}`,
  );

  if (!reply || reply.found === false || !reply.answer) return null;
  return reply;
}

/**
 * Busca las enseñanzas por texto y pide al modelo que las explique.
 *
 * @returns {Promise<object|null>} La respuesta redactada; `{ notFound: true }`
 * cuando el modelo leyó el material y dijo que no responde la pregunta; `null`
 * cuando ningún modelo contestó y hay que recurrir al respaldo sin IA.
 */
export async function answerWithSearch(db, question, resolvePassage) {
  const fragments = await contextFragments(db, question, 3);
  if (!fragments.length) return { notFound: true };

  const context = fragments
    .map(
      (f, i) =>
        `Fragmento ${i + 1} — video "${f.title}", episodio ${f.episode ?? "?"}:\n${String(
          f.content,
        ).slice(0, 1400)}`,
    )
    .join("\n\n");

  const reply = await askAnyLLM(SYSTEM, `Contexto de los videos:\n${context}\n\nPregunta: ${question}`);
  if (!reply) return null;
  if (reply.found === false || !reply.answer) return { notFound: true };

  const top = fragments[0];
  return {
    answer: reply.answer,
    passage: (await resolvePassage(reply.reference)) ?? undefined,
    excerpt: buildExcerpt(top.content, 650),
    video: {
      title: top.title,
      episode: top.episode,
      youtube_id: top.youtube_id,
      start_second: top.start_second ?? 0,
    },
    source: "video",
  };
}
