/**
 * VideoPlayer.js — Panel debajo del chat para reproducir el video citado
 * y, si hay tienda, mostrar el enlace al carrito en este mismo espacio.
 */

import { escapeHtml, formatTimestamp, buildYouTubeEmbedUrl, isPlayableYouTubeId } from "../utils/format.js";
import { renderShopOfferPanel } from "./shopCart.js?v=paid-cta-8";

export class VideoPlayer {
  #root;
  #frame;
  #meta;
  #empty;
  #stage;
  #shop;
  #label;
  #hint;
  #currentKey = "";

  /** @param {HTMLElement} root */
  constructor(root) {
    this.#root = root;
    this.#frame = root.querySelector("[data-player-frame]");
    this.#meta = root.querySelector("[data-player-meta]");
    this.#empty = root.querySelector("[data-player-empty]");
    this.#stage = root.querySelector("[data-player-stage]");
    this.#shop = root.querySelector("[data-player-shop]");
    this.#label = root.querySelector("[data-player-label]");
    this.#hint = root.querySelector("[data-player-hint]");
  }

  /**
   * Carga (o actualiza) el video de una respuesta y/o el carrito.
   * @param {{ title?: string, episode?: number, youtube_id?: string, start_second?: number } | null | undefined} video
   * @param {{ autoplay?: boolean, offer?: object, offers?: object[], hideVideo?: boolean }} [opts]
   */
  load(video, { autoplay = false, offer, offers, hideVideo = false } = {}) {
    const hasShop = this.#renderShop(offer, offers);
    const canPlay = Boolean(video?.youtube_id) && !hideVideo;

    if (!canPlay) {
      if (hasShop) {
        this.#showShopOnly();
        return;
      }
      this.clear();
      return;
    }

    if (!isPlayableYouTubeId(video.youtube_id)) {
      this.#showDemoNotice(video, hasShop);
      return;
    }

    const start = video.start_second ?? 0;
    const key = `${video.youtube_id}:${start}:${autoplay ? 1 : 0}:${hasShop ? 1 : 0}`;
    if (key === this.#currentKey) {
      this.#root.hidden = false;
      return;
    }
    this.#currentKey = key;

    const embed = buildYouTubeEmbedUrl(video.youtube_id, start, { autoplay });
    this.#empty.hidden = true;
    this.#stage.hidden = false;
    this.#root.hidden = false;
    this.#root.dataset.hasVideo = "true";
    this.#setHead(hasShop ? "Enseñanza" : "Enseñanza en video", hasShop
      ? "Video y enlace al carrito"
      : "Se abre cuando la respuesta cita un video");

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

  }

  clear() {
    this.#currentKey = "";
    this.#frame?.removeAttribute("src");
    if (this.#meta) this.#meta.innerHTML = "";
    if (this.#stage) this.#stage.hidden = true;
    if (this.#empty) this.#empty.hidden = true;
    if (this.#shop) {
      this.#shop.hidden = true;
      this.#shop.innerHTML = "";
    }
    this.#root.hidden = true;
    this.#root.dataset.hasVideo = "false";
    this.#setHead("Enseñanza en video", "Se abre cuando la respuesta cita un video");
  }

  #renderShop(offer, offers) {
    if (!this.#shop) return false;
    const html = renderShopOfferPanel(offer, offers, { variant: "player" });
    this.#shop.innerHTML = html;
    this.#shop.hidden = !html;
    this.#root.dataset.hasShop = html ? "true" : "false";
    return Boolean(html);
  }

  #showShopOnly() {
    this.#currentKey = `shop:${this.#shop?.textContent?.slice(0, 40) || "1"}`;
    this.#frame.removeAttribute("src");
    this.#meta.innerHTML = "";
    this.#stage.hidden = true;
    this.#empty.hidden = true;
    this.#empty.innerHTML = "";
    this.#root.hidden = false;
    this.#root.dataset.hasVideo = "false";
    this.#setHead("En la tienda", "Ábrela en el carrito de la iglesia");
  }

  #showDemoNotice(video, hasShop) {
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
    this.#setHead(hasShop ? "Enseñanza" : "Enseñanza en video", hasShop
      ? "Video y enlace al carrito"
      : "Se abre cuando la respuesta cita un video");
  }

  #setHead(label, hint) {
    if (this.#label) this.#label.textContent = label;
    if (this.#hint) this.#hint.textContent = hint;
  }
}
