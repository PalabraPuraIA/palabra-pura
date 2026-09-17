/**
 * ConnectModal.js — Muestra si el chat usa el server Fintek o Supabase nube.
 */

import { qs } from "../utils/dom.js";
import { config, setEndpoint, isConnected } from "../config.js";
import { resolveBackend } from "../services/backend.js";

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
    setInterval(() => this.#refreshStatus(), 30000);
  }

  #bindEvents() {
    this.#trigger.addEventListener("click", () => this.#open());

    qs("[data-modal-cancel]", this.#modal)
      .addEventListener("click", () => this.#close());

    qs("[data-modal-save]", this.#modal)
      .addEventListener("click", () => this.#save());

    this.#modal.addEventListener("click", (event) => {
      if (event.target === this.#modal) this.#close();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.#close();
    });
  }

  #open() {
    this.#input.value = config.serverBaseUrl || config.endpoint;
    this.#modal.classList.add("modal--open");
    this.#input.focus();
  }

  #close() {
    this.#modal.classList.remove("modal--open");
  }

  #save() {
    const value = this.#input.value.trim();
    if (/trycloudflare\.com|localhost|127\.0\.0\.1|10\./.test(value) && !/functions\/v1/.test(value)) {
      config.serverBaseUrl = value.replace(/\/+$/, "");
    } else {
      setEndpoint(value);
    }
    this.#refreshStatus(true);
    this.#close();
  }

  async #refreshStatus(force = false) {
    const connected = isConnected();
    this.#dot.classList.toggle("status-pill__dot--live", connected);
    if (!connected) {
      this.#label.textContent = "Demo · Conectar";
      return;
    }
    try {
      const backend = await resolveBackend({ force });
      this.#label.textContent =
        backend.mode === "server" ? "Reserva · Server" : "Nube · Supabase";
    } catch {
      this.#label.textContent = "Conectado";
    }
  }
}
