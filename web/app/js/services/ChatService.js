/**
 * ChatService.js — Única capa que habla con el backend.
 *
 * La interfaz (ui/*) NO sabe nada de fetch ni de JSON.
 * Le pide una respuesta a este servicio y ya.
 *
 * Contrato con la Edge Function:
 *   envía →  { "question": "..." }
 *   recibe → { "answer": "...",
 *              "passage": { "reference": "Juan 3:16", "text": "..." },
 *              "video":   { "title": "...", "episode": 12,
 *                           "youtube_id": "abc123XYZ_1", "start_second": 123 } }
 *   (passage y video son opcionales)
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
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      return this.#normalize(data);
    } catch (error) {
      console.error("[ChatService]", error);
      return { answer: NETWORK_ERROR_MESSAGE };
    }
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
      passage: data.passage ?? undefined,
      video: data.video ?? undefined,
    };
  }
}
