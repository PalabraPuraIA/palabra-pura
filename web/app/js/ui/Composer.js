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
    this.#fitChatToViewport();
    this.#keepBarVisible();
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

  /** Encaja el chat en la pantalla para que la barra no quede abajo, fuera de vista. */
  #fitChatToViewport() {
    const chat = this.#form.closest(".chat");
    if (!chat) return;
    const apply = () => {
      if (!window.matchMedia("(max-width: 640px)").matches) {
        chat.style.removeProperty("height");
        chat.style.removeProperty("max-height");
        return;
      }
      if (window.scrollY > 24) return;
      const top = chat.getBoundingClientRect().top;
      const room = Math.floor(window.innerHeight - top - 8);
      if (room < 280) return;
      chat.style.height = `${room}px`;
      chat.style.maxHeight = `${room}px`;
    };
    apply();
    window.addEventListener("resize", apply);
    window.visualViewport?.addEventListener("resize", apply);
  }

  /** En celular, el teclado no debe tapar ni desplazar la barra fuera de vista. */
  #keepBarVisible() {
    const form = this.#form;
    const input = this.#input;
    const phone = () => window.matchMedia("(max-width: 640px)").matches;

    const pin = () => {
      if (!phone()) {
        form.style.removeProperty("transform");
        return;
      }
      const vv = window.visualViewport;
      if (!vv || document.activeElement !== input) {
        form.style.removeProperty("transform");
        return;
      }
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      if (covered > 0) {
        form.style.transform = `translateY(-${covered}px)`;
      } else {
        form.style.removeProperty("transform");
      }
      form.scrollIntoView({ block: "end", inline: "nearest" });
    };

    input.addEventListener("focus", () => {
      pin();
      setTimeout(pin, 80);
      setTimeout(pin, 320);
    });
    input.addEventListener("blur", () => {
      form.style.removeProperty("transform");
    });
    window.visualViewport?.addEventListener("resize", pin);
    window.visualViewport?.addEventListener("scroll", pin);
  }

  #submit() {
    const question = this.#input.value.trim();
    if (!question) return;

    const scrollY = window.scrollY;
    this.#input.value = "";
    this.#autoResize();
    this.#onSubmit(question);
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
