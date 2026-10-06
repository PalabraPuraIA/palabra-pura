/**
 * Contexto multi-turno: la UI envía turnos recientes; el server los usa
 * para entender seguimientos sin cambiar los system prompts.
 */

const MAX_HISTORY_TURNS = 12;

export function normalizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = item.role === "assistant" || item.role === "bot" ? "assistant" : item.role === "user" ? "user" : null;
    const content = String(item.content ?? item.text ?? "").trim();
    if (!role || content.length < 1) continue;
    out.push({ role, content: content.slice(0, 600) });
    if (out.length >= MAX_HISTORY_TURNS) break;
  }
  return out;
}

/** ¿La pregunta parece un seguimiento de lo anterior? */
export function looksLikeFollowUp(question) {
  const q = String(question ?? "").trim();
  if (!q) return false;
  if (q.length <= 48) return true;
  return /^(y |entonces |pero |ok |vale |si |sí |no |tambien|también|por que|por qué|y que|y qué)/i.test(q)
    || /\b(eso|esa|ese|eso mismo|aquello|lo anterior|dijiste|mencionaste|antes|seguimiento)\b/i.test(q);
}

/** Pregunta enriquecida solo para búsqueda/embeddings. */
export function retrievalQuestion(question, history) {
  const q = String(question ?? "").trim();
  const hist = normalizeHistory(history);
  if (!q || !hist.length) return q;
  if (!looksLikeFollowUp(q) && q.length > 48) return q;

  const lastUser = [...hist].reverse().find((turn) => turn.role === "user");
  const lastBot = [...hist].reverse().find((turn) => turn.role === "assistant");
  const parts = [];
  if (lastUser?.content && lastUser.content.toLowerCase() !== q.toLowerCase()) {
    parts.push(lastUser.content);
  }
  if (lastBot?.content && q.length <= 48) {
    parts.push(lastBot.content.slice(0, 220));
  }
  parts.push(q);
  return parts.join("\n");
}

/** Bloque corto para el mensaje al LLM (no altera el system prompt). */
export function historyBlock(history) {
  const hist = normalizeHistory(history).slice(-8);
  if (!hist.length) return "";
  const lines = hist.map((turn) => {
    const who = turn.role === "user" ? "Usuario" : "Blaze";
    return `${who}: ${turn.content}`;
  });
  return `Conversacion reciente (usa este hilo para entender seguimientos, pronombres y "eso"; responde con base en el audio/Biblia de esta vuelta):\n${lines.join("\n")}\n\n`;
}
