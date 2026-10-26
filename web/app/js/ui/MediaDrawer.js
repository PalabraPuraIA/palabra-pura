/**
 * MediaDrawer.js — En celular, video y artículos viven en un cajón derecho.
 */

import { isPhone, setMediaOpen, toggleMedia, syncShell } from "./shellState.js?v=fit-1";

export class MediaDrawer {
  #fab;

  constructor() {
    this.#fab = document.querySelector("[data-media-toggle]");
    document.querySelectorAll("[data-media-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => toggleMedia());
    });
    document.querySelector("[data-media-close]")?.addEventListener("click", () => {
      setMediaOpen(false);
    });
    document.querySelector("[data-media-backdrop]")?.addEventListener("click", () => {
      setMediaOpen(false);
    });
    this.hide();
  }

  /** En celular, el botón flotante aparece después de la primera respuesta. */
  reveal({ hasVideo = false } = {}) {
    if (!this.#fab) return;
    this.#fab.hidden = false;
    this.#fab.classList.toggle("is-live", Boolean(hasVideo));
    this.#fab.classList.remove("is-ready");
    void this.#fab.offsetWidth;
    this.#fab.classList.add("is-ready");
    syncShell();
  }

  hide() {
    if (this.#fab) {
      this.#fab.hidden = true;
      this.#fab.classList.remove("is-live", "is-ready");
    }
    if (isPhone()) setMediaOpen(false);
    else syncShell();
  }
}
