/**
 * AnalyticsService.js — Envía cada pregunta al dashboard local (mismo origen).
 * Falla en silencio si el API no está disponible.
 */

export class AnalyticsService {
  /**
   * @param {string} question
   */
  async trackQuestion(question) {
    const q = String(question || "").trim();
    if (!q) return;
    try {
      await fetch("/api/analytics/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
        keepalive: true,
      });
    } catch (err) {
      console.warn("[AnalyticsService]", err);
    }
  }
}
