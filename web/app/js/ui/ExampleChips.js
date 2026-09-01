/**
 * ExampleChips.js — Preguntas de ejemplo para quien no sabe por dónde empezar.
 *
 * Se ocultan en cuanto la persona hace su primera pregunta.
 */

import { qs, createEl } from "../utils/dom.js";

export class ExampleChips {
  #container;
  #chipsRoot;

  /**
   * @param {HTMLElement} container Bloque completo (se oculta entero).
   * @param {string[]} questions
   * @param {(question: string) => void} onPick
   */
  constructor(container, questions, onPick) {
    this.#container = container;
    this.#chipsRoot = qs("[data-chips]", container);

    this.#render(questions, onPick);
  }

  #render(questions, onPick) {
    for (const question of questions) {
      const chip = createEl("button", { className: "chip" });
      chip.type = "button";
      chip.textContent = question;
      chip.addEventListener("click", () => onPick(question));

      this.#chipsRoot.appendChild(chip);
    }
  }

  hide() {
    this.#container.hidden = true;
  }
}
