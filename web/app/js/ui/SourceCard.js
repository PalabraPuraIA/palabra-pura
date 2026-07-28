/**
 * SourceCard.js — La tarjeta de fuente: pasaje bíblico + video de referencia.
 *
 * Es el corazón del proyecto: permite que la persona verifique
 * la respuesta en su Biblia y vea el video en el minuto exacto.
 */

import {
  escapeHtml,
  formatTimestamp,
  buildYouTubeUrl,
  isPlayableYouTubeId,
} from "../utils/format.js";

const PLAY_ICON = `<svg viewBox="0 0 24 24" fill="none"><path d="M9 8.5v7l6-3.5-6-3.5Z" fill="currentColor"/></svg>`;
const CTA_ICON = `<svg viewBox="0 0 24 24" fill="none"><path d="M8 5v14l11-7L8 5Z" fill="currentColor"/></svg>`;

/** ¿Es un video de ejemplo del modo demo? */
const isDemoVideo = (video) => String(video?.youtube_id ?? "").startsWith("DEMO");

function renderPassage(passage, demo) {
  if (!passage?.reference) return "";

  const badge = demo ? `<span class="source__badge">ejemplo</span>` : "";
  const text = passage.text
    ? `<p class="source__text">“${escapeHtml(passage.text)}”</p>`
    : "";

  return `
    <div class="source__verse">
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
    <div class="source__video">
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
    </div>`;
}

/**
 * Devuelve el HTML de la tarjeta, o cadena vacía si no hay fuente.
 * @param {{ passage?: object, video?: object }} response
 */
export function renderSourceCard({ passage, video } = {}) {
  const demo = isDemoVideo(video);
  const inner = renderPassage(passage, demo) + renderVideo(video);

  return inner ? `<div class="source">${inner}</div>` : "";
}
