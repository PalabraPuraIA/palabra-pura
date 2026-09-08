/**
 * SourceCard.js — Versículos en TLA y video de la enseñanza.
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

function passageText(passage) {
  if (passage?.text) return passage.text;
  const versions = passage?.versions;
  if (Array.isArray(versions) && versions.length) return versions[0]?.text ?? "";
  return "";
}

function renderPassage(passage, demo, label = "Pasaje bíblico") {
  if (!passage?.reference) return "";

  const text = passageText(passage);
  if (!text) return "";

  const badge = demo
    ? `<span class="source__badge">ejemplo</span>`
    : `<span class="source__badge">TLA</span>`;

  return `
    <article class="source__block source__verse">
      <p class="source__label">${escapeHtml(label)}</p>
      <p class="source__ref">${escapeHtml(passage.reference)}</p>
      ${badge}
      <p class="source__text">“${escapeHtml(text)}”</p>
    </article>`;
}

function renderPassages(passage, passages, demo) {
  const list =
    Array.isArray(passages) && passages.length
      ? passages
      : passage?.reference
        ? [passage]
        : [];

  if (!list.length) return "";

  const cards = list
    .map((p, i) =>
      renderPassage(
        p,
        demo,
        list.length > 1 ? `Versículo ${i + 1}` : "Versículo",
      ),
    )
    .join("");

  return `
    <section class="source__panel source__panel--verses" aria-label="Versículos">
      <h3 class="source__panel-title">Versículos (TLA)</h3>
      <div class="source__panel-body">${cards}</div>
    </section>`;
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
    <section class="source__panel source__panel--video" aria-label="Audio en video">
      <h3 class="source__panel-title">Escucha la enseñanza completa</h3>
      <div class="source__block source__video">
        <div class="source__video-row">
          <span class="source__thumb" aria-hidden="true">${PLAY_ICON}</span>
          <span class="source__info">
            ${episode}
            <span class="source__video-title">${escapeHtml(video.title ?? "Ver el video")}</span>
            <span class="source__video-hint">Minuto ${formatTimestamp(start)} · basado en este audio</span>
          </span>
          <span class="source__actions">
            ${playHere}
            <a class="source__cta source__cta--link" href="${url}" target="_blank" rel="noopener">
              ${CTA_ICON} YouTube
            </a>
          </span>
        </div>
      </div>
    </section>`;
}

/**
 * @param {{ passage?: object, passages?: object[], video?: object, source?: string }} response
 */
export function renderSourceCard({ passage, passages, video, source } = {}) {
  const demo = isDemoVideo(video);
  const verses = renderPassages(passage, passages, demo);
  const vid = renderVideo(video);

  if (!verses && !vid) return "";

  const origin =
    source === "biblia" && verses
      ? `<p class="source__origin">Pasajes bíblicos relacionados con tu pregunta.</p>`
      : source === "video" && verses
        ? `<p class="source__origin">Resumen del audio del ministerio, con versículos citados y el video donde se enseña.</p>`
        : source === "video"
          ? `<p class="source__origin">Basado en la enseñanza en audio del ministerio.</p>`
          : "";

  return `<div class="source">${origin}${verses}${vid}</div>`;
}
