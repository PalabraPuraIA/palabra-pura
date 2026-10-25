/**
 * ChatService.js — Única capa que habla con el backend.
 *
 * - En el server/contenedor: /api/chat local primero.
 * - En GitHub Pages: Supabase nube primero; server de reserva.
 */

import { config, isConnected } from "../config.js";
import { demoResponses, fallbackDemoResponse } from "../data/demoResponses.js";
import { resolveBackend } from "./backend.js";

const NETWORK_ERROR_MESSAGE =
  "No pude conectar con el chatbot. Revisa que la URL sea correcta y que la función esté desplegada, " +
  "y vuelve a intentarlo.";

const MAX_HISTORY = 12;
const SESSION_KEY = "pp-chat-session";

function inferPaidOffer(data) {
  if (data?.offer && (data.offer.url || data.offer.label)) return null;
  const text = String(data?.answer || data?.text || "");
  if (!/adquiere la ense[nñ]anza|ense[nñ]anza de pago/i.test(text)) return null;
  const urlMatch = text.match(/https?:\/\/[^\s<>"']+/);
  const titleMatch = text.match(/[«"]([^»"]+)[»"]/);
  return {
    title: data.factTitle || data.video?.title || titleMatch?.[1] || "Esta enseñanza",
    url: urlMatch ? urlMatch[0].replace(/[.,;]+$/, "") : "",
    label: "Ver en el carrito",
    kind: "pago",
  };
}

function newSessionId() {
  return `pp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readTabSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return { id: newSessionId(), history: [] };
    const data = JSON.parse(raw);
    const history = Array.isArray(data?.history)
      ? data.history.filter((t) => t && (t.role === "user" || t.role === "assistant") && t.content).slice(-MAX_HISTORY)
      : [];
    return { id: String(data?.id || newSessionId()), history };
  } catch {
    return { id: newSessionId(), history: [] };
  }
}

function writeTabSession(id, history) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, history: history.slice(-MAX_HISTORY) }));
  } catch {
    /* ignore quota / private mode */
  }
}

function isGitHubPages() {
  return (
    typeof window !== "undefined" &&
    /github\.io$/i.test(window.location?.hostname || "")
  );
}

export class ChatService {
  /** Historial solo de ESTA pestaña (sessionStorage). Otra pestaña = otra sesión, vacía. */
  #sessionId = readTabSession().id;
  /** @type {{role: string, content: string}[]} */
  #history = readTabSession().history;

  /** Turnos guardados de esta pestaña (para el panel lateral). */
  getHistory() {
    return this.#history.slice();
  }

  /**
   * Envía una pregunta y devuelve una respuesta normalizada.
   * Nunca lanza: los errores vuelven como respuesta legible.
   * @param {string} question
   * @returns {Promise<{answer: string, passage?: object, video?: object, mode?: string}>}
   */
  async ask(question) {
    if (!isConnected()) return this.#askDemo(question);

    const backend = await resolveBackend();
    const cloudCandidate =
      config.fallbackEndpoint ||
      (config.endpoint && /supabase\.co/.test(config.endpoint)
        ? config.endpoint
        : null) ||
      `${String(config.supabaseUrl || "").replace(/\/+$/, "")}/functions/v1/chatbot-iglesia-palabra-pura`;
    const cloud = cloudCandidate && /supabase\.co/.test(cloudCandidate) ? cloudCandidate : null;

    const local =
      backend.mode === "server"
        ? backend.chatEndpoint
        : backend.serverBase
          ? `${backend.serverBase}/api/chat`
          : !isGitHubPages()
            ? "/api/chat"
            : null;

    // Pages: nube → local. Contenedor: local → nube.
    const endpoints = [];
    if (isGitHubPages()) {
      if (cloud) endpoints.push(cloud);
      if (local && !endpoints.includes(local)) endpoints.push(local);
    } else {
      if (local) endpoints.push(local);
      if (cloud && !endpoints.includes(cloud)) endpoints.push(cloud);
    }

    for (const endpoint of endpoints) {
      try {
        const response = this.#normalize(
          await this.#post(endpoint, question, this.#history),
        );
        response.mode =
          response.mode || (/supabase\.co/.test(endpoint) ? "supabase" : "server");
        this.#remember(question, response);
        return response;
      } catch (error) {
        console.warn("[ChatService]", endpoint, error);
      }
    }

    return { answer: NETWORK_ERROR_MESSAGE };
  }

  /** Un POST al backend. Solo manda la apikey si el destino es Supabase. */
  async #post(endpoint, question, history = []) {
    const headers = { "Content-Type": "application/json" };
    if (/supabase\.co/.test(endpoint) && config.publishableKey) {
      headers.apikey = config.publishableKey;
      headers.Authorization = `Bearer ${config.publishableKey}`;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        question,
        session_id: this.#sessionId,
        history: history.slice(-MAX_HISTORY),
      }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  #remember(question, response) {
    const answer = String(response?.answer || "").trim();
    if (!question?.trim() || !answer) return;
    this.#history.push({ role: "user", content: question.trim().slice(0, 500) });
    this.#history.push({ role: "assistant", content: answer.slice(0, 500) });
    if (this.#history.length > MAX_HISTORY) {
      this.#history = this.#history.slice(-MAX_HISTORY);
    }
    writeTabSession(this.#sessionId, this.#history);
  }

  async #askDemo(question) {
    await new Promise((resolve) => setTimeout(resolve, config.demoDelayMs));
    return demoResponses[question] ?? fallbackDemoResponse;
  }

  #normalize(data) {
    if (typeof data === "string") return { answer: data };

    const offer = data.offer && (data.offer.url || data.offer.label)
      ? {
          title: data.offer.title || data.video?.title || "Esta enseñanza",
          url: String(data.offer.url || "").trim(),
          label: data.offer.label || (data.offer.kind === "tienda" ? "Ver esta" : "Ver en el carrito"),
          hint: data.offer.hint || "",
          kind: data.offer.kind || "",
        }
      : inferPaidOffer(data);
    const isPaid = Boolean(offer);

    return {
      answer: data.answer ?? data.text ?? "",
      excerpt: isPaid ? undefined : data.excerpt ?? undefined,
      passage: isPaid ? undefined : data.passage ?? undefined,
      passages: isPaid ? undefined : data.passages ?? undefined,
      video: isPaid
        ? { title: offer.title, youtube_id: data.video?.youtube_id, episode: data.video?.episode, start_second: 0 }
        : data.video ?? undefined,
      source: isPaid ? "oferta" : data.source ?? undefined,
      suggestions: isPaid ? undefined : (Array.isArray(data.suggestions) ? data.suggestions : undefined),
      lifeArea: data.lifeArea ?? undefined,
      mode: data.mode ?? undefined,
      knowledgeId: data.knowledgeId ?? undefined,
      fromKnowledge: Boolean(data.fromKnowledge),
      offer: offer || undefined,
      offers: Array.isArray(data.offers) && data.offers.length
        ? data.offers.map((item) => ({
            title: item.title || offer?.title || "Esta enseñanza",
            url: String(item.url || "").trim(),
            label: item.label || (item.kind === "tienda" ? "Ver esta" : "Ver en el carrito"),
            hint: item.hint || "",
            kind: item.kind || offer?.kind || "",
          }))
        : undefined,
      articles: Array.isArray(data.articles) ? data.articles : undefined,
    };
  }

  /**
   * Envía feedback (útil / no útil) para la base de conocimiento.
   * @param {{ vote: string, question: string, knowledgeId?: number, payload?: object, articles?: object[] }} body
   */
  async sendFeedback(body) {
    try {
      const res = await fetch("/api/knowledge/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return { ok: false };
      return res.json();
    } catch {
      return { ok: false };
    }
  }
}
