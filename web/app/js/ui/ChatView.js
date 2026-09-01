/**
 * ChatView.js — Renderiza la conversación.
 *
 * Las respuestas van acompañadas de Grace, la gotita de la Escuela Bíblica.
 * Solo sabe pintar mensajes. No sabe de red ni de estado global.
 */

import { createEl, scrollToBottom } from "../utils/dom.js";
import { escapeHtml } from "../utils/format.js";
import { renderSourceCard } from "./SourceCard.js";

/** Grace vive como <symbol> en el HTML; aquí solo se referencia. */
function graceAvatar(modifier = "") {
  return `<span class="grace grace--avatar ${modifier}" aria-hidden="true">
            <svg class="grace__svg" viewBox="0 0 64 80"><use href="#grace-drop" /></svg>
          </span>`;
}

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
   * Añade una respuesta del asistente.
   * Separado: explicación de la IA + cuadritos de fuente (audio / pasaje / video).
   * @param {{ answer: string, passage?: object, video?: object, excerpt?: string, source?: string }} response
   * @returns {HTMLElement} El nodo del mensaje (para enganchar acciones).
   */
  addBotMessage(response) {
    const hasAnswer = Boolean(response.answer?.trim());
    const sources = renderSourceCard(response);
    const showLabel = Boolean(sources);
    const answerBlock = hasAnswer
      ? `<div class="msg__bubble msg__bubble--answer">
           ${showLabel ? `<p class="msg__label">Explicación</p>` : ""}
           <p class="msg__answer">${escapeHtml(response.answer)}</p>
         </div>`
      : "";

    const el = createEl("div", {
      className: "msg msg--bot",
      html: `${graceAvatar()}<div class="msg__stack">${answerBlock}${sources}</div>`,
    });

    this.#append(el);
    return el;
  }

  /** Muestra los tres puntos de "escribiendo…". */
  showTyping() {
    this.#typingEl = createEl("div", {
      className: "msg msg--bot",
      html: `
        ${graceAvatar("grace--thinking")}
        <div class="msg__stack">
          <div class="msg__bubble msg__bubble--bare">
            <div class="typing"><span></span><span></span><span></span></div>
          </div>
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
