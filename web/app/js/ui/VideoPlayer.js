/**
 * VideoPlayer.js — Panel debajo del chat para reproducir el video citado.
 *
 * Cuando la respuesta trae un youtube_id real, carga el embed
 * en el minuto exacto. Si es demo / sin video, muestra estado vacío.
 */

import { escapeHtml, formatTimestamp, buildYouTubeEmbedUrl, isPlayableYouTubeId } from "../utils/format.js";

export class VideoPlayer {
  #root;
  #frame;
  #meta;
  #empty;
  #stage;
  #currentKey = "";

  /** @param {HTMLElement} root */
  constructor(root) {
    this.#root = root;
    this.#frame = root.querySelector("[data-player-frame]");
    this.#meta = root.querySelector("[data-player-meta]");
    this.#empty = root.querySelector("[data-player-empty]");
    this.#stage = root.querySelector("[data-player-stage]");
  }

  /**
   * Carga (o actualiza) el video de una respuesta.
   * @param {{ title?: string, episode?: number, youtube_id?: string, start_second?: number } | null | undefined} video
   * @param {{ autoplay?: boolean }} [opts]
   */
  load(video, { autoplay = false } = {}) {
    if (!video?.youtube_id) {
      this.clear();
      return;
    }

    if (!isPlayableYouTubeId(video.youtube_id)) {
      this.#showDemoNotice(video);
      return;
    }

    const start = video.start_second ?? 0;
    const key = `${video.youtube_id}:${start}:${autoplay ? 1 : 0}`;
    if (key === this.#currentKey) {
      this.#root.hidden = false;
      this.#scrollIntoView();
      return;
    }
    this.#currentKey = key;

    const embed = buildYouTubeEmbedUrl(video.youtube_id, start, { autoplay });
    this.#empty.hidden = true;
    this.#stage.hidden = false;
    this.#root.hidden = false;
    this.#root.dataset.hasVideo = "true";

    this.#frame.src = embed;
    this.#frame.title = video.title
      ? `Video: ${video.title}`
      : "Video de la enseñanza";

    const episode = video.episode ? `Episodio ${escapeHtml(video.episode)} · ` : "";
    const title = escapeHtml(video.title ?? "Enseñanza");
    this.#meta.innerHTML = `
      <p class="player__now">Reproduciendo</p>
      <p class="player__title">${episode}${title}</p>
      <p class="player__time">Desde ${formatTimestamp(start)}</p>
    `;

    this.#scrollIntoView();
  }

  clear() {
    this.#currentKey = "";
    this.#frame.removeAttribute("src");
    this.#meta.innerHTML = "";
    this.#stage.hidden = true;
    this.#empty.hidden = false;
    this.#empty.innerHTML = `
      <p class="player__empty-title">El video aparecerá aquí</p>
      <p class="player__empty-text">Cuando la respuesta cite una enseñanza, podrás verla en este espacio desde el minuto exacto.</p>
    `;
    this.#root.hidden = false;
    this.#root.dataset.hasVideo = "false";
  }

  #showDemoNotice(video) {
    this.#currentKey = `demo:${video.youtube_id}`;
    this.#frame.removeAttribute("src");
    this.#stage.hidden = true;
    this.#empty.hidden = false;
    this.#root.hidden = false;
    this.#root.dataset.hasVideo = "false";

    const title = escapeHtml(video.title ?? "Video de ejemplo");
    const start = formatTimestamp(video.start_second ?? 0);
    this.#empty.innerHTML = `
      <p class="player__empty-title">${title}</p>
      <p class="player__empty-text">
        En modo demostración no hay un video real que embeber
        (empezaría en ${start}). Conecta el chatbot para reproducir las enseñanzas aquí mismo.
      </p>
    `;
    this.#scrollIntoView();
  }

  #scrollIntoView() {
    // Solo si está fuera de vista; sin smooth para no pelear con el scroll del usuario.
    requestAnimationFrame(() => {
      const rect = this.#root.getBoundingClientRect();
      const inView = rect.top >= 72 && rect.bottom <= window.innerHeight - 24;
      if (inView) return;
      this.#root.scrollIntoView({ behavior: "auto", block: "nearest" });
    });
  }
}
