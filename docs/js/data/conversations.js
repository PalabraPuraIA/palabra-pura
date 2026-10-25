/**
 * conversations.js — Historial local de chats (como un chat de IA).
 */

const KEY = "pp-conversations-v1";
const MAX = 50;

function read() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* quota / modo privado */
  }
}

function slimResponse(response) {
  if (!response || typeof response !== "object") return { answer: "" };
  return {
    answer: response.answer,
    excerpt: response.excerpt,
    passage: response.passage,
    passages: response.passages,
    video: response.video,
    source: response.source,
    offer: response.offer,
    offers: response.offers,
    suggestions: response.suggestions,
    lifeArea: response.lifeArea,
    interactionId: response.interactionId,
    question: response.question,
  };
}

export function listConversations() {
  return read().sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

export function getConversation(id) {
  return read().find((item) => item.id === id) || null;
}

export function appendTurn(id, question, response) {
  const all = read();
  let convo = all.find((item) => item.id === id);
  if (!convo) {
    convo = { id, title: "Nueva conversación", updatedAt: Date.now(), turns: [] };
    all.unshift(convo);
  }
  const q = String(question || "").trim();
  if (q && (!convo.turns || !convo.turns.length)) {
    convo.title = q.slice(0, 72);
  }
  convo.turns = Array.isArray(convo.turns) ? convo.turns : [];
  convo.turns.push({ question: q, response: slimResponse(response) });
  convo.updatedAt = Date.now();
  write([convo, ...all.filter((item) => item.id !== id)]);
  return convo;
}

export function historyFromTurns(turns) {
  const history = [];
  for (const turn of turns || []) {
    if (turn.question) history.push({ role: "user", content: String(turn.question).slice(0, 500) });
    const answer = String(turn.response?.answer || "").trim();
    if (answer) history.push({ role: "assistant", content: answer.slice(0, 500) });
  }
  return history.slice(-12);
}
