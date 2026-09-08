/**
 * chat-guard.js — Filtro previo al cerebro del chat.
 *
 * - Responde datos básicos del ministerio (nombres de pastores).
 * - Desvía groserías e insultos con calma.
 * - Evita respuestas raras a bobadas o temas ajenos a la Escuela Bíblica.
 */

const OFF_TOPIC_ANSWER =
  "Ese es un tema que no tiene relación con la Escuela Bíblica ni con las Escrituras. ¿Quieres preguntarme algo de la fe, de la Biblia o de las enseñanzas del ministerio?";

const RUDE_ANSWER =
  "Prefiero conversar con respeto. Este espacio es para la Escuela Bíblica de Palabra Pura. Si tienes una pregunta sobre la fe, la Biblia o las enseñanzas, con gusto te acompaño.";

const PASTORS_ANSWER =
  "Los pastores de la Escuela Bíblica de Palabra Pura son Rafael y Adriana Lemes. Ellos enseñan las clases que verás citadas en este chat.";

const FAITH_RE =
  /\b(dios|senor|jesus|jesucristo|cristo|biblia|escritura|escrituras|pastor|pastores|iglesia|oracion|orar|ore|fe|gracia|pecado|evangelio|versiculo|versiculos|escuela|biblica|palabra\s*pura|salvacion|perdon|espiritu|santo|ley|dispensacion|matrimonio|divorcio|sanidad|milagro|bautismo|ayuno|diezmo|ofrenda|satanas|demonio|cielo|infierno|amor|identidad|nueva\s*criatura|rafael|adriana|lemes|cruz|resurreccion|arrepentimiento|justicia|misericordia|promesa|alianza|pacto|apostol|profeta|disciple|discipulo|ministerio|ensenanza|ensenanzas|audio|video|clase|blaze)\b/;

const NONSENSE_RE =
  /\b(papa|papas|helado|helados|pizza|hamburguesa|perro\s*caliente|gaseosa|coca|futbol|messi|netflix|tiktok|instagram|whatsapp|juego|minecraft|fortnite|meme|chisme|chistes?|bobada|tonteria|tonterias)\b/;

const INSULT_RE =
  /\b(idiota|imbecil|estupido|estupida|pendejo|pendeja|hijueputa|hp\b|malparido|malparida|gonorrea|caremonda|marica|maricon|puto|puta|putas|mierda|carajo|joder|co[nñ]o|cabron|cabrona|perra|zorra|basura\s*humana|vete\s*a\s*la\s*|callate|cállate)\b/;

const VULGAR_RE =
  /\b(verga|pito|pene|vagina|culo|trasero|tetas?|coger|cogiendo|follar|porno|xxx|sexo\s*oral|masturb)\b/;

const PASTORS_FAQ_RE =
  /\b((como|qu[eé]|cual(es)?)\s+(se\s+)?(llama|llaman|nombre|nombres).{0,40}(pastor|pastores)|(pastor|pastores).{0,40}(llama|llaman|nombre|nombres|qui[eé]n(es)?\s+son)|qui[eé]n(es)?\s+(es|son)\s+(el|la|los|las)?\s*pastor)/;

function norm(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?¡!.,;:"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPastorsFaq(n) {
  return PASTORS_FAQ_RE.test(n);
}

function isRude(n) {
  return INSULT_RE.test(n) || VULGAR_RE.test(n);
}

/**
 * Bobadas o temas ajenos: sin vocabulario de fe y con señales de ruido,
 * o preguntas tan cortas/absurdas que no apuntan a la Escuela Bíblica.
 */
function isOffTopic(n) {
  if (!n || FAITH_RE.test(n)) return false;
  if (NONSENSE_RE.test(n)) return true;

  const words = n.split(" ").filter(Boolean);
  if (words.length <= 4 && !/\b(que|como|quien|cual|donde|por\s*que|explica|significa|hablame|cuentame)\b/.test(n)) {
    return true;
  }

  // Preguntas tipo "cuánto es 2+2", clima, recetas, etc.
  if (
    /\b(cuanto\s+es|suma|resta|multiplic|clima|temperatura|receta|cocinar|partido|resultado)\b/.test(n)
  ) {
    return true;
  }

  return false;
}

/**
 * Si la pregunta encaja en un caso especial, devuelve la respuesta lista.
 * Si no, `null` y el chat sigue su flujo normal.
 */
export function guardQuestion(question) {
  const n = norm(question);
  if (!n) return null;

  if (isPastorsFaq(n)) {
    return {
      answer: PASTORS_ANSWER,
      source: "ministry",
      mode: "faq",
    };
  }

  if (isRude(n)) {
    return {
      answer: RUDE_ANSWER,
      mode: "guard",
    };
  }

  if (isOffTopic(n)) {
    return {
      answer: OFF_TOPIC_ANSWER,
      mode: "guard",
    };
  }

  return null;
}

/** Mensaje estándar cuando el modelo o la búsqueda ven que el tema no aplica. */
export function offTopicAnswer() {
  return {
    answer: OFF_TOPIC_ANSWER,
    mode: "guard",
  };
}

/**
 * Quita groserías evidentes de una respuesta ya generada (red de seguridad).
 * Si el texto queda vacío, usa el mensaje de respeto.
 */
export function sanitizeAnswer(answer) {
  let text = String(answer ?? "");
  if (!text) return text;

  if (INSULT_RE.test(norm(text)) || VULGAR_RE.test(norm(text))) {
    return RUDE_ANSWER;
  }

  return text;
}

export { OFF_TOPIC_ANSWER, PASTORS_ANSWER, RUDE_ANSWER };
