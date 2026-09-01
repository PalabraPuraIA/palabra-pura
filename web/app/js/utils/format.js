/**
 * format.js — Formato y saneado de texto.
 */

const HTML_ENTITIES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escapa HTML. IMPORTANTE: se aplica a TODO texto que venga
 * del usuario o del backend antes de inyectarlo en el DOM.
 */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => HTML_ENTITIES[char]);
}

/** Segundos → "m:ss" (ej. 132 → "2:12"). */
export function formatTimestamp(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** Construye el enlace de YouTube al segundo exacto. */
export function buildYouTubeUrl(youtubeId, startSecond = 0) {
  if (!youtubeId) return null;
  const time = Math.max(0, Math.floor(Number(startSecond) || 0));
  return `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}&t=${time}s`;
}

/**
 * URL de embed (iframe) al segundo exacto.
 * autoplay=1 ayuda a arrancar; el navegador puede bloquear el sonido.
 */
export function buildYouTubeEmbedUrl(youtubeId, startSecond = 0, { autoplay = true } = {}) {
  if (!youtubeId) return null;
  const time = Math.max(0, Math.floor(Number(startSecond) || 0));
  const params = new URLSearchParams({
    start: String(time),
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
  });
  if (autoplay) params.set("autoplay", "1");
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}?${params}`;
}

/** IDs inventados del modo demo no se pueden embeber. */
export function isPlayableYouTubeId(youtubeId) {
  const id = String(youtubeId ?? "").trim();
  return Boolean(id) && !id.startsWith("DEMO");
}
