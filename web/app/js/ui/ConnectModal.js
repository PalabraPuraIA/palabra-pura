/**
 * ConnectModal.js — Permite pegar la URL de la Edge Function sin tocar el código.
 *
 * Útil para el demo: enseñas la página en modo ejemplo y la
 * conectas en vivo cuando quieras.
 */

import { qs } from "../utils/dom.js";
import { config, setEndpoint, isConnected } from "../config.js";

export class ConnectModal {
  #modal;
  #input;
  #trigger;
  #dot;
  #label;

  /**
   * @param {HTMLElement} modal
   * @param {HTMLElement} trigger Botón que lo abre (la píldora de estado).
   */
  constructor(modal, trigger) {
    this.#modal = modal;
    this.#trigger = trigger;
    this.#input = qs("[data-modal-input]", modal);
    this.#dot = qs("[data-connect-dot]", trigger);
    this.#label = qs("[data-connect-label]", trigger);

    this.#bindEvents();
    this.#refreshStatus();
  }

  #bindEvents() {
    this.#trigger.addEventListener("click", () => this.#open());

    qs("[data-modal-cancel]", this.#modal)
      .addEventListener("click", () => this.#close());

    qs("[data-modal-save]", this.#modal)
      .addEventListener("click", () => this.#save());

    // Clic fuera de la tarjeta cierra el modal.
    this.#modal.addEventListener("click", (event) => {
      if (event.target === this.#modal) this.#close();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.#close();
    });
  }

  #open() {
    this.#input.value = config.endpoint;
    this.#modal.classList.add("modal--open");
    this.#input.focus();
  }

  #close() {
    this.#modal.classList.remove("modal--open");
  }

  #save() {
    setEndpoint(this.#input.value);
    this.#refreshStatus();
    this.#close();
  }

  /** Refleja en la píldora si estamos conectados o en demo. */
  #refreshStatus() {
    const connected = isConnected();

    this.#dot.classList.toggle("status-pill__dot--live", connected);
    this.#label.textContent = connected ? "Conectado" : "Demo · Conectar";
  }
}
