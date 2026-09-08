/**
 * ChatService.js — Única capa que habla con el backend.
 *
 * La interfaz (ui/*) NO sabe nada de fetch ni de JSON.
 * Le pide una respuesta a este servicio y ya.
 *
 * Contrato con la Edge Function:
 *   envía →  { "question": "..." }
 *   recibe → { "answer": "...",                 // explicación de la IA
 *              "excerpt": "...",                // recorte de audio/transcripción (opcional)
 *              "passage": { "reference", "text", "bible_version?" },
 *              "video":   { "title", "episode", "youtube_id", "start_second" },
 *              "source":  "video" | "biblia" }
 *   (passage, video, excerpt son opcionales)
 */

import { config, isConnected } from "../config.js";
import { demoResponses, fallbackDemoResponse } from "../data/demoResponses.js";

const NETWORK_ERROR_MESSAGE =
  "No pude conectar con el chatbot. Revisa que la URL sea correcta y que la función esté desplegada, " +
  "y vuelve a intentarlo.";

export class ChatService {
  /**
   * Envía una pregunta y devuelve una respuesta normalizada.
   * Nunca lanza: los errores vuelven como respuesta legible.
   * @param {string} question
   * @returns {Promise<{answer: string, passage?: object, video?: object}>}
   */
  async ask(question) {
    if (!isConnected()) return this.#askDemo(question);

    try {
      return this.#normalize(await this.#post(config.endpoint, question));
    } catch (error) {
      console.error("[ChatService]", error);

      // Hosting estático o backend propio sin configurar: probamos la Edge Function.
      const fallback = config.fallbackEndpoint;
      if (fallback && fallback !== config.endpoint) {
        try {
          return this.#normalize(await this.#post(fallback, question));
        } catch (fallbackError) {
          console.error("[ChatService] fallback", fallbackError);
        }
      }
      return { answer: NETWORK_ERROR_MESSAGE };
    }
  }

  /** Un POST al backend. Solo manda la apikey si el destino es Supabase. */
  async #post(endpoint, question) {
    const headers = { "Content-Type": "application/json" };
    if (/supabase\.co/.test(endpoint) && config.publishableKey) {
      headers.apikey = config.publishableKey;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ question }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /** Modo demostración: respuestas de ejemplo, sin backend. */
  async #askDemo(question) {
    await new Promise((resolve) => setTimeout(resolve, config.demoDelayMs));
    return demoResponses[question] ?? fallbackDemoResponse;
  }

  /** Acepta variaciones de formato y siempre devuelve la misma forma. */
  #normalize(data) {
    if (typeof data === "string") return { answer: data };

    return {
      answer: data.answer ?? data.text ?? "",
      excerpt: data.excerpt ?? undefined,
      passage: data.passage ?? undefined,
      passages: data.passages ?? undefined,
      video: data.video ?? undefined,
      source: data.source ?? undefined,
      suggestions: Array.isArray(data.suggestions) ? data.suggestions : undefined,
      lifeArea: data.lifeArea ?? undefined,
      mode: data.mode ?? undefined,
    };
  }
}
