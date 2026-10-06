/**
 * AnalyticsService.js — Registra consultas y calificaciones.
 * Prefiere Supabase nube; el server Fintek queda de reserva.
 */

import { config } from "../config.js";
import { resolveBackend } from "./backend.js";

const TOPICS = [
  { id: "fe", keywords: ["fe", "confiar", "confianza", "creer", "temor", "miedo", "ansiedad"] },
  { id: "oracion", keywords: ["orar", "oracion", "reza", "rezo", "clamar"] },
  { id: "sanidad", keywords: ["sanidad", "sanar", "sano", "enfermedad", "milagro", "sintoma", "cura"] },
  { id: "palabra", keywords: ["palabra", "biblia", "escritura", "versiculo", "leer"] },
  { id: "nuevo", keywords: ["nacer", "nuevo", "salvacion", "salvo", "evangelio", "cruz"] },
  { id: "dones", keywords: ["dones", "espiritu", "carisma", "ministerio"] },
  { id: "familia", keywords: ["familia", "matrimonio", "esposo", "esposa", "hijos", "pareja"] },
  { id: "testimonio", keywords: ["testimonio", "restaurar", "restauracion", "perdon"] },
];

function detectTopics(question) {
  const q = String(question || "").toLowerCase();
  const hit = [];
  for (const topic of TOPICS) {
    if (topic.keywords.some((k) => q.includes(k))) hit.push(topic.id);
  }
  return hit.length ? hit : ["otros"];
}

function supabaseHeaders() {
  const key = config.publishableKey || "";
  return {
    "Content-Type": "application/json",
    apikey: key,
    Authorization: `Bearer ${key}`,
    Prefer: "return=minimal",
  };
}

function supabaseUrl(path) {
  const base = (config.supabaseUrl || "https://jkffgudzlcemapxprbws.supabase.co").replace(/\/+$/, "");
  return `${base}/rest/v1/${path}`;
}

function onGitHubPages() {
  return (
    typeof window !== "undefined" &&
    /github\.io$/i.test(window.location?.hostname || "")
  );
}

export class AnalyticsService {
  /**
   * @param {string} question
   * @param {object} [response]
   * @param {string} [id]
   * @returns {Promise<string|null>}
   */
  async trackQuestion(question, response = {}, id = null) {
    const q = String(question || "").trim();
    if (!q || q.length < 2) return null;

    const payload = {
      id: id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`),
      question: q.slice(0, 500),
      answer: String(response?.answer || "").trim().slice(0, 8000) || null,
      excerpt: String(response?.excerpt || "").trim().slice(0, 4000) || null,
      source: response?.source || null,
      mode: response?.mode || "supabase",
      topics: detectTopics(q),
      video: response?.video || null,
      passages: Array.isArray(response?.passages)
        ? response.passages
        : response?.passage
          ? [response.passage]
          : null,
      retrieval_meta: response?.retrieval || null,
    };

    const bodyLocal = {
      id: payload.id,
      question: payload.question,
      answer: payload.answer,
      excerpt: payload.excerpt,
      source: payload.source,
      mode: payload.mode,
      video: payload.video,
      passages: payload.passages,
      retrieval: payload.retrieval_meta,
    };

    try {
      const onPages = onGitHubPages();
      const backend = await resolveBackend();
      const eventUrl = backend.serverBase
        ? `${backend.serverBase}/api/analytics/event`
        : !onPages
          ? "/api/analytics/event"
          : null;

      if (!onPages && eventUrl) {
        const local = await fetch(eventUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyLocal),
          keepalive: true,
        }).catch(() => null);
        if (local?.ok) return payload.id;
      }

      if (config.publishableKey) {
        const cloud = await fetch(supabaseUrl("chat_interactions"), {
          method: "POST",
          headers: supabaseHeaders(),
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch(() => null);
        if (cloud?.ok) return payload.id;
      }

      if (onPages && eventUrl) {
        const fallback = await fetch(eventUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyLocal),
          keepalive: true,
        }).catch(() => null);
        if (fallback?.ok) return payload.id;
      }
    } catch (err) {
      console.warn("[AnalyticsService]", err);
    }
    return payload.id;
  }

  /**
   * @param {string} interactionId
   * @param {"useful"|"not_useful"} vote
   * @param {{ question?: string }} [extra]
   */
  async rateAnswer(interactionId, vote, extra = {}) {
    const id = String(interactionId || "").trim();
    const v = vote === "not_useful" ? "not_useful" : "useful";
    if (!id) return false;

    const payload = {
      interaction_id: id,
      vote: v,
      question: String(extra.question || "").trim().slice(0, 500) || null,
    };

    let ok = false;
    try {
      const onPages = onGitHubPages();
      const backend = await resolveBackend();
      const rateUrl = backend.serverBase
        ? `${backend.serverBase}/api/analytics/rate`
        : !onPages
          ? "/api/analytics/rate"
          : null;

      if (!onPages && rateUrl) {
        const local = await fetch(rateUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, vote: v, question: payload.question }),
        }).catch(() => null);
        if (local?.ok) ok = true;
      }

      const rateFn =
        config.fallbackEndpoint ||
        config.endpoint ||
        `${String(config.supabaseUrl || "").replace(/\/+$/, "")}/functions/v1/chatbot-iglesia-palabra-pura`;
      if (rateFn && /supabase\.co/.test(rateFn) && config.publishableKey) {
        const viaFn = await fetch(rateFn, {
          method: "POST",
          headers: supabaseHeaders(),
          body: JSON.stringify({
            action: "rate",
            id,
            interaction_id: id,
            vote: v,
            question: payload.question,
          }),
        }).catch(() => null);
        if (viaFn?.ok) ok = true;
      }

      if (!ok && config.publishableKey) {
        const cloud = await fetch(supabaseUrl("chat_ratings"), {
          method: "POST",
          headers: supabaseHeaders(),
          body: JSON.stringify(payload),
        }).catch(() => null);
        if (cloud?.ok) ok = true;
      }

      if (!ok && onPages && rateUrl) {
        const fallback = await fetch(rateUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, vote: v, question: payload.question }),
        }).catch(() => null);
        if (fallback?.ok) ok = true;
      }
    } catch (err) {
      console.warn("[AnalyticsService] rate", err);
    }
    return ok;
  }
}
