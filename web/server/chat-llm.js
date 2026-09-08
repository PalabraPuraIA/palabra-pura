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

import {
  contextFragments,
  buildExcerpt,
  trimRelevantExcerpt,
  findReferences,
  citationTextForVideo,
  bibleVersesForQuestion,
  graceBibleVerses,
  ministryGraceFragments,
  searchVideosByTitle,
  answerByTitleSearch,
  fragmentsForVideos,
} from "./chat-search.js";

/** Marco doctrinal que toda respuesta debe respetar. */
const GRACE_LENS = `
Marco doctrinal obligatorio — dispensacion de la gracia:
- La Escuela Biblica de Palabra Pura ensena bajo la dispensacion de la gracia, NO bajo la ley ni el Antiguo Pacto como norma para el creyente hoy.
- Cristo cumplio la ley; la justicia es por fe en lo que El hizo, no por obras de la ley ni por meritos propios.
- NUNCA condenes, clasifiques pecado ni des veredictos morales usando la ley de Moises, Mateo 19, Marcos 10, carta de divorcio o adulterio como regla para la Iglesia.
- Si la pregunta es etica (divorcio, volver a casarse, pecado, matrimonio), responde desde gracia: identidad en Cristo, no condenacion, justicia recibida, perdon, nueva criatura — NO desde legalismo.
- Divide correctamente la Palabra: no apliques mandatos del Antiguo Testamento sin la luz del Nuevo y de la gracia.
- Cada respuesta debe sonar a evangelio de la gracia, no a ministerio de condenacion de la ley.`;

const SYSTEM = `Eres Grace, guia calida de la Escuela Biblica de Palabra Pura.
Tu tarea es responder la pregunta del usuario de forma clara, intuitiva y directa, usando UNICAMENTE las transcripciones de audio de los videos que se te entregan.
${GRACE_LENS}

Reglas:
- Responde lo que la persona pregunto, con palabras sencillas, como si la acompanaras paso a paso.
- NUNCA uses groserias, insultos, palabras soeces ni tono agresivo. Habla siempre con respeto.
- NO digas frases vacias como "encontre una ensenanza" o "te dejo el fragmento". Explica el contenido.
- Basa cada idea en lo que el pastor enseno en el audio. No inventes doctrina ni versiculos.
- Si preguntan "que es X" y X es el titulo de una ensenanza, RESUME lo que el pastor enseno en ese audio; NO des una definicion de diccionario ni otra explicacion ajena a la transcripcion.
- Si la pregunta es una bobada, broma, groseria o algo SIN relacion con la Escuela Biblica, la fe, la Biblia o las ensenanzas del ministerio, responde EXACTAMENTE con: {"found": false, "off_topic": true}
- Si el audio solo menciona palabras parecidas por casualidad (comida, chistes, ejemplos del supermercado, etc.) pero NO ensena sobre lo que preguntaron, responde EXACTAMENTE con: {"found": false, "off_topic": true}
- Si el audio no alcanza para responder la pregunta, responde EXACTAMENTE con: {"found": false}
- Si SI puedes responder, responde con:
{"found": true, "answer": "explicacion breve en 2 a 3 frases (NO copies la transcripcion; el sistema mostrara un recorte del audio aparte)", "reference": "SOLO una referencia biblica si el AUDIO la menciona textualmente; si el audio no cita ningun versiculo, cadena vacia"}
Para "reference" usa el formato exacto "Libro Capitulo:Versiculo" o "Libro Capitulo:Versiculo-Versiculo" (ejemplos: "Juan 3:16", "Genesis 1:1-3"). Usa el nombre del libro tal como aparece en la Biblia Reina-Valera Antigua.
NUNCA inventes el texto del versiculo; solo devuelves la referencia. El texto lo pone el sistema.
NUNCA inventes una referencia que no aparezca en el audio. Si dudas, deja "reference" vacia.
NUNCA pegues bloques largos del audio en "answer"; resume con tus palabras en pocas frases.
Tono: cercano, respetuoso, en espanol. Responde SOLO con el objeto JSON, sin texto adicional.`;

/** Cuando la pregunta coincide con el titulo de una serie: resumen del audio. */
const SYSTEM_TEACHING = `Eres Grace, guia calida de la Escuela Biblica de Palabra Pura.
La persona pregunto por el titulo (o tema) de una ensenanza concreta. Tienes la transcripcion de ESE audio.
${GRACE_LENS}

Tu unica tarea: dar un RESUMEN intuitivo de lo que el pastor enseno en esa ensenanza.
Reglas estrictas:
- Resume SOLO con lo que dice la transcripcion. No inventes, no completes con conocimiento general.
- NO des una definicion de diccionario distinta a lo que se enseño en el audio.
- Explica con claridad, en 3 a 6 frases, que ensena esa parte y para que sirve segun el pastor.
- Si en el audio hay ejemplos o pasos concretos, mencionalos de forma breve.
- Si la transcripcion no alcanza, responde EXACTAMENTE con: {"found": false}
- Si SI puedes resumir, responde con:
{"found": true, "answer": "tu resumen en 3 a 6 frases", "reference": "referencia biblica si se menciona en el audio, o cadena vacia"}
Responde SOLO con el objeto JSON, sin texto adicional.`;

const SYSTEM_TITLE = `Eres Grace, guia calida de la Escuela Biblica de Palabra Pura.
SOLO tienes el TITULO de videos del ministerio (aun no hay transcripcion indexada de ese audio).
${GRACE_LENS}

Reglas estrictas:
- NO inventes lo que enseno el pastor; solo puedes decir que existe una serie con ese titulo.
- NO des una definicion inventada del tema.
- Menciona el nombre de la serie segun el titulo y acompaña a la persona a escuchar el video.
- Responde en 2 a 4 frases, calido y claro, bajo la dispensacion de la gracia.
Responde con:
{"found": true, "answer": "tu respuesta", "reference": ""}
Responde SOLO con el objeto JSON, sin texto adicional.`;

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

const SYSTEM_GRACE = `Eres Grace, guia calida de la Escuela Biblica de Palabra Pura.
Responde la pregunta del usuario UNICAMENTE bajo la dispensacion de la gracia.
${GRACE_LENS}

Reglas de respuesta:
- PROHIBIDO: decir "es pecado/adulterio" como conclusion legal tomada de Mateo 19, Marcos 10, Moises o la ley.
- PROHIBIDO: responder como fariseo o bajo ministerio de condenacion de la ley.
- OBLIGATORIO: explicar desde gracia — no condenacion, justicia por fe, identidad en Cristo, perdon, lo que la gracia provee.
- Usa las transcripciones del ministerio (si hay) y los pasajes biblicos de gracia entregados.
- Si la pregunta es sobre divorcio o volver a casarse: acompaña en gracia; explica que no vivimos bajo la ley sino bajo gracia; NO des veredicto legalista.
Responde en 3 a 5 frases, claro y pastoral.
Responde con:
{"found": true, "answer": "tu explicacion bajo gracia", "reference": "referencia biblica de gracia si aplica, o cadena vacia"}
Responde found:false SOLO si no hay ningun material util.
Responde SOLO con el objeto JSON, sin texto adicional.`;

const SYSTEM_BIBLE = `Eres Grace, guia calida de la Escuela Biblica de Palabra Pura.
Responde la pregunta del usuario con base en los pasajes biblicos que se te entregan (Reina-Valera Antigua).
${GRACE_LENS}
Responde de forma clara, intuitiva y directa, en 3 a 5 frases bajo la dispensacion de la gracia. No uses frases vacias.
Si los pasajes hablan del tema aunque sea en parte, explica lo que dicen con humildad desde gracia, no desde ley.
Responde found:false SOLO si ningun pasaje tiene relacion con la pregunta.
Si puedes responder, responde con:
{"found": true, "answer": "tu explicacion bajo gracia", "reference": "referencia principal Libro Capitulo:Versiculo"}
NUNCA inventes texto biblico; solo explicas con base en lo entregado.
Responde SOLO con el objeto JSON, sin texto adicional.`;

/** Preguntas eticas donde la ley suele confundir: priorizar gracia. */
function prefersGraceContext(question) {
  return /divorc|repud|adulter|matrimon|cas(a|o|ar|arse|arme)|pecad|fornic|conden/i.test(
    String(question),
  );
}

/** Pide al modelo que explique un fragmento de transcripcion para la pregunta. */
export async function explainFromTranscript(question, transcript, videoTitle = "") {
  if (!transcript?.trim()) return null;

  const title = videoTitle ? ` del video "${videoTitle}"` : "";
  const reply = await askAnyLLM(
    SYSTEM,
    `Transcripcion de audio${title}:\n${String(transcript).slice(0, 1800)}\n\nPregunta del usuario: ${question}`,
  );

  if (!reply || reply.off_topic || reply.found === false || !reply.answer) return null;
  return reply;
}

/**
 * Busca las enseñanzas por texto y pide al modelo que las explique.
 *
 * Prioridad: fragmentos de transcripción (minuto exacto + citas del audio).
 * Si no hay fragmentos, cae a coincidencia por título de serie.
 */
export async function answerWithSearch(db, question, resolvePassage) {
  const fragments = await contextFragments(db, question, 3);
  if (fragments.length) {
    const context = fragments
      .map(
        (f, i) =>
          `Fragmento ${i + 1} — video "${f.title}", episodio ${f.episode ?? "?"}:\n${String(
            f.content,
          ).slice(0, 1400)}`,
      )
      .join("\n\n");

    const reply = await askAnyLLM(
      SYSTEM,
      `Contexto de los videos:\n${context}\n\nPregunta: ${question}`,
    );
    if (!reply) return null;
    if (reply.off_topic) return { notFound: "off_topic", off_topic: true };
    if (reply.found === false || !reply.answer) return { notFound: true };

    const top = fragments[0];
    const citeText =
      (await citationTextForVideo(db, top.video_id, 80)) ||
      fragments.map((f) => f.content).join("\n");
    const spokenRefs = findReferences(citeText).map((r) => r.toLowerCase());
    const modelRef = reply.reference?.trim() || "";
    const modelOk =
      modelRef &&
      spokenRefs.some(
        (r) =>
          r.includes(modelRef.toLowerCase()) ||
          modelRef.toLowerCase().includes(r.replace(/\s+/g, " ").slice(0, 12)),
      );

    return {
      answer: reply.answer,
      passage: modelOk ? (await resolvePassage(modelRef)) ?? undefined : undefined,
      excerpt: trimRelevantExcerpt(top.content, question, 320),
      transcript: citeText.slice(0, 12000),
      video: {
        title: top.title,
        episode: top.episode,
        youtube_id: top.youtube_id,
        start_second: top.start_second ?? 0,
      },
      source: "video",
    };
  }

  const titled = await searchVideosByTitle(db, question, 5);
  if (titled.length) {
    const videoIds = titled.map((v) => v.id);
    const fromTitle = await fragmentsForVideos(db, videoIds, 40);

    if (fromTitle.length) {
      // Mejor fragmento por palabras de la pregunta, no el minuto 0.
      const terms = String(question)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .split(/\s+/)
        .filter((w) => w.length >= 4);
      let topVideo = fromTitle[0];
      let bestHits = -1;
      for (const f of fromTitle) {
        const norm = String(f.content)
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
        const hits = terms.reduce((n, t) => n + (norm.includes(t) ? 1 : 0), 0);
        if (hits > bestHits) {
          bestHits = hits;
          topVideo = f;
        }
      }

      const context = fromTitle
        .slice(0, 8)
        .map(
          (f, i) =>
            `Fragmento ${i + 1} — "${f.title}" (min ${Math.floor((f.start_second ?? 0) / 60)}):\n${String(
              f.content,
            ).slice(0, 1200)}`,
        )
        .join("\n\n");

      const reply = await askAnyLLM(
        SYSTEM_TEACHING,
        `Enseñanza coincidente por título:\n${context}\n\nPregunta del usuario: ${question}`,
      );

      if (reply?.found !== false && reply?.answer) {
        const citeText =
          (await citationTextForVideo(db, topVideo.video_id || videoIds[0], 80)) ||
          fromTitle.map((f) => f.content).join("\n");
        return {
          answer: reply.answer,
          passage: undefined,
          excerpt: trimRelevantExcerpt(topVideo.content, question, 320),
          transcript: citeText.slice(0, 12000),
          video: {
            title: topVideo.title,
            episode: topVideo.episode,
            youtube_id: topVideo.youtube_id,
            start_second: topVideo.start_second ?? 0,
          },
          source: "video",
        };
      }
    }

    const context = titled
      .map(
        (v, i) =>
          `Video ${i + 1} — titulo: "${v.title}", episodio ${v.episode ?? "?"}`,
      )
      .join("\n");

    const reply = await askAnyLLM(
      SYSTEM_TITLE,
      `Series disponibles en la biblioteca del ministerio:\n${context}\n\nPregunta: ${question}`,
    );

    const top = titled[0];
    const fallback = await answerByTitleSearch(db, question);

    if (!reply || reply.found === false || !reply.answer) {
      return fallback ?? { notFound: true };
    }

    return {
      answer: reply.answer,
      video: {
        title: top.title,
        episode: top.episode,
        youtube_id: top.youtube_id,
        start_second: 0,
      },
      source: "video",
      matchedByTitle: true,
    };
  }

  return { notFound: true };
}

/**
 * Respaldo bajo gracia: enseñanza del ministerio sobre gracia + pasajes de gracia.
 * Evita pasajes de divorcio/adulterio que llevan a respuestas legalistas.
 */
export async function answerFromBible(db, question, resolvePassage) {
  if (!db || !hasWriter()) return null;

  const useGrace = prefersGraceContext(question);
  const ministry = useGrace ? await ministryGraceFragments(db, 3) : [];
  const verses = useGrace
    ? await graceBibleVerses(db, 5)
    : await bibleVersesForQuestion(db, question, 5);

  if (!ministry.length && !verses.length) return null;

  const parts = [];
  if (ministry.length) {
    parts.push(
      "Enseñanzas del ministerio sobre gracia y dispensacion:\n" +
        ministry
          .map(
            (f, i) =>
              `Fragmento ${i + 1} — "${f.title}":\n${String(f.content).slice(0, 900)}`,
          )
          .join("\n\n"),
    );
  }
  if (verses.length) {
    parts.push(
      "Pasajes biblicos (gracia / justicia / no condenacion):\n" +
        verses
          .slice(0, 4)
          .map((v) => `${v.book} ${v.chapter}:${v.verse} — ${v.text}`)
          .join("\n"),
    );
  }

  const system = useGrace ? SYSTEM_GRACE : SYSTEM_BIBLE;
  const reply = await askAnyLLM(
    system,
    `${parts.join("\n\n")}\n\nPregunta del usuario: ${question}`,
  );
  if (!reply || reply.found === false || !reply.answer) return null;

  const passages = [];
  for (const row of verses.slice(0, 3)) {
    const resolved = await resolvePassage(`${row.book} ${row.chapter}:${row.verse}`);
    if (resolved) passages.push(resolved);
  }

  const primary =
    (await resolvePassage(reply.reference)) ?? passages[0] ?? undefined;

  const topMinistry = ministry[0];
  const result = {
    answer: reply.answer,
    passage: primary,
    passages: passages.length ? passages : primary ? [primary] : undefined,
    source: "biblia",
  };

  if (topMinistry) {
    result.video = {
      title: topMinistry.title,
      episode: topMinistry.episode,
      youtube_id: topMinistry.youtube_id,
      start_second: topMinistry.start_second ?? 0,
    };
    result.source = "video";
  }

  return result;
}
