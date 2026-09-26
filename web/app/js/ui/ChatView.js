/**
 * ChatView.js — Renderiza la conversación.
 *
 * Las respuestas van acompañadas de Blaze, el fuego de la Escuela Bíblica.
 * Solo sabe pintar mensajes. No sabe de red ni de estado global.
 */

import { createEl, scrollToBottom } from "../utils/dom.js";
import { escapeHtml } from "../utils/format.js";
import { renderSourceCard } from "./SourceCard.js";

/** Logo animado de Blaze junto a cada respuesta. */
function blazeAvatar(modifier = "") {
  return `<span class="blaze blaze--avatar ${modifier}" aria-hidden="true">
            <img class="blaze__img" src="./assets/blaze-logo.png?v=spin2" alt="" width="34" height="34" />
          </span>`;
}

function normalizeSuggestion(item, index = 0) {
  if (typeof item === "string") {
    return {
      id: `s-${index}`,
      label: item,
      ask: item,
    };
  }
  if (!item || typeof item !== "object") return null;
  const label = String(item.label || item.title || item.ask || "").trim();
  if (!label) return null;
  return {
    id: String(item.id || `s-${index}`),
    label,
    title: item.title || label,
    preview: item.preview || item.excerpt || "",
    ask: item.ask || label,
    answer: item.answer || "",
    excerpt: item.excerpt || item.preview || "",
    video: item.video || null,
    source: item.source || (item.video ? "video" : undefined),
  };
}

function renderSuggestions(suggestions) {
  const items = (Array.isArray(suggestions) ? suggestions : [])
    .map((s, i) => normalizeSuggestion(s, i))
    .filter(Boolean);
  if (!items.length) return "";

  const options = items
    .map((item, i) => {
      const hint = item.preview
        ? ` — ${escapeHtml(String(item.preview).slice(0, 72))}${item.preview.length > 72 ? "…" : ""}`
        : "";
      return `<option value="${i}">${escapeHtml(item.label)}${hint}</option>`;
    })
    .join("");

  const payload = encodeURIComponent(JSON.stringify(items));

  return `
    <div class="msg__suggestions" data-suggest-box>
      <p class="msg__suggest-label">Contenido que te puede interesar</p>
      <div class="msg__suggest-dropdown">
        <button type="button" class="msg__suggest-toggle" data-suggest-toggle aria-expanded="false">
          Ver opciones similares
          <span class="msg__suggest-caret" aria-hidden="true">▾</span>
        </button>
        <div class="msg__suggest-panel" hidden>
          <label class="msg__suggest-select-label">
            Elige un tema o enseñanza:
          </label>
          <select class="msg__suggest-select" data-suggest-select data-suggest-items="${payload}">
            <option value="">Selecciona una opción…</option>
            ${options}
          </select>
          <button type="button" class="msg__suggest-go" data-suggest-go disabled>
            Mostrar contenido
          </button>
        </div>
      </div>
    </div>`;
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
   * Separado: explicación breve de la IA + recorte de audio + pasaje + video + sugerencias.
   * @returns {HTMLElement}
   */
  addBotMessage(response) {
    const hasAnswer = Boolean(response.answer?.trim());
    const sources = renderSourceCard(response);
    const tips = renderSuggestions(response.suggestions);
    const showLabel = Boolean(sources) || hasAnswer;
    const isVideo = response.source === "video" && response.video;
    const hasVerses = Boolean(response.passage?.reference || response.passages?.length);
    const lifePromise = response.lifeArea?.promise
      ? `<p class="msg__life-promise"><strong>${escapeHtml(response.lifeArea.label)}:</strong> ${escapeHtml(response.lifeArea.promise)}</p>`
      : "";
    const answerLabel = isVideo ? "En pocas palabras" : "Explicación";
    const answerHint =
      isVideo && response.excerpt
        ? `<p class="msg__hint">Resumen corto.</p>`
        : isVideo && hasVerses
          ? `<p class="msg__hint">Lo que enseñó el pastor, con versículos y el video abajo.</p>`
          : tips
            ? `<p class="msg__hint">Abre el menú y elige un contenido relacionado.</p>`
            : "";

    const answerBlock = hasAnswer
      ? `<div class="msg__bubble msg__bubble--answer">
           ${showLabel ? `<p class="msg__label">${answerLabel}</p>` : ""}
           ${answerHint}
           ${lifePromise}
           <p class="msg__answer">${escapeHtml(response.answer)}</p>
           ${tips}
           <p class="msg__lens">Enseñanza bajo la dispensación de la gracia.</p>
         </div>`
      : tips
        ? `<div class="msg__bubble msg__bubble--answer">${tips}</div>`
        : "";

    const el = createEl("div", {
      className: "msg msg--bot",
      html: `${blazeAvatar()}<div class="msg__stack">${answerBlock}${sources}</div>`,
    });

    this.#append(el);
    return el;
  }

  /** Muestra los tres puntos de "escribiendo…". */
  showTyping() {
    this.#typingEl = createEl("div", {
      className: "msg msg--bot",
      html: `
        ${blazeAvatar("blaze--thinking")}
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
