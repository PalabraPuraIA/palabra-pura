/**
 * AnalyticsService.js — Registra consultas en Supabase (chat_interactions).
 * En GitHub Pages no hay /api/analytics; usa el REST de Supabase.
 * Falla en silencio si el API no está disponible.
 */

import { config } from "../config.js";

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

export class AnalyticsService {
  /**
   * @param {string} question
   * @param {object} [response]
   */
  async trackQuestion(question, response = {}) {
    const q = String(question || "").trim();
    if (!q || q.length < 2) return;

    const payload = {
      id: crypto.randomUUID(),
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

    try {
      // Prefer local proxy when available (Fintek server).
      const local = await fetch("/api/analytics/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: payload.question,
          answer: payload.answer,
          excerpt: payload.excerpt,
          source: payload.source,
          mode: payload.mode,
          video: payload.video,
          passages: payload.passages,
          retrieval: payload.retrieval_meta,
        }),
        keepalive: true,
      }).catch(() => null);

      if (local?.ok) return;

      if (!config.publishableKey) return;
      await fetch(supabaseUrl("chat_interactions"), {
        method: "POST",
        headers: supabaseHeaders(),
        body: JSON.stringify(payload),
        keepalive: true,
      });
    } catch (err) {
      console.warn("[AnalyticsService]", err);
    }
  }
}
