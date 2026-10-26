/**
 * WorkspaceSplit.js — En PC, arrastra el borde para cambiar el ancho
 * del historial y de la columna de video/artículos.
 */

import { isNavDrawer, isPhone } from "./shellState.js?v=chat-shell-5";

const KEY = "pp-split-v1";
const NAV_MIN = 200;
const NAV_MAX = 420;
const MEDIA_MIN = 260;
const MEDIA_MAX = 560;

export class WorkspaceSplit {
  constructor() {
    this.#restore();
    document.querySelectorAll("[data-resize]").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => this.#start(event, handle.dataset.resize));
    });
    window.addEventListener("resize", () => this.#apply(this.#read()));
  }

  #read() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "{}");
    } catch {
      return {};
    }
  }

  #save(next) {
    localStorage.setItem(KEY, JSON.stringify(next));
  }

  #restore() {
    this.#apply(this.#read());
  }

  #apply(sizes) {
    const nav = clamp(Number(sizes.nav) || 280, NAV_MIN, NAV_MAX);
    const media = clamp(Number(sizes.media) || 360, MEDIA_MIN, MEDIA_MAX);
    document.documentElement.style.setProperty("--nav-w", `${nav}px`);
    document.documentElement.style.setProperty("--media-w", `${media}px`);
  }

  #start(event, which) {
    if (which === "nav" && isNavDrawer()) return;
    if (which === "media" && isPhone()) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startNav = document.querySelector("[data-nav]")?.getBoundingClientRect().width || 280;
    const startMedia = document.querySelector("[data-media]")?.getBoundingClientRect().width || 360;
    handle.classList.add("is-dragging");
    handle.setPointerCapture?.(event.pointerId);

    const move = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const sizes = this.#read();
      if (which === "nav") sizes.nav = clamp(startNav + dx, NAV_MIN, NAV_MAX);
      if (which === "media") sizes.media = clamp(startMedia - dx, MEDIA_MIN, MEDIA_MAX);
      this.#apply(sizes);
      this.#save(sizes);
    };

    const stop = () => {
      handle.classList.remove("is-dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(value)));
}
