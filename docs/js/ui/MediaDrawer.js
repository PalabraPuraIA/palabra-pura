/**
 * MediaDrawer.js — En celular, video y artículos viven en un cajón derecho.
 * La flecha del borde titila cuando hay enseñanza; no usamos el FAB.
 */

import { isPhone, setMediaOpen, syncShell } from "./shellState.js?v=fit-2";

export class MediaDrawer {
  #handle;

  constructor() {
    this.#handle = document.querySelector("[data-resize=media]");
    document.querySelector("[data-media-close]")?.addEventListener("click", () => {
      setMediaOpen(false);
    });
    document.querySelector("[data-media-backdrop]")?.addEventListener("click", () => {
      setMediaOpen(false);
    });
    this.hide();
  }

  /** En celular, la flecha derecha avisa que hay video o artículos. */
  reveal({ hasVideo = false } = {}) {
    if (!this.#handle) {
      syncShell();
      return;
    }
    this.#handle.classList.add("is-live");
    this.#handle.classList.toggle("is-ready", Boolean(hasVideo));
    syncShell();
  }

  hide() {
    this.#handle?.classList.remove("is-live", "is-ready");
    if (isPhone()) setMediaOpen(false);
    else syncShell();
  }
}
