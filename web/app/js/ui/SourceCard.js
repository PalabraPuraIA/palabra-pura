/**
 * SourceCard.js — Versículos (TLA / Reina-Valera) y video de la enseñanza.
 */

import {
  escapeHtml,
  formatTimestamp,
  buildYouTubeUrl,
  isPlayableYouTubeId,
} from "../utils/format.js";
import {
  getPreferredBibleVersion,
  versionIdFromLabel,
} from "../utils/bibleVersion.js";

const PLAY_ICON = `<svg viewBox="0 0 24 24" fill="none"><path d="M9 8.5v7l6-3.5-6-3.5Z" fill="currentColor"/></svg>`;
const CTA_ICON = `<svg viewBox="0 0 24 24" fill="none"><path d="M8 5v14l11-7L8 5Z" fill="currentColor"/></svg>`;

const isDemoVideo = (video) => String(video?.youtube_id ?? "").startsWith("DEMO");

/** @param {object} passage */
function passageVersions(passage) {
  if (Array.isArray(passage?.versions) && passage.versions.length) {
    return passage.versions.map((v) => ({
      id: v.id || versionIdFromLabel(v.bible_version),
      label: shortLabel(v.bible_version || v.id),
      text: v.text || "",
    }));
  }
  if (passage?.text) {
    const id = versionIdFromLabel(passage.bible_version);
    return [
      {
        id,
        label: shortLabel(passage.bible_version || id),
        text: passage.text,
      },
    ];
  }
  return [];
}

function shortLabel(name) {
  const id = versionIdFromLabel(name);
  if (id === "tla") return "TLA";
  if (id === "rva") return "Reina-Valera";
  return String(name || "Biblia");
}

function renderPassage(passage, demo, label = "Pasaje bíblico", preferred) {
  if (!passage?.reference) return "";

  const versions = passageVersions(passage).filter((v) => v.text);
  if (!versions.length) return "";

  const activeId =
    versions.find((v) => v.id === preferred)?.id || versions[0].id;

  const blocks = versions
    .map((v) => {
      const hidden = v.id === activeId ? "" : " hidden";
      const badge = demo
        ? `<span class="source__badge">ejemplo</span>`
        : `<span class="source__badge">${escapeHtml(v.label)}</span>`;
      return `
      <div class="source__version${v.id === activeId ? " source__version--active" : ""}" data-version="${escapeHtml(v.id)}"${hidden}>
        ${badge}
        <p class="source__text">“${escapeHtml(v.text)}”</p>
      </div>`;
    })
    .join("");

  return `
    <article class="source__block source__verse">
      <p class="source__label">${escapeHtml(label)}</p>
      <p class="source__ref">${escapeHtml(passage.reference)}</p>
      ${blocks}
    </article>`;
}

function renderVersionTabs(availableIds, preferred) {
  if (availableIds.length < 2) return "";

  const tabs = [
    { id: "tla", label: "TLA" },
    { id: "rva", label: "Reina-Valera" },
  ]
    .filter((t) => availableIds.includes(t.id))
    .map((t) => {
      const active = t.id === preferred;
      return `<button
        type="button"
        class="source__tab${active ? " source__tab--active" : ""}"
        data-bible-version="${t.id}"
        aria-pressed="${active ? "true" : "false"}"
      >${t.label}</button>`;
    })
    .join("");

  return `<div class="source__tabs" role="group" aria-label="Versión de la Biblia">${tabs}</div>`;
}

function renderPassages(passage, passages, demo) {
  const list =
    Array.isArray(passages) && passages.length
      ? passages
      : passage?.reference
        ? [passage]
        : [];

  if (!list.length) return "";

  const preferred = getPreferredBibleVersion();
  const available = new Set();
  for (const p of list) {
    for (const v of passageVersions(p)) {
      if (v.text) available.add(v.id);
    }
  }
  const availableIds = [...available];
  const active =
    availableIds.includes(preferred) ? preferred : availableIds[0] || "tla";

  const cards = list
    .map((p, i) =>
      renderPassage(
        p,
        demo,
        list.length > 1 ? `Versículo ${i + 1}` : "Versículo",
        active,
      ),
    )
    .join("");

  const tabs = renderVersionTabs(availableIds, active);

  return `
    <section class="source__panel source__panel--verses" aria-label="Versículos" data-bible-panel>
      <div class="source__panel-head">
        <h3 class="source__panel-title">Versículos</h3>
        ${tabs}
      </div>
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
