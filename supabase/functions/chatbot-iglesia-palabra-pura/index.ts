import { createClient } from "jsr:@supabase/supabase-js@2";
// ---- Configuracion ----
const GEMINI_API_KEYS = [
  Deno.env.get("GEMINI_API_KEY"),
  Deno.env.get("GEMINI_API_KEY_2"),
  Deno.env.get("GEMINI_API_KEY_3"),
  ...(String(Deno.env.get("GEMINI_API_KEYS") || "").split(",")),
].map((k) => String(k || "").trim()).filter(Boolean);

const LLM_MODELS = [
  Deno.env.get("GEMINI_CHAT_MODEL") || "gemini-3.6-flash",
  "gemini-3-flash-preview",
];

// Cuantos capitulos-padre completos enviar como contexto (control de tokens).
const MAX_PARENTS = 2;
const MIN_SIMILARITY = 0.65;
const VECTOR_CANDIDATES = 20;
const SEED_LIMIT = 6;
const CONTEXT_MAX = 14;
const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
// ---- Prompts ----
// Primera etapa: SOLO videos. El LLM decide si puede responder o no.
const SYSTEM_VIDEO = `Eres Blaze, guia calida de la Iglesia Palabra Pura que acompana a personas que empiezan en la fe.
Responde UNICAMENTE con base en las transcripciones de video que se te entregan.
Tono: amable, cercano y claro. PROHIBIDO usar "humilde", "humildad", "humildemente" o "con humildad te digo".
Si hay conversacion reciente, interpreta seguimientos y pronombres (eso, y eso, por que, explicalo) con ese hilo. No ignores la pregunta actual.
Si el audio solo menciona palabras parecidas por casualidad pero NO ensena sobre lo preguntado, responde EXACTAMENTE con: {"found": false}
Si solo hay una MENCION BREVE del tema sin ensenanza sustancial que responda la pregunta, responde EXACTAMENTE con: {"found": false}
Mencionar palabras clave NO basta.
Si las transcripciones NO contienen lo necesario para responder la pregunta, responde EXACTAMENTE con: {"found": false}
Si SI puedes responder con base en los videos, responde con:
{"found": true, "answer": "tu respuesta en 4 a 8 frases, con el contexto de la ensenanza para que se entienda el punto (por que lo dice, a que se refiere, que concluye). No resumas de mas ni inventes", "reference": "referencia biblica si en el contexto se menciona un pasaje, o cadena vacia", "evidence": {"fragment": 1, "start_sentence": 1, "end_sentence": 3}}
Para "reference" usa el formato exacto "Libro Capitulo:Versiculo" o "Libro Capitulo:Versiculo-Versiculo" (ejemplos: "Juan 3:16", "Genesis 1:1-3"). Usa el nombre del libro tal como aparece en la Biblia Reina-Valera Antigua.
NUNCA inventes el texto del versiculo; solo devuelves la referencia. El texto lo pone el sistema.
En "evidence", elige un rango continuo de oraciones numeradas que sustente la respuesta.
Responde SOLO con el objeto JSON, sin texto adicional.`;

const SYSTEM_PAID = `Eres Blaze, guia calida de la Iglesia Palabra Pura que acompana a personas que empiezan en la fe.
Responde UNICAMENTE con base en las transcripciones que se te entregan.
Tono: amable, cercano y claro. PROHIBIDO usar "humilde", "humildad", "humildemente" o "con humildad te digo".
Esta ensenanza es de pago: da una respuesta breve y util (3 a 5 frases) que conteste la pregunta. No copies la ensenanza completa, no enumeres todos los puntos y no transcribas el audio.
No menciones compra, tienda ni enlaces; el sistema anade esa invitacion.
Si el contexto NO habla de lo preguntado, responde EXACTAMENTE con: {"found": false}
Si SI puedes orientar con lo que hay, responde con:
{"found": true, "answer": "respuesta breve de 3 a 5 frases", "reference": "referencia biblica si aparece en el contexto, o cadena vacia", "evidence": {"fragment": 1, "start_sentence": 1, "end_sentence": 2}}
Responde SOLO con el objeto JSON, sin texto adicional.`;
// Segunda etapa: contexto biblico ampliado (capitulo completo via parent-child).
const SYSTEM_BIBLE = `Eres Blaze, guia calida de la Iglesia Palabra Pura que acompana a personas que empiezan en la fe.
Responde con base en el pasaje biblico (contexto ampliado) que se te entrega. Si el contexto no contiene la respuesta, dilo con claridad y no inventes nada.
Tono: amable, cercano y claro, en 4 a 8 frases, con el contexto necesario para entender el punto. PROHIBIDO usar "humilde", "humildad", "humildemente" o "con humildad te digo".
Si hay conversacion reciente, interpreta seguimientos y pronombres con ese hilo. No ignores la pregunta actual.
Si citas un pasaje, indica su referencia en formato exacto "Libro Capitulo:Versiculo" o "Libro Capitulo:Versiculo-Versiculo" (ej: "Juan 3:16", "Genesis 1:1-3"), con el nombre del libro tal como aparece en la Reina-Valera Antigua.
NUNCA inventes el texto del versiculo; solo devuelves la referencia. El texto lo pone el sistema.
Responde SOLO con este objeto JSON: {"answer": "tu respuesta", "reference": "Libro C:V o cadena vacia"}`;
// ---- Helpers ----
// Normaliza para comparar nombres de libros (minusculas, sin acentos).
const norm = (s)=>s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const clean = (s)=>String(s ?? "").replace(/\s+/g, " ").trim();
/** Quita la palabra/frases de "humildad" literales; deja el tono amable. */
function sanitizeAnswer(answer) {
  let text = String(answer ?? "");
  if (!text) return text;
  text = text
    .replace(/\bcon\s+mucho\s+amor\s+y\s+(mucha\s+)?humildad\s+(te\s+)?(digo|comparto)[,:]?\s*/gi, "")
    .replace(/\bcon\s+(mucha\s+)?humildad\s+(te\s+)?(digo|comparto|digo\s+que)[,:]?\s*/gi, "")
    .replace(/\b(te\s+)?(digo|comparto)\s+con\s+(mucha\s+)?humildad[,:]?\s*/gi, "")
    .replace(/\bhumildemente[,:]?\s*/gi, "")
    .replace(/\by\s+humildad\b/gi, "")
    .replace(/\bcon\s+(mucha\s+)?humildad\b/gi, "")
    .replace(/\bhumildad\b/gi, "")
    .replace(/\bhumilde(s)?\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,:\s]+/, "")
    .trim();
  return text;
}

const MAX_HISTORY_TURNS = 12;
function normalizeHistory(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  const out: { role: string; content: string }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: string }).role === "assistant" || (item as { role?: string }).role === "bot"
      ? "assistant"
      : (item as { role?: string }).role === "user"
        ? "user"
        : null;
    const content = String((item as { content?: string; text?: string }).content ?? (item as { text?: string }).text ?? "").trim();
    if (!role || content.length < 1) continue;
    out.push({ role, content: content.slice(0, 600) });
    if (out.length >= MAX_HISTORY_TURNS) break;
  }
  return out;
}
function isStandaloneAsk(question: string) {
  const q = norm(question);
  return /^(que|quien|cual|como|cuando|donde|por que)\s+\S{3,}/.test(q)
    || /^(explica|hablame|cuentame|dime|define)\b/.test(q);
}

function looksLikeFollowUp(question: string) {
  const q = String(question ?? "").trim();
  if (!q) return false;
  if (isStandaloneAsk(q)) return false;
  if (q.length <= 32) return true;
  return /^(y |entonces |pero |ok |vale |si |sí |no |tambien|también|por que|por qué|y que|y qué)/i.test(q)
    || /\b(eso|esa|ese|eso mismo|aquello|lo anterior|dijiste|mencionaste|antes|seguimiento)\b/i.test(q);
}
function retrievalQuestion(question: string, history: { role: string; content: string }[]) {
  const q = String(question ?? "").trim();
  if (!q || !history.length) return q;
  // Pregunta nueva (aunque sea corta): no mezclar matrimonio/tienda con "nacer de nuevo".
  if (!looksLikeFollowUp(q)) return q;
  const lastUser = [...history].reverse().find((turn) => turn.role === "user");
  const lastBot = [...history].reverse().find((turn) => turn.role === "assistant");
  const parts: string[] = [];
  if (lastUser?.content && lastUser.content.toLowerCase() !== q.toLowerCase()) parts.push(lastUser.content);
  if (lastBot?.content) parts.push(lastBot.content.slice(0, 220));
  parts.push(q);
  return parts.join("\n");
}
function historyBlock(history: { role: string; content: string }[]) {
  const hist = history.slice(-8);
  if (!hist.length) return "";
  const lines = hist.map((turn) => `${turn.role === "user" ? "Usuario" : "Blaze"}: ${turn.content}`);
  return `Conversacion reciente (usa este hilo para entender seguimientos; responde con el audio/Biblia de esta vuelta):\n${lines.join("\n")}\n\n`;
}

const LIFE_AREAS = [
  { id: "fe", label: "Fe y confianza", keywords: ["fe", "confiar", "confianza", "creer", "temor", "miedo", "ansiedad", "angustia"], promise: "Dios te ha dado una fe que no depende de tus fuerzas, sino de Cristo en ti. Puedes descansar en Él aun cuando no entiendas todo.", verses: ["Romanos 4:5", "Filipenses 4:19", "Isaías 41:10"] },
  { id: "oracion", label: "Oración", keywords: ["orar", "oracion", "reza", "rezo", "clamar", "interceder"], promise: "Puedes acercarte a Dios con libertad, no por mérito propio sino por la gracia. Él escucha al que clama en el nombre de Jesús.", verses: ["Filipenses 4:6-7", "1 Juan 5:14", "Mateo 7:7"] },
  { id: "sanidad", label: "Sanidad", keywords: ["sanidad", "sanar", "sano", "enfermedad", "milagro", "sintoma", "cura", "dolor"], promise: "El Señor es tu sanador. En Cristo hay vida, restauración y cuidado para cuerpo y alma según su voluntad bondadosa.", verses: ["Isaías 53:5", "Salmo 103:3", "Santiago 5:15"] },
  { id: "palabra", label: "La Palabra", keywords: ["palabra", "biblia", "escritura", "versiculo", "leer", "estudiar"], promise: "La Palabra de Dios es viva y te edifica. Bajo la gracia, la Escritura te forma y te confirma en la verdad de Cristo.", verses: ["2 Timoteo 3:16-17", "Romanos 15:4", "Salmo 119:105"] },
  { id: "salvacion", label: "Salvación y nuevo nacimiento", keywords: ["nacer de nuevo", "nuevo nacimiento", "nacer", "salvacion", "salvo", "evangelio", "cruz", "convertir"], promise: "La salvación es un regalo por gracia, recibido por fe, no por obras. En Cristo eres hijo de Dios y tienes vida eterna.", verses: ["Efesios 2:8-9", "Juan 3:16", "Romanos 10:9"] },
  { id: "dones", label: "Dones espirituales", keywords: ["dones", "espiritu", "carisma", "ministerio", "servir", "llamado"], promise: "Dios te ha equipado con dones para edificar a otros en amor. Cada miembro del cuerpo de Cristo tiene un lugar.", verses: ["1 Corintios 12:7", "Romanos 12:6", "Efesios 4:7"] },
  { id: "familia", label: "Familia y matrimonio", keywords: ["familia", "matrimonio", "esposo", "esposa", "hijos", "pareja", "hogar"], promise: "En Cristo hay gracia para el hogar: amor, perdón y restauración. El Señor camina contigo en las relaciones más cercanas.", verses: ["Efesios 5:25", "Colosenses 3:13", "Proverbios 3:5-6"] },
  { id: "restauracion", label: "Restauración y testimonio", keywords: ["testimonio", "restaurar", "restauracion", "perdon", "victoria", "libertad"], promise: "En Cristo hay nueva creación: lo viejo pasó. Dios puede restaurar lo que parecía perdido y usar tu historia para Su gloria.", verses: ["2 Corintios 5:17", "Joel 2:25", "Romanos 8:1"] },
  { id: "finanzas", label: "Finanzas y provisión", keywords: ["dinero", "finanza", "financiero", "mapa financiero", "deuda", "prosper", "provision", "ofrenda"], promise: "Dios suple tus necesidades según sus riquezas en gloria. Él es tu proveedor y te enseña a administrar con sabiduría.", verses: ["Filipenses 4:19", "Mateo 6:33", "2 Corintios 9:8"] },
  { id: "paz", label: "Paz y ánimo", keywords: ["paz", "animo", "triste", "deprim", "solo", "desanim", "consuelo"], promise: "La paz de Cristo guarda tu corazón más allá de las circunstancias. Él no te deja solo en momentos difíciles.", verses: ["Juan 14:27", "Isaías 26:3", "Romanos 15:13"] },
  { id: "proposito", label: "Trabajo y propósito", keywords: ["trabajo", "empleo", "proposito", "vocacion", "carrera", "negocio", "oficio"], promise: "Lo que hagas, hazlo de corazón como para el Señor. Él tiene un propósito para tu vida y te guía paso a paso.", verses: ["Colosenses 3:23", "Jeremías 29:11", "Proverbios 16:3"] },
  { id: "perdon", label: "Perdón y culpa", keywords: ["perdon", "culpa", "pecado", "condenacion", "verguenza", "arrepent"], promise: "En Cristo tienes perdón pleno y completo. No hay condenación para los que están en Jesús; la gracia te cubre.", verses: ["Efesios 1:7", "1 Juan 1:9", "Colosenses 2:13"] },
];
function detectLifeArea(question: string) {
  const text = norm(question);
  if (!text) return null;
  const tokens = new Set(text.split(/\s+/).filter((t) => t.length > 2));
  let best: (typeof LIFE_AREAS)[number] | null = null;
  let bestScore = 0;
  for (const area of LIFE_AREAS) {
    let score = 0;
    for (const kw of area.keywords) {
      const k = norm(kw);
      if (text.includes(k)) score += 3;
      if (tokens.has(k)) score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = area;
    }
  }
  return bestScore > 0 ? best : null;
}
async function attachLifeContext(payload: Record<string, unknown>, question: string) {
  const area = detectLifeArea(question);
  if (!area) return payload;
  payload.lifeArea = { id: area.id, label: area.label, promise: area.promise };
  if (payload.passage || (Array.isArray(payload.passages) && payload.passages.length)) return payload;
  const passages = [];
  for (const ref of area.verses) {
    const resolved = await resolvePassage(ref);
    if (resolved) passages.push({ ...resolved, bible_version: "Reina-Valera Antigua" });
  }
  if (passages.length) {
    payload.passage = passages[0];
    payload.passages = passages;
  }
  return payload;
}

function factScore(question: string, fact: { title?: string; aliases?: string[]; category?: string }) {
  const normQ = norm(question);
  if (fact.category === "horario" && !/\b(hora|horario|horarios|cuando|domingo|miercoles|servicio|servicios)\b/.test(normQ)) {
    return 0;
  }
  const aliases = [norm(fact.title || ""), ...(fact.aliases || []).map(norm)].filter((a) => a.length >= 2);
  let best = 0;
  for (const alias of aliases) {
    if (normQ === alias) best = Math.max(best, 100 + alias.length);
    else if (normQ.includes(alias) && alias.length >= 4) best = Math.max(best, 60 + Math.min(alias.length, 40));
    else if (alias.includes(normQ) && normQ.length >= 6) best = Math.max(best, 45);
    else {
      const words = alias.split(" ").filter((w) => w.length > 2);
      if (words.length >= 2 && words.every((w) => normQ.includes(w))) best = Math.max(best, 40 + words.length * 5);
    }
  }
  return best;
}

async function findMinistryFact(question: string) {
  const { data, error } = await supabase
    .from("ministry_fact")
    .select("id,category,title,content,aliases")
    .eq("status", "active")
    .limit(400);
  if (error || !data?.length) return null;
  let best = null;
  let score = 0;
  for (const row of data) {
    const s = factScore(question, row);
    if (s > score) {
      score = s;
      best = row;
    }
  }
  if (!best || score < 45) return null;
  return {
    answer: best.content,
    source: "dato",
    fromKnowledge: true,
    factCategory: best.category,
    factTitle: best.title,
    knowledgeId: `fact-${best.id}`,
  };
}

async function findKnowledgeDocs(embStr: string) {
  const { data, error } = await supabase.rpc("match_knowledge_chunks", {
    query_embedding: embStr,
    match_count: 4,
  });
  if (error || !data?.length) return [];
  return data.filter((row: { similarity?: number; category?: string }) =>
    Number(row.similarity) >= 0.62 && String(row.category || "") !== "tienda",
  );
}

const SHOP_RECOMMEND_RE =
  /recomend|recomien|suger[ií]|aconsej|alguna ense[nñ]anza|alguna serie|qu[eé] ense[nñ]anzas|qu[eé] series|ense[nñ]anzas (de |sobre |para )|series (de |sobre )|una ense[nñ]anza (de |sobre |para )|ense[nñ]anza me |para (comprar|adquirir)|de la tienda|qu[eé] (puedo|deber[ií]a) (ver|escuchar|estudiar)|busco (una )?ense[nñ]anza|quiero (una )?ense[nñ]anza/i;

const SHOP_TOPICS: { key: string; labels: string[]; words: RegExp }[] = [
  { key: "fe", labels: ["fe"], words: /\bfe\b|creer|confianza/i },
  { key: "matrimonio", labels: ["matrimonio", "relaciones", "familia"], words: /matrimonio|pareja|espos|relaciones|familia|hijas|hijos/i },
  { key: "finanzas", labels: ["finanzas", "diezmo", "prosperidad"], words: /finanz|diezmo|dinero|prosper|ricos|provisi[oó]n/i },
  { key: "ultimos", labels: ["últimos tiempos", "globalismo"], words: /[uú]ltimos tiempos|globalismo|rapto|dispensaci[oó]n|herodes|jerusalem|israel/i },
  { key: "obediencia", labels: ["obediencia"], words: /obedienc|sumisi[oó]n|verdad/i },
  { key: "perdon", labels: ["perdón", "relaciones"], words: /perd[oó]n|ofensa|rencor/i },
  { key: "sanidad", labels: ["sanidad"], words: /sanidad|sanar|enfermedad/i },
  { key: "mente", labels: ["metamorfosis", "imaginación"], words: /mente|metamorfosis|pensamiento|imaginaci[oó]n|renovaci[oó]n/i },
  { key: "espiritu", labels: ["espíritu santo"], words: /esp[ií]ritu santo|ungimiento|dones/i },
];

function parseShopDoc(row: { title?: string; content?: string }) {
  const content = String(row.content || "");
  const field = (name: string) => {
    const m = content.match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
    return m ? m[1].trim() : "";
  };
  const descLines: string[] = [];
  let pastHeaders = false;
  for (const line of content.split("\n")) {
    if (!pastHeaders && /^[A-ZÁÉÍÓÚÜÑ_]+:/.test(line)) continue;
    pastHeaders = true;
    if (line.trim()) descLines.push(line.trim());
  }
  const desc = descLines.join(" ").replace(/\s+/g, " ").trim();
  return {
    title: String(row.title || "").trim(),
    kind: field("TIPO") || "audio",
    topics: field("TEMAS"),
    author: field("AUTOR"),
    price: Number(field("PRECIO") || 0),
    featured: /^si$/i.test(field("DESTACADA")),
    cart: field("CARRITO"),
    product: field("PRODUCTO"),
    description: desc,
  };
}

function shopBaseTitle(title: string) {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(?(serie[- ]?)?(video|audio)\)?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreShopItem(question: string, item: ReturnType<typeof parseShopDoc>) {
  const q = question.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const blob = `${item.title} ${item.topics} ${item.author} ${item.description}`.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let score = 0;
  const tokens = q.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  for (const w of tokens) {
    if (blob.includes(w)) score += w.length >= 8 ? 6 : 3;
  }
  for (const topic of SHOP_TOPICS) {
    if (topic.words.test(question) && topic.labels.some((l) => blob.includes(l.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()))) {
      score += 10;
      if (topic.labels.some((l) => item.title.toLowerCase().includes(l.toLowerCase()))) score += 8;
    }
  }
  if (item.featured) score += 4;
  if (item.kind === "video") score += 1;
  if (/serie/i.test(item.title)) score += 2;
  return score;
}

function shopOffer(item: ReturnType<typeof parseShopDoc>) {
  return {
    title: item.title,
    url: item.cart || item.product || "",
    label: "Ver esta",
    hint: item.description.slice(0, 180),
    kind: "tienda",
  };
}

async function recommendShopTeachings(question: string, searchQ: string, embStr: string) {
  const { data } = await supabase
    .from("knowledge_document")
    .select("id,title,content,source_name")
    .eq("status", "active")
    .eq("category", "tienda")
    .limit(400);
  const items = (data || []).map(parseShopDoc).filter((item) => item.title && item.cart);
  const topicAsked = SHOP_TOPICS.some((t) => t.words.test(question));
  let ranked = items
    .map((item) => ({ item, score: scoreShopItem(question, item) }))
    .sort((a, b) => b.score - a.score);
  if (!topicAsked) {
    ranked = ranked.filter((row) => row.item.featured || row.score >= 6);
  } else {
    ranked = ranked.filter((row) => row.score >= 6);
  }
  if (!ranked.length) {
    const { data: hits } = await supabase.rpc("match_knowledge_chunks", {
      query_embedding: embStr,
      match_count: 10,
    });
    const shopHits = (hits || []).filter((row: { category?: string; similarity?: number }) =>
      row.category === "tienda" && Number(row.similarity) >= 0.55,
    );
    const byTitle = new Map(items.map((item) => [item.title, item]));
    ranked = shopHits
      .map((row: { title?: string; similarity?: number }) => {
        const item = byTitle.get(String(row.title || ""));
        return item ? { item, score: Number(row.similarity) * 20 } : null;
      })
      .filter(Boolean) as { item: ReturnType<typeof parseShopDoc>; score: number }[];
  }
  if (!ranked.length) {
    ranked = items.filter((item) => item.featured).map((item) => ({ item, score: 8 }));
  }
  const picked: ReturnType<typeof parseShopDoc>[] = [];
  const seen = new Map<string, number>();
  for (const row of ranked) {
    const key = shopBaseTitle(row.item.title);
    const prev = seen.get(key);
    if (prev != null) {
      if (row.item.kind === "video" && picked[prev].kind !== "video") picked[prev] = row.item;
      continue;
    }
    if (/metamorfosis/i.test(row.item.title) && !shopAllowsMetamorfosis(question)) continue;
    seen.set(key, picked.length);
    picked.push(row.item);
    if (picked.length >= 4) break;
  }
  if (!picked.length) return null;
  const offers = picked.map(shopOffer);
  const lines = picked.map((item, i) => {
    const why = item.description
      ? item.description.slice(0, 160)
      : `Enseñanza de la iglesia${item.author ? `, de ${item.author}` : ""}.`;
    return `${i + 1}. «${item.title}» — ${why}`;
  });
  const topic = SHOP_TOPICS.find((t) => t.words.test(question));
  const intro = topic
    ? `Estas enseñanzas de la iglesia encajan con lo que preguntas:`
    : `Estas son algunas enseñanzas de la iglesia que te pueden servir para profundizar:`;
  return attachLifeContext({
    answer: `${intro}\n\n${lines.join("\n\n")}\n\nPuedes ver solo una, o abrirlas todas juntas en el carrito.`,
    source: "oferta",
    offer: offers[0],
    offers,
  }, searchQ);
}

async function paidOfferFor(youtubeId?: string | null) {
  if (!youtubeId) return null;
  const { data } = await supabase
    .from("content_offer")
    .select("access_mode,offer_url,offer_label,title")
    .eq("youtube_id", youtubeId)
    .maybeSingle();
  if (data?.access_mode !== "paid") return null;
  return data;
}

function offerFields(
  video: { title?: string; youtube_id?: string; episode?: number },
  offer: { offer_url?: string | null; offer_label?: string | null; title?: string | null },
) {
  const title = offer.title || video.title || "esta enseñanza";
  const label = offer.offer_label || "Ver en el carrito";
  return {
    title,
    url: offer.offer_url || "",
    label,
    kind: "pago",
  };
}

function isPaidGateFact(fact: { factTitle?: string; answer?: string } | null) {
  if (!fact) return false;
  return /metamorfosis|ense[nñ]anza de pago/i.test(`${fact.factTitle || ""} ${fact.answer || ""}`);
}

function withPaidOffer(
  answer: string,
  video: { title?: string; youtube_id?: string; episode?: number },
  offer: { offer_url?: string | null; offer_label?: string | null; title?: string | null },
) {
  const fields = offerFields(video, offer);
  const link = fields.url ? ` ${fields.url}` : "";
  const body = sanitizeAnswer(answer) ||
    `Puedo orientarte en lo esencial. El desarrollo completo está en «${fields.title}».`;
  const cta = `Para más información, adquiere la enseñanza completa «${fields.title}» en la tienda de la iglesia.${link}`;
  return {
    answer: `${body}\n\n${cta}`,
    source: "oferta",
    offer: fields,
    video: {
      title: video.title,
      episode: video.episode,
      youtube_id: video.youtube_id,
      start_second: 0,
    },
  };
}

async function answerPaidTeaching(
  question: string,
  prior: string,
  searchQ: string,
  video: { title?: string; youtube_id?: string; episode?: number },
  offer: { offer_url?: string | null; offer_label?: string | null; title?: string | null },
  fragments: { title?: string; episode?: number; content?: string; youtube_id?: string }[],
) {
  let answer = "";
  if (fragments.length) {
    const vid = await askLLM(
      SYSTEM_PAID,
      `${prior}Contexto de la ensenanza (solo para una respuesta breve):\n${numberedFragments(fragments)}\n\nPregunta actual: ${question}`,
    );
    if (vid.found && vid.answer) answer = sanitizeAnswer(vid.answer ?? "");
  }
  return attachLifeContext(withPaidOffer(answer, video, offer), searchQ);
}

const SOFT_NOT_FOUND_RE =
  /todav[ií]a no encuentro|no encuentro material|no encontr[eé]|no se encuentra|no hall[oó]|no hayo|no se explica|no alcanza|no tengo material|preguntarlo de otra forma|no contiene lo necesario|no hay (una )?descripci[oó]n/i;

/** Opciones relacionadas a partir de fragmentos recuperados (para el desplegable). */
function relatedSuggestions(fragments, limit = 6) {
  if (!Array.isArray(fragments) || !fragments.length) return [];
  const out = [];
  const seen = new Set();
  for (const f of fragments) {
    if (out.length >= limit) break;
    const title = clean(f.title || "Enseñanza");
    const key = `${f.youtube_id || ""}|${f.start_second ?? 0}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const preview = clean(f.content).slice(0, 220);
    if (!preview) continue;
    out.push({
      id: `f-${f.id ?? out.length}`,
      label: title.length > 72 ? `${title.slice(0, 71)}…` : title,
      title,
      preview,
      ask: `cuéntame sobre ${title}`,
      excerpt: preview,
      video: {
        title,
        episode: f.episode,
        youtube_id: f.youtube_id,
        start_second: f.start_second ?? 0,
      },
      source: "video",
      answer: "Aquí tienes una enseñanza relacionada que puede interesarte:",
    });
  }
  return out;
}

function sentences(content) {
  const raw = clean(content);
  if (!raw) return [];
  const parts = raw.split(/(?<=[.!?…])\s+(?=[¿¡A-ZÁÉÍÓÚÜÑ0-9"'])/).map(clean).filter(Boolean);
  return parts.length ? parts : [
    raw
  ];
}

const SPONSOR_NEAR_SECONDS = 90;
const SPONSOR_MARK = /este programa (te )?llega|apoyo financiero de los miembros/i;

function excerptIsNearSponsorIntro(fragment, text) {
  const blob = String(text || fragment?.content || "");
  if (!SPONSOR_MARK.test(blob)) return false;
  if (!fragment) return true;
  const start = Number(fragment.start_second);
  const pos = Number(fragment.position);
  if (Number.isFinite(start) && start <= SPONSOR_NEAR_SECONDS) return true;
  if (Number.isFinite(pos) && pos <= 1) return true;
  return false;
}

function stripSponsorIntro(text) {
  const raw = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!raw || !SPONSOR_MARK.test(raw)) return raw;
  const startMatch = raw.match(/este programa (te )?llega a ti/i);
  if (!startMatch) {
    return raw.replace(/gracias al apoyo financiero de los miembros[^.]{0,280}\.?/i, " ").replace(/\s+/g, " ").trim();
  }
  const from = startMatch.index ?? 0;
  const after = raw.slice(from);
  const endMatch = after.match(/c[oó]digo qr(?:[\s\S]{0,480}?\bbendiciones\b)?|\bbendiciones\b/i);
  const end = endMatch ? from + endMatch.index + endMatch[0].length : from + Math.min(after.length, 480);
  return `${raw.slice(0, from)} ${raw.slice(end)}`.replace(/\s+/g, " ").trim();
}

function excerptWithoutSponsor(excerpt, fragment) {
  if (!excerptIsNearSponsorIntro(fragment, excerpt || fragment?.content)) return excerpt;
  const cleaned = stripSponsorIntro(excerpt);
  if (cleaned && cleaned.length >= 40) return cleaned;
  const rest = sentences(stripSponsorIntro(fragment?.content || "")).slice(0, 3).join(" ");
  return clean(rest) || cleaned || excerpt;
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
  excerpt = excerptWithoutSponsor(excerpt, fragment);
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

const TITLE_STOP = new Set([
  "que", "de", "la", "el", "los", "las", "un", "una", "del", "para", "por", "con",
  "como", "sobre", "serie", "habla", "ensena", "ensenanza", "ensenanzas", "parte",
  "video", "audio", "cual", "cuales", "hay", "esta", "este", "esto", "the", "dice", "dices",
]);

function titleTokens(s: string) {
  return norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !TITLE_STOP.has(w));
}

function titleTokenHit(qWord: string, titleWord: string) {
  if (qWord === titleWord) return true;
  // Evita que "amor"/"forma" disparen "Metamorfosis".
  if (qWord.length >= 8 && titleWord.length >= 8 && (titleWord.includes(qWord) || qWord.includes(titleWord))) {
    return true;
  }
  return false;
}

function namesPaidTeaching(question: string) {
  return /metamorfosis|audio\s*38|ense[nñ]anza\s*0*38|038\s*-?\s*audio/i.test(String(question || ""));
}

function shopAllowsMetamorfosis(question: string) {
  return /metamorfosis|renovar (la )?mente|renovaci[oó]n de la mente|pensamiento|imaginaci[oó]n/i.test(String(question || ""));
}

async function findVideosByTitle(question: string) {
  const qTokens = titleTokens(question);
  if (!qTokens.length) return [];
  if (qTokens.length < 2 && qTokens[0].length < 8) return [];
  const { data, error } = await supabase.from("video").select("id,title,youtube_id,episode").limit(400);
  if (error || !data?.length) return [];
  const qParte = question.match(/parte\s*0*(\d+)/i);
  const scored = [];
  for (const v of data) {
    const t = titleTokens(v.title || "");
    const matched = qTokens.filter((w) => t.some((x) => titleTokenHit(w, x)));
    const hits = matched.length;
    const distinctive = matched.some((w) => w.length >= 8);
    if (qTokens.length >= 2 && hits < 2 && !distinctive) continue;
    if (qTokens.length < 2 && hits < 1) continue;
    let score = hits;
    const tParte = String(v.title || "").match(/parte\s*0*(\d+)/i);
    if (qParte && tParte && qParte[1] === tParte[1]) score += 4;
    else if (qParte && tParte && qParte[1] !== tParte[1]) score -= 1;
    scored.push({ ...v, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const exactParte = qParte ? scored.filter((v) => String(v.title || "").match(/parte\s*0*(\d+)/i)?.[1] === qParte[1]) : [];
  return (exactParte.length ? exactParte : scored).slice(0, 3);
}

async function fragmentsFromVideos(videos: { id: number; title?: string; youtube_id?: string; episode?: number }[]) {
  if (!videos.length) return [];
  const ids = videos.map((v) => v.id);
  const { data, error } = await supabase
    .from("fragment")
    .select("id, position, content, start_second, word_count, video_id")
    .in("video_id", ids)
    .order("position", { ascending: true })
    .limit(24);
  if (error || !data?.length) return [];
  const byVideo = new Map(videos.map((v) => [Number(v.id), v]));
  return data.map((row) => {
    const video = byVideo.get(Number(row.video_id));
    return {
      ...row,
      title: video?.title,
      episode: video?.episode,
      youtube_id: video?.youtube_id,
      similarity: 0.99,
    };
  });
}

function mergeFragments(preferred, fallback, max = CONTEXT_MAX) {
  const out = [];
  const seen = new Set();
  for (const row of [...(preferred || []), ...(fallback || [])]) {
    const key = row?.id ?? `${row?.video_id}-${row?.position}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= max) break;
  }
  return out;
}

async function retrieveVideoFragments(embStr, question = "") {
  const { data: fragMatches, error: fragErr } = await supabase.rpc("match_fragments", {
    query_embedding: embStr,
    match_count: VECTOR_CANDIDATES,
  });
  if (fragErr) throw new Error("match_fragments: " + fragErr.message);
  const filtered = filterBySimilarity(fragMatches || []);
  const seeds = filtered.slice(0, SEED_LIMIT);
  const shortHit = seeds.some((s) => Number(s.word_count) > 0 && Number(s.word_count) < 160);
  const expanded = seeds.length ? await expandAdjacent(seeds, shortHit ? 3 : 2, CONTEXT_MAX) : [];
  const titled = (await findVideosByTitle(question)).filter((video) => {
    if (!/metamorfosis|audio38meta|local-metamorfosis/i.test(`${video.title} ${video.youtube_id}`)) return true;
    return namesPaidTeaching(question);
  });
  const fromTitle = titled.length ? await fragmentsFromVideos(titled) : [];
  if (fromTitle.length) return fromTitle.slice(0, CONTEXT_MAX);
  return expanded;
}

// Embebe la pregunta del usuario (rota keys si una falla).
async function embedQuery(question) {
  if (!GEMINI_API_KEYS.length) throw new Error("GEMINI_API_KEY missing");
  let lastErr = "unknown";
  for (const key of GEMINI_API_KEYS) {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key
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
    if (!res.ok) {
      lastErr = await res.text();
      console.error("Gemini embedding fail:", res.status, lastErr.slice(0, 200));
      continue;
    }
    const data = await res.json();
    return data.embedding.values;
  }
  throw new Error("Gemini embedding: " + lastErr);
}

// Llama al LLM (Gemini 3.x). thinkingBudget=0 evita que se coma los tokens.
async function askLLM(system, userContent) {
  if (!GEMINI_API_KEYS.length) throw new Error("GEMINI_API_KEY missing");
  let lastErr = "unknown";
  for (const model of LLM_MODELS) {
    for (const key of GEMINI_API_KEYS) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": key,
            },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: [{ role: "user", parts: [{ text: userContent }] }],
              generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 2048,
                responseMimeType: "application/json",
                thinkingConfig: { thinkingBudget: 0 },
              },
            }),
          },
        );
        if (!res.ok) {
          lastErr = await res.text();
          console.error("Gemini LLM fail:", model, res.status, lastErr.slice(0, 220));
          continue;
        }
        const data = await res.json();
        const content = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
        if (!content.trim()) {
          lastErr = "empty LLM content";
          continue;
        }
        try {
          return JSON.parse(content);
        } catch {
          return { answer: content };
        }
      } catch (e) {
        lastErr = String(e);
        console.error("Gemini LLM network:", model, lastErr);
      }
    }
  }
  throw new Error("Gemini LLM: " + lastErr);
}

// ---- Handler ----
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: cors
  });
  if (req.method === "GET") {
    return json({
      ok: true,
      service: "chatbot-iglesia-palabra-pura"
    });
  }
  try {
    const body = await req.json().catch(()=>({}));
    if (body?.action === "rate") {
      const id = String(body.interaction_id || body.id || "").trim();
      const vote = body.vote === "not_useful" ? "not_useful" : body.vote === "useful" ? "useful" : "";
      if (!id || !vote) {
        return json({ ok: false, error: "id and vote required" }, 400);
      }
      const questionText = String(body.question || "").trim().slice(0, 500) || null;
      const inserted = await supabase.from("chat_ratings").insert({
        interaction_id: id,
        vote,
        question: questionText,
      });
      if (inserted.error) {
        const updated = await supabase
          .from("chat_interactions")
          .update({ rating: vote, rated_at: new Date().toISOString() })
          .eq("id", id);
        if (updated.error) {
          return json({ ok: false, error: inserted.error.message }, 500);
        }
      }
      return json({ ok: true, id, vote });
    }
    const question = String(body?.question || body?.message || body?.q || "").trim();
    if (!question) {
      return json({
        answer: "Escribeme una pregunta y con gusto te acompano."
      });
    }
    const history = normalizeHistory(body?.history);
    const searchQ = retrievalQuestion(question, history);
    const prior = historyBlock(history);
    const embedding = await embedQuery(searchQ);
    const embStr = JSON.stringify(embedding); // halfvec como texto "[...]"
    const factHit = await findMinistryFact(question);
    if (factHit && !isPaidGateFact(factHit)) {
      return json(await attachLifeContext(factHit, searchQ));
    }
    if (SHOP_RECOMMEND_RE.test(question)) {
      const recs = await recommendShopTeachings(question, searchQ, embStr);
      if (recs) return json(recs);
    }
    const docs = await findKnowledgeDocs(embStr);
    // ========== 1) VIDEOS primero ==========
    const titledPaid = [];
    for (const video of await findVideosByTitle(question)) {
      const offer = await paidOfferFor(video.youtube_id);
      if (offer && namesPaidTeaching(question)) titledPaid.push({ video, offer });
    }
    if (titledPaid.length) {
      let paidFrags = await fragmentsFromVideos(titledPaid.map((row) => row.video));
      const usable = (paidFrags || []).some((f) =>
        String(f.content || "").length > 120 && !/adqui[eé]rela|ense[nñ]anza de pago/i.test(String(f.content || "")),
      );
      if (!usable) {
        const retrieved = await retrieveVideoFragments(embStr, question);
        const ids = new Set(titledPaid.map((row) => row.video.youtube_id));
        const fromIndex = (retrieved || []).filter((row) => ids.has(row.youtube_id));
        if (fromIndex.length) paidFrags = fromIndex;
      }
      return json(await answerPaidTeaching(
        question,
        prior,
        searchQ,
        titledPaid[0].video,
        titledPaid[0].offer,
        paidFrags,
      ));
    }
    const allFrags = await retrieveVideoFragments(embStr, question);
    const paidTop = allFrags[0] ? await paidOfferFor(allFrags[0].youtube_id) : null;
    if (paidTop && namesPaidTeaching(question)) {
      const paidFrags = (allFrags || []).filter((row) => row.youtube_id === allFrags[0].youtube_id);
      return json(await answerPaidTeaching(question, prior, searchQ, allFrags[0], paidTop, paidFrags));
    }
    const paidIds = new Set();
    for (const row of allFrags || []) {
      if (!row?.youtube_id || paidIds.has(row.youtube_id)) continue;
      if (await paidOfferFor(row.youtube_id)) paidIds.add(row.youtube_id);
    }
    const fragMatches = (allFrags || []).filter((row) => !paidIds.has(row.youtube_id));
    const tips = relatedSuggestions(fragMatches, 6);
    if (fragMatches && fragMatches.length > 0) {
      const context = numberedFragments(fragMatches);
      let vid = await askLLM(SYSTEM_VIDEO, `${prior}Contexto de los videos:\n${context}\n\nPregunta actual: ${question}`);
      if (!vid.found) {
        const titled = await findVideosByTitle(question);
        if (titled.length) {
          vid = await askLLM(
            SYSTEM_VIDEO,
            `${prior}Estos videos SON la serie o enseñanza que pregunta la persona. Resume lo que enseñan. No respondas found false.\n${context}\n\nPregunta actual: ${question}`,
          );
          if (vid.answer) vid.found = true;
        }
      }
      // Si el LLM pudo responder con los videos, terminamos aqui.
      if (vid.found) {
        const selected = literalExcerpt(fragMatches, vid.evidence);
        const top = selected.fragment;
        const passage = await resolvePassage(vid.reference);
        const payload = await attachLifeContext({
          answer: sanitizeAnswer(vid.answer ?? ""),
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
        }, searchQ);
        return json(payload);
      }
    }
    const paidDoc = docs.find((d: { category?: string }) => String(d.category || "") === "paid");
    if (paidDoc && namesPaidTeaching(question)) {
      const offer = await paidOfferFor("audio38meta") || await paidOfferFor("local-metamorfosis-d0ja5w");
      if (offer) {
        const titled = await findVideosByTitle(paidDoc.title || question);
        const video = titled[0] || { title: paidDoc.title };
        const paidFrags = titled.length ? await fragmentsFromVideos(titled) : [];
        return json(await answerPaidTeaching(question, prior, searchQ, video, offer, paidFrags));
      }
    }
    if (docs.length) {
      const freeDocs = docs.filter((d: { category?: string }) => String(d.category || "") !== "paid");
      if (freeDocs.length) {
        const docContext = freeDocs
          .map((d: { title?: string; content?: string }) => `Documento «${d.title}»:\n${d.content}`)
          .join("\n\n---\n\n");
        const doc = await askLLM(
          SYSTEM_BIBLE,
          `${prior}Informacion verificada del ministerio:\n${docContext}\n\nPregunta actual: ${question}`,
        );
        const answer = sanitizeAnswer(doc.answer ?? "");
        if (answer && !SOFT_NOT_FOUND_RE.test(answer)) {
          return json(await attachLifeContext({
            answer,
            source: "dato",
            fromKnowledge: true,
            factTitle: freeDocs[0]?.title,
          }, searchQ));
        }
      }
    }
    // ========== 2) BIBLIA (solo si el video NO respondio) ==========
    const { data: chunkMatches, error: chunkErr } = await supabase.rpc("match_bible_chunks", {
      query_embedding: embStr,
      match_count: 5
    });
    if (chunkErr) throw new Error("match_bible_chunks: " + chunkErr.message);
    if (!chunkMatches || chunkMatches.length === 0) {
      return json(await attachLifeContext({
        answer: "Todavía no encuentro material claro sobre eso en las enseñanzas. Puedes abrir el menú y elegir un contenido relacionado:",
        suggestions: tips.length ? tips : undefined
      }, searchQ));
    }
    // Parent-child: recupera el/los capitulos completos (padres) de los mejores chunks.
    const parentIds = [
      ...new Set(chunkMatches.map((c)=>c.parent_id).filter(Boolean))
    ].slice(0, MAX_PARENTS);
    const { data: parents } = await supabase.from("bible_parents").select("id, book_id, chapter, parent_text").in("id", parentIds);
    // Contexto ampliado: si hay padres, mandamos el pasaje completo;
    // si por algo faltan, caemos a los chunks recuperados.
    const bibleContext = parents && parents.length > 0 ? parents.map((p)=>`Pasaje biblico (contexto ampliado):\n${p.parent_text}`).join("\n\n---\n\n") : chunkMatches.slice(0, 3).map((c)=>c.chunk_text).join("\n\n");
    const bib = await askLLM(SYSTEM_BIBLE, `${prior}Contexto biblico:\n${bibleContext}\n\nPregunta actual: ${question}`);
    const passage = await resolvePassage(bib.reference);
    const answer = sanitizeAnswer(bib.answer ?? "");
    const payload = {
      answer,
      passage: passage ? {
        ...passage,
        bible_version: "Reina-Valera Antigua"
      } : undefined,
      source: "biblia"
    };
    if (SOFT_NOT_FOUND_RE.test(answer) && tips.length) {
      payload.suggestions = tips;
      if (!/contenido relacionado|menú|menu/i.test(answer)) {
        payload.answer = `${answer} Puedes abrir el menú y elegir un contenido relacionado.`;
      }
    }
    return json(await attachLifeContext(payload, searchQ));
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
