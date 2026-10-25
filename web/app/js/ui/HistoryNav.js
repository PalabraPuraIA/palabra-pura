/**
 * HistoryNav.js — Menú izquierdo: historial + login, tipo chat de IA.
 */

import { listConversations } from "../data/conversations.js";
import { escapeHtml } from "../utils/format.js";

export class HistoryNav {
  #root;
  #list;
  #backdrop;
  #activeId = "";
  #onNew;
  #onSelect;

  /**
   * @param {HTMLElement} root
   * @param {{ onNew: () => void, onSelect: (id: string) => void }} handlers
   */
  constructor(root, handlers) {
    this.#root = root;
    this.#list = root.querySelector("[data-history-list]");
    this.#backdrop = document.querySelector("[data-nav-backdrop]");
    this.#onNew = handlers.onNew;
    this.#onSelect = handlers.onSelect;
    this.#bind();
    this.render();
  }

  #bind() {
    this.#root.querySelector("[data-new-chat]")?.addEventListener("click", () => {
      this.close();
      this.#onNew();
    });

    this.#list.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-history-id]");
      if (!btn) return;
      this.close();
      this.#onSelect(btn.dataset.historyId);
    });

    document.querySelectorAll("[data-nav-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => this.toggle());
    });
    this.#backdrop?.addEventListener("click", () => this.close());
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.close();
    });
  }

  setActive(id) {
    this.#activeId = String(id || "");
    this.render();
  }

  render() {
    const items = listConversations();
    if (!items.length) {
      this.#list.innerHTML = `<p class="nav__empty">Tus preguntas de esta conversación aparecerán aquí.</p>`;
      return;
    }
    this.#list.innerHTML = items
      .map((item) => {
        const active = item.id === this.#activeId ? " is-active" : "";
        return `<button type="button" class="nav__item${active}" data-history-id="${escapeHtml(item.id)}">${escapeHtml(item.title || "Conversación")}</button>`;
      })
      .join("");
  }

  toggle() {
    if (window.matchMedia("(max-width: 1100px)").matches) {
      document.body.classList.toggle("nav-open");
    } else {
      document.body.classList.toggle("nav-collapsed");
    }
    this.#syncBackdrop();
  }

  close() {
    document.body.classList.remove("nav-open");
    this.#syncBackdrop();
  }

  #syncBackdrop() {
    const open = document.body.classList.contains("nav-open");
    if (this.#backdrop) this.#backdrop.hidden = !open;
    document.querySelectorAll("[data-nav-toggle]").forEach((btn) => {
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }
}
