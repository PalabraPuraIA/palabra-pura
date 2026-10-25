/**
 * HistoryPanel.js — Lista de preguntas de esta conversación (columna derecha).
 */

import { escapeHtml } from "../utils/format.js";

export class HistoryPanel {
  #root;
  #list;
  #empty;
  #items = [];
  #onPick;

  /**
   * @param {HTMLElement} root
   * @param {(question: string) => void} [onPick]
   */
  constructor(root, onPick) {
    this.#root = root;
    this.#list = root.querySelector("[data-history-list]");
    this.#empty = root.querySelector("[data-history-empty]");
    this.#onPick = onPick;

    this.#list?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-history-ask]");
      if (!btn) return;
      const question = btn.getAttribute("data-history-ask") || btn.textContent || "";
      if (question && this.#onPick) this.#onPick(question);
    });
  }

  /** @param {string} question */
  add(question) {
    const q = String(question || "").trim();
    if (!q) return;
    this.#items = [{ question: q, at: Date.now() }, ...this.#items.filter((i) => i.question !== q)].slice(0, 40);
    this.#render();
  }

  /** @param {Array<{role?: string, content?: string}>} turns */
  loadFromTurns(turns) {
    const questions = [];
    for (const t of turns || []) {
      if (t?.role === "user" && t.content) questions.push(String(t.content).trim());
    }
    this.#items = [...new Set(questions.filter(Boolean))]
      .reverse()
      .slice(0, 40)
      .map((question) => ({ question, at: Date.now() }));
    this.#render();
  }

  #render() {
    if (!this.#list) return;
    if (!this.#items.length) {
      this.#list.innerHTML = "";
      if (this.#empty) this.#empty.hidden = false;
      return;
    }
    if (this.#empty) this.#empty.hidden = true;
    this.#list.innerHTML = this.#items
      .map(
        (item) => `
      <button type="button" class="history__item" data-history-ask="${escapeHtml(item.question)}">
        <span class="history__item-text">${escapeHtml(item.question)}</span>
      </button>`,
      )
      .join("");
  }
}
