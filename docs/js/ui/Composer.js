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
