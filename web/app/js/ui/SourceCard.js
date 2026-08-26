/**
 * SourceCard.js — Bloques separados de fuente:
 *  1) Recorte de la enseñanza (audio / transcripción)
 *  2) Pasaje bíblico (Reina-Valera Antigua)
 *  3) Video en el minuto exacto
 */

import {
  escapeHtml,
  formatTimestamp,
  buildYouTubeUrl,
  isPlayableYouTubeId,
} from "../utils/format.js";

const PLAY_ICON = `<svg viewBox="0 0 24 24" fill="none"><path d="M9 8.5v7l6-3.5-6-3.5Z" fill="currentColor"/></svg>`;
const CTA_ICON = `<svg viewBox="0 0 24 24" fill="none"><path d="M8 5v14l11-7L8 5Z" fill="currentColor"/></svg>`;

const isDemoVideo = (video) => String(video?.youtube_id ?? "").startsWith("DEMO");

function renderExcerpt(excerpt) {
  if (!excerpt) return "";

  return `
    <div class="source__block source__excerpt">
      <p class="source__label">En la enseñanza</p>
      <p class="source__text">“${escapeHtml(excerpt)}”</p>
    </div>`;
}

function renderPassage(passage, demo) {
  if (!passage?.reference) return "";

  const version = passage.bible_version || "Reina-Valera Antigua";
  const badge = demo
    ? `<span class="source__badge">ejemplo</span>`
    : `<span class="source__badge">${escapeHtml(version)}</span>`;
  const text = passage.text
    ? `<p class="source__text">“${escapeHtml(passage.text)}”</p>`
    : "";

  return `
    <div class="source__block source__verse">
      <p class="source__label">Pasaje bíblico</p>
      <p class="source__ref">${escapeHtml(passage.reference)}${badge}</p>
      ${text}
    </div>`;
}

function renderVideo(video) {
  if (!video?.title && !video?.youtube_id) return "";

  const start = video.start_second ?? 0;
  const url = buildYouTubeUrl(video.youtube_id, start) ?? "#";
  const episode = video.episode
    ? `<span class="source__episode">Episodio ${escapeHtml(video.episode)}</span>`
    : "";
  const playable = isPlayableYouTubeId(video.youtube_id);
  const playHere = playable
    ? `<button
         type="button"
         class="source__cta source__cta--here"
         data-play-here
         data-youtube-id="${escapeHtml(video.youtube_id)}"
         data-start-second="${escapeHtml(start)}"
         data-title="${escapeHtml(video.title ?? "")}"
         data-episode="${escapeHtml(video.episode ?? "")}"
       >
         ${CTA_ICON} Reproducir aquí
       </button>`
    : "";

  return `
    <div class="source__block source__video">
      <p class="source__label">Video de referencia</p>
      <div class="source__video-row">
        <span class="source__thumb" aria-hidden="true">${PLAY_ICON}</span>
        <span class="source__info">
          ${episode}
          <span class="source__video-title">${escapeHtml(video.title ?? "Ver el video")}</span>
        </span>
        <span class="source__actions">
          ${playHere}
          <a class="source__cta source__cta--link" href="${url}" target="_blank" rel="noopener">
            ${CTA_ICON} YouTube · ${formatTimestamp(start)}
          </a>
        </span>
      </div>
    </div>`;
}

/**
 * @param {{ passage?: object, video?: object, excerpt?: string, source?: string }} response
 */
export function renderSourceCard({ passage, video, excerpt, source } = {}) {
  const demo = isDemoVideo(video);
  const inner =
    renderExcerpt(excerpt) + renderPassage(passage, demo) + renderVideo(video);

  if (!inner) return "";

  const origin =
    source === "biblia"
      ? `<p class="source__origin">Respuesta basada en la Biblia (cuando no hubo coincidencia clara en los videos).</p>`
      : source === "video"
        ? `<p class="source__origin">Respuesta basada en la enseñanza en video.</p>`
        : "";

  return `<div class="source">${origin}${inner}</div>`;
}
