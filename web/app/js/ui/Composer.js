/**
 * Composer.js — El campo donde se escribe la pregunta.
 *
 * Emite la pregunta hacia afuera con un callback; no sabe
 * qué se hace con ella.
 */

import { qs } from "../utils/dom.js";

const MAX_HEIGHT_PX = 120;

export class Composer {
  #form;
  #input;
  #onSubmit;

  /**
   * @param {HTMLFormElement} form
   * @param {(question: string) => void} onSubmit
   */
  constructor(form, onSubmit) {
    this.#form = form;
    this.#input = qs("[data-input]", form);
    this.#onSubmit = onSubmit;

    this.#bindEvents();
    this.#syncViewport();
    this.#bindViewport();
  }

  #bindEvents() {
    this.#form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.#submit();
    });

    // Enter envía; Shift+Enter hace salto de línea.
    this.#input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.#submit();
      }
    });

    // El textarea crece con el contenido.
    this.#input.addEventListener("input", () => this.#autoResize());
  }

  /**
   * En iPhone el teclado no encoge la página: deja el recuadro debajo
   * y Safari arma otra barra. Encajamos el chat en el área visible.
   */
  #bindViewport() {
    const sync = () => this.#syncViewport();
    this.#input.addEventListener("focus", () => {
      sync();
      requestAnimationFrame(sync);
      setTimeout(sync, 80);
      setTimeout(sync, 280);
      setTimeout(sync, 520);
    });
    this.#input.addEventListener("blur", () => setTimeout(sync, 40));
    window.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("scroll", sync);
  }

  #syncViewport() {
    const chat = this.#form.closest(".chat");
    const app = document.querySelector(".app");
    const vv = window.visualViewport;
    const phone = window.matchMedia("(max-width: 900px)").matches;
    const focused = document.activeElement === this.#input;
    const root = document.documentElement;

    const clearKb = () => {
      document.body.classList.remove("kb-open");
      root.style.removeProperty("--vv-top");
      root.style.removeProperty("--vv-height");
      this.#form.style.removeProperty("transform");
    };

    if (!phone) {
      clearKb();
      chat?.style.removeProperty("height");
      chat?.style.removeProperty("max-height");
      return;
    }

    if (focused && vv) {
      const overlap = window.innerHeight - vv.height - vv.offsetTop;
      if (overlap >= 80) {
        root.style.setProperty("--vv-top", `${Math.max(0, Math.round(vv.offsetTop))}px`);
        root.style.setProperty("--vv-height", `${Math.round(vv.height)}px`);
        document.body.classList.add("kb-open");
        this.#form.style.removeProperty("transform");
        chat?.style.removeProperty("height");
        chat?.style.removeProperty("max-height");
        return;
      }
    }

    clearKb();
    if (!chat || !vv || window.scrollY > 24) return;
    const top = chat.getBoundingClientRect().top;
    const room = Math.floor(vv.height - top - 8);
    if (room < 280) return;
    chat.style.height = `${room}px`;
    chat.style.maxHeight = `${room}px`;
  }

  #submit() {
    const question = this.#input.value.trim();
    if (!question) return;

    const scrollY = window.scrollY;
    this.#input.value = "";
    this.#autoResize();
    this.#onSubmit(question);
    // En el celular, el teclado y el foco del botón mueven la página
    // hasta Promesas. Dejamos el chat donde estaba.
    const keep = () => {
      if (Math.abs(window.scrollY - scrollY) > 4) window.scrollTo(0, scrollY);
    };
    keep();
    requestAnimationFrame(keep);
    setTimeout(keep, 60);
  }

  #autoResize() {
    this.#input.style.height = "auto";
    this.#input.style.height = `${Math.min(this.#input.scrollHeight, MAX_HEIGHT_PX)}px`;
  }
}
