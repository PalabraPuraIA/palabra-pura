/**
 * ChatView.js — Renderiza la conversación.
 *
 * Diseño minimalista: sin avatares, solo burbujas alineadas.
 * Solo sabe pintar mensajes. No sabe de red ni de estado global.
 */

import { createEl, scrollToBottom } from "../utils/dom.js";
import { escapeHtml } from "../utils/format.js";
import { renderSourceCard } from "./SourceCard.js";

export class ChatView {
  #root;
  #typingEl = null;

  /** @param {HTMLElement} root Contenedor donde viven los mensajes. */
  constructor(root) {
    this.#root = root;
  }

  /** Añade un mensaje de la persona. */
  addUserMessage(text) {
    const el = createEl("div", {
      className: "msg msg--user",
      html: `<div class="msg__bubble">${escapeHtml(text)}</div>`,
    });

    this.#append(el);
  }

  /**
   * Añade una respuesta del asistente, con su tarjeta de fuente.
   * @param {{ answer: string, passage?: object, video?: object }} response
   * @returns {HTMLElement} El nodo del mensaje (para enganchar acciones).
   */
  addBotMessage(response) {
    const el = createEl("div", {
      className: "msg msg--bot",
      html: `
        <div class="msg__bubble">
          ${escapeHtml(response.answer)}
          ${renderSourceCard(response)}
        </div>`,
    });

    this.#append(el);
    return el;
  }

  /** Muestra los tres puntos de "escribiendo…". */
  showTyping() {
    this.#typingEl = createEl("div", {
      className: "msg msg--bot",
      html: `
        <div class="msg__bubble msg__bubble--bare">
          <div class="typing"><span></span><span></span><span></span></div>
        </div>`,
    });

    this.#append(this.#typingEl);
  }

  /** Quita el indicador de escritura. */
  hideTyping() {
    this.#typingEl?.remove();
    this.#typingEl = null;
  }

  #append(el) {
    this.#root.appendChild(el);
    scrollToBottom(this.#root);
  }
}
