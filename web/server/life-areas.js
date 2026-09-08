/**
 * life-areas.js — Promesas y versículos por área de la vida cristiana.
 */

const norm = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

/** @type {Array<{id:string,label:string,keywords:string[],promise:string,verses:{reference:string,title:string}[]}>} */
export const LIFE_AREAS = [
  {
    id: "fe",
    label: "Fe y confianza",
    keywords: ["fe", "confiar", "confianza", "creer", "temor", "miedo", "ansiedad", "angustia"],
    promise:
      "Dios te ha dado una fe que no depende de tus fuerzas, sino de Cristo en ti. Puedes descansar en Él aun cuando no entiendas todo.",
    verses: [
      { reference: "Romanos 4:5", title: "Justificado por fe" },
      { reference: "Filipenses 4:19", title: "Dios suple" },
      { reference: "Isaías 41:10", title: "No temas" },
    ],
  },
  {
    id: "oracion",
    label: "Oración",
    keywords: ["orar", "oracion", "reza", "rezo", "clamar", "interceder", "oracion"],
    promise:
      "Puedes acercarte a Dios con libertad, no por mérito propio sino por la gracia. Él escucha al que clama en el nombre de Jesús.",
    verses: [
      { reference: "Filipenses 4:6-7", title: "Paz en oración" },
      { reference: "1 Juan 5:14", title: "Confianza al orar" },
      { reference: "Mateo 7:7", title: "Pide y recibirás" },
    ],
  },
  {
    id: "sanidad",
    label: "Sanidad",
    keywords: ["sanidad", "sanar", "sano", "enfermedad", "milagro", "sintoma", "cura", "dolor"],
    promise:
      "El Señor es tu sanador. En Cristo hay vida, restauración y cuidado para cuerpo y alma según su voluntad bondadosa.",
    verses: [
      { reference: "Isaías 53:5", title: "Por sus llagas" },
      { reference: "Salmo 103:3", title: "Sana enfermedades" },
      { reference: "Santiago 5:15", title: "Oración del justo" },
    ],
  },
  {
    id: "palabra",
    label: "La Palabra",
    keywords: ["palabra", "biblia", "escritura", "versiculo", "leer", "estudiar"],
    promise:
      "La Palabra de Dios es viva y te edifica. Bajo la gracia, la Escritura te forma y te confirma en la verdad de Cristo.",
    verses: [
      { reference: "2 Timoteo 3:16-17", title: "Escritura inspirada" },
      { reference: "Romanos 15:4", title: "Esperanza en la Palabra" },
      { reference: "Salmo 119:105", title: "Lámpara a mis pies" },
    ],
  },
  {
    id: "salvacion",
    label: "Salvación y nuevo nacimiento",
    keywords: ["nacer", "nuevo", "salvacion", "salvo", "evangelio", "cruz", "convertir"],
    promise:
      "La salvación es un regalo por gracia, recibido por fe, no por obras. En Cristo eres hijo de Dios y tienes vida eterna.",
    verses: [
      { reference: "Efesios 2:8-9", title: "Por gracia sois salvos" },
      { reference: "Juan 3:16", title: "De tal manera amó" },
      { reference: "Romanos 10:9", title: "Confesión y fe" },
    ],
  },
  {
    id: "dones",
    label: "Dones espirituales",
    keywords: ["dones", "espiritu", "carisma", "ministerio", "servir", "llamado"],
    promise:
      "Dios te ha equipado con dones para edificar a otros en amor. Cada miembro del cuerpo de Cristo tiene un lugar.",
    verses: [
      { reference: "1 Corintios 12:7", title: "Manifestación del Espíritu" },
      { reference: "Romanos 12:6", title: "Diversidad de dones" },
      { reference: "Efesios 4:7", title: "Gracia según la medida" },
    ],
  },
  {
    id: "familia",
    label: "Familia y matrimonio",
    keywords: ["familia", "matrimonio", "esposo", "esposa", "hijos", "pareja", "hogar"],
    promise:
      "En Cristo hay gracia para el hogar: amor, perdón y restauración. El Señor camina contigo en las relaciones más cercanas.",
    verses: [
      { reference: "Efesios 5:25", title: "Amor como Cristo" },
      { reference: "Colosenses 3:13", title: "Perdonad unos a otros" },
      { reference: "Proverbios 3:5-6", title: "Confía en el Señor" },
    ],
  },
  {
    id: "restauracion",
    label: "Restauración y testimonio",
    keywords: ["testimonio", "restaurar", "restauracion", "perdon", "victoria", "libertad"],
    promise:
      "En Cristo hay nueva creación: lo viejo pasó. Dios puede restaurar lo que parecía perdido y usar tu historia para Su gloria.",
    verses: [
      { reference: "2 Corintios 5:17", title: "Nueva criatura" },
      { reference: "Joel 2:25", title: "Restauraré los años" },
      { reference: "Romanos 8:1", title: "Ninguna condenación" },
    ],
  },
  {
    id: "finanzas",
    label: "Finanzas y provisión",
    keywords: ["dinero", "finanza", "financiero", "mapa financiero", "deuda", "prosper", "provision", "ofrenda"],
    promise:
      "Dios suple tus necesidades según sus riquezas en gloria. Él es tu proveedor y te enseña a administrar con sabiduría.",
    verses: [
      { reference: "Filipenses 4:19", title: "Suplirá todo" },
      { reference: "Mateo 6:33", title: "Buscad primero el reino" },
      { reference: "2 Corintios 9:8", title: "Abundancia en todo" },
    ],
  },
  {
    id: "paz",
    label: "Paz y ánimo",
    keywords: ["paz", "animo", "triste", "deprim", "solo", "desanim", "consuelo"],
    promise:
      "La paz de Cristo guarda tu corazón más allá de las circunstancias. Él no te deja solo en momentos difíciles.",
    verses: [
      { reference: "Juan 14:27", title: "Mi paz os doy" },
      { reference: "Isaías 26:3", title: "Paz perfecta" },
      { reference: "Romanos 15:13", title: "Dios de esperanza" },
    ],
  },
  {
    id: "proposito",
    label: "Trabajo y propósito",
    keywords: ["trabajo", "empleo", "proposito", "vocacion", "carrera", "negocio", "oficio"],
    promise:
      "Lo que hagas, hazlo de corazón como para el Señor. Él tiene un propósito para tu vida y te guía paso a paso.",
    verses: [
      { reference: "Colosenses 3:23", title: "Como para el Señor" },
      { reference: "Jeremías 29:11", title: "Planes de bien" },
      { reference: "Proverbios 16:3", title: "Encomienda al Señor" },
    ],
  },
  {
    id: "perdon",
    label: "Perdón y culpa",
    keywords: ["perdon", "culpa", "pecado", "condenacion", "verguenza", "arrepent"],
    promise:
      "En Cristo tienes perdón pleno y completo. No hay condenación para los que están en Jesús; la gracia te cubre.",
    verses: [
      { reference: "Efesios 1:7", title: "Redención y perdón" },
      { reference: "1 Juan 1:9", title: "Él es fiel" },
      { reference: "Colosenses 2:13", title: "Perdonados" },
    ],
  },
];

/** Versículos curados por tema concreto (tienen prioridad sobre FTS / refs flojas). */
export const TOPIC_VERSES = [
  {
    match: /yugo\s*desigual|desigual\s*yugo/,
    refs: ["2 Corintios 6:14", "2 Corintios 6:15"],
  },
  {
    match: /mapa\s*financ|finanzas?|deuda|presupuesto/,
    refs: ["Filipenses 4:19", "Mateo 6:33", "2 Corintios 9:8"],
  },
  {
    match: /\borar\b|\boracion\b|\brezar\b|\bclamar\b/,
    refs: ["Filipenses 4:6-7", "1 Juan 5:14", "Mateo 7:7"],
  },
  {
    match: /nacer\s*de\s*nuevo|nuevo\s*nacimiento|salvacion|ser\s*salvo/,
    refs: ["Juan 3:16", "Efesios 2:8-9", "Romanos 10:9"],
  },
  {
    match: /dones?\s*espiritual|carisma/,
    refs: ["1 Corintios 12:7", "Romanos 12:6", "Efesios 4:7"],
  },
  {
    match: /peligro\s*personal|solo\s*personal|relaciones?\s*sentiment/,
    refs: ["2 Corintios 6:14", "1 Corintios 15:33", "Proverbios 13:20"],
  },
  {
    match: /\bmiedo\b|\btemor\b|\bansiedad\b|\bangustia\b/,
    refs: ["Isaías 41:10", "2 Timoteo 1:7", "Filipenses 4:6-7"],
  },
  {
    match: /\bpaz\b|\bdesanim|\btriste|\bconsuelo/,
    refs: ["Juan 14:27", "Isaías 26:3", "Romanos 15:13"],
  },
  {
    match: /\bperdon\b|\bculpa\b|\bcondenacion\b/,
    refs: ["Romanos 8:1", "Efesios 1:7", "1 Juan 1:9"],
  },
  {
    match: /\bgracia\b|dispensacion/,
    refs: ["Efesios 2:8-9", "Romanos 6:14", "2 Corintios 12:9"],
  },
  {
    match: /cuantas?\s+dispens|dispensaciones|en\s+que\s+dispens/,
    refs: ["Efesios 3:2", "Colosenses 1:25", "Efesios 2:8-9"],
  },
];

/** Promesas de bienvenida (TLA) al saludar. */
export const WELCOME_PROMISES = [
  { reference: "Jeremías 29:11", title: "Planes de bien" },
  { reference: "Romanos 8:28", title: "Todas las cosas" },
  { reference: "Juan 14:27", title: "Mi paz os doy" },
  { reference: "Isaías 41:10", title: "No temas" },
  { reference: "Filipenses 4:13", title: "Todo lo puedo" },
];

/** Refs curadas que encajan con la pregunta (vacío si no hay match claro). */
export function topicVersesFor(question) {
  const text = norm(question);
  const refs = [];
  const seen = new Set();
  for (const topic of TOPIC_VERSES) {
    if (!topic.match.test(text)) continue;
    for (const ref of topic.refs) {
      const key = norm(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(ref);
    }
  }
  return refs;
}

/** Detecta el área de vida más relevante para una pregunta. */
export function detectLifeArea(question) {
  const text = norm(question);
  const tokens = new Set(text.split(/\s+/).filter((t) => t.length > 2));

  let best = null;
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

export function getLifeAreaById(id) {
  return LIFE_AREAS.find((a) => a.id === id) ?? null;
}

/** Resuelve versículos de un área en TLA. */
export async function resolveLifeArea(area, resolvePassageWithVersions, resolvePassage) {
  if (!area) return null;

  const verses = [];
  for (const v of area.verses) {
    const resolved = await resolvePassageWithVersions(v.reference, resolvePassage);
    if (!resolved) continue;
    verses.push({
      reference: resolved.reference,
      title: v.title,
      text: resolved.text,
      bible_version: resolved.bible_version,
    });
  }

  return {
    id: area.id,
    label: area.label,
    promise: area.promise,
    verses,
  };
}

/** Todas las áreas con versículos en TLA. */
export async function resolveAllLifeAreas(resolvePassageWithVersions, resolvePassage) {
  const areas = [];
  for (const area of LIFE_AREAS) {
    const resolved = await resolveLifeArea(area, resolvePassageWithVersions, resolvePassage);
    if (resolved?.verses?.length) areas.push(resolved);
  }
  return areas;
}

/** Versículos TLA de un área para enriquecer respuestas del chat. */
export async function passagesForLifeArea(area, resolvePassageWithVersions, resolvePassage, limit = 3) {
  if (!area) return [];
  const resolved = await resolveLifeArea(area, resolvePassageWithVersions, resolvePassage);
  if (!resolved?.verses?.length) return [];

  return resolved.verses.slice(0, limit).map((v) => ({
    reference: v.reference,
    text: v.text,
    bible_version: v.bible_version,
    versions: [{ bible_version: v.bible_version, text: v.text }],
    lifeArea: area.id,
    lifeAreaLabel: area.label,
  }));
}
