/**
 * WorkspaceSplit.js — En PC, arrastra el borde para cambiar el ancho
 * o haz clic en la flecha para abrir/cerrar. En celular, la flecha
 * derecha abre el cajón de enseñanza.
 */

import { isNavDrawer, isPhone, toggleMedia, toggleNav } from "./shellState.js?v=fit-2";

const KEY = "pp-split-v1";
const NAV_MIN = 200;
const NAV_MAX = 420;
const MEDIA_MIN = 260;
const MEDIA_MAX = 560;
const DRAG_PX = 6;

export class WorkspaceSplit {
  constructor() {
    this.#restore();
    document.querySelectorAll("[data-resize]").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => this.#start(event, handle.dataset.resize));
      handle.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        this.#toggle(handle.dataset.resize);
      });
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
    const root = document.documentElement;
    root.style.setProperty("--nav-w", `${nav}px`);
    root.style.setProperty("--media-w", `${media}px`);
  }

  #toggle(which) {
    if (which === "nav") toggleNav();
    if (which === "media") toggleMedia();
  }

  #start(event, which) {
    if (event.button != null && event.button !== 0) return;
    if (which === "nav" && isNavDrawer()) return;

    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startNav = document.querySelector("[data-nav]")?.getBoundingClientRect().width || 280;
    const startMedia = document.querySelector("[data-media]")?.getBoundingClientRect().width || 360;
    const canResize = !(which === "media" && isPhone());
    let dragged = false;

    const move = (moveEvent) => {
      if (!canResize) return;
      const dx = moveEvent.clientX - startX;
      if (!dragged && Math.abs(dx) < DRAG_PX) return;
      if (!dragged) {
        dragged = true;
        if (which === "nav") document.body.classList.remove("nav-collapsed");
        if (which === "media") document.body.classList.remove("media-collapsed");
        handle.classList.add("is-dragging");
        document.body.classList.add("is-resizing");
      }
      const sizes = this.#read();
      if (which === "nav") sizes.nav = clamp(startNav + dx, NAV_MIN, NAV_MAX);
      if (which === "media") sizes.media = clamp(startMedia - dx, MEDIA_MIN, MEDIA_MAX);
      this.#apply(sizes);
      this.#save(sizes);
    };

    const stop = () => {
      handle.classList.remove("is-dragging");
      document.body.classList.remove("is-resizing");
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", stop, true);
      document.removeEventListener("pointercancel", stop, true);
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
      if (!dragged) this.#toggle(which);
    };

    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", stop, true);
    document.addEventListener("pointercancel", stop, true);
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* document listeners already cover the drag */
    }
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(value)));
}
