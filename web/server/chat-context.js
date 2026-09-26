/**
 * Contexto multi-turno: la UI envía turnos recientes; el server los usa
 * para entender seguimientos sin cambiar los system prompts.
 */

const MAX_HISTORY_TURNS = 6;

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
  if (!q || !hist.length || !looksLikeFollowUp(q)) return q;

  const lastUser = [...hist].reverse().find((turn) => turn.role === "user");
  if (!lastUser?.content) return q;
  if (lastUser.content.toLowerCase() === q.toLowerCase()) return q;
  return `${lastUser.content}\n${q}`;
}

/** Bloque corto para el mensaje al LLM (no altera el system prompt). */
export function historyBlock(history) {
  const hist = normalizeHistory(history).slice(-4);
  if (!hist.length) return "";
  const lines = hist.map((turn) => {
    const who = turn.role === "user" ? "Usuario" : "Grace";
    return `${who}: ${turn.content}`;
  });
  return `Conversacion reciente (solo para entender el seguimiento; responde con base en el contexto de audio/Biblia de esta vuelta):\n${lines.join("\n")}\n\n`;
}
