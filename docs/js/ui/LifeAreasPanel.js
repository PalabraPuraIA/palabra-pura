/**
 * LifeAreasPanel.js — Promesas y versículos por área (franja horizontal).
 */

import { escapeHtml } from "../utils/format.js";

function truncate(text, max = 140) {
  const t = String(text ?? "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trim()}…`;
}

export class LifeAreasPanel {
  #root;
  #list;
  #empty;
  #status;
  #onAsk;
  #areas = [];

  /** @param {HTMLElement} root @param {(question:string)=>void} onAsk */
  constructor(root, onAsk) {
    this.#root = root;
    this.#list = root.querySelector("[data-life-list]");
    this.#empty = root.querySelector("[data-life-empty]");
    this.#status = root.querySelector("[data-life-status]");
    this.#onAsk = onAsk;
  }

  showLoading() {
    this.#status.hidden = false;
    this.#status.textContent = "Cargando promesas y versículos…";
    this.#list.innerHTML = "";
    this.#empty.hidden = true;
  }

  /**
   * @param {Array<{id:string,label:string,promise:string,verses:Array<{reference:string,title:string,text:string}>}>} areas
   * @param {string|null} [activeId]
   */
  render(areas, activeId = null) {
    this.#areas = areas ?? [];
    this.#status.hidden = true;

    if (!this.#areas.length) {
      this.#list.innerHTML = "";
      this.#empty.hidden = false;
      return;
    }

    this.#empty.hidden = true;
    this.#list.innerHTML = this.#areas
      .map((area) => {
        const activeClass = area.id === activeId ? " life-card--active" : "";
        const featured = area.verses?.[0];
        const extra = (area.verses || []).slice(1, 3)
          .map(
            (v) => `
            <li class="life-card__verse life-card__verse--mini">
              <span class="life-card__ref">${escapeHtml(v.reference)}</span>
              <span class="life-card__verse-title">${escapeHtml(v.title)}</span>
            </li>`,
          )
          .join("");

        return `
        <article class="life-card${activeClass}" data-life-area="${escapeHtml(area.id)}">
          <p class="life-card__kicker">Área de vida</p>
          <h3 class="life-card__title">${escapeHtml(area.label)}</h3>
          <p class="life-card__promise">${escapeHtml(area.promise)}</p>
          ${
            featured
              ? `<div class="life-card__featured">
                  <span class="life-card__badge">TLA</span>
                  <span class="life-card__ref">${escapeHtml(featured.reference)}</span>
                  <span class="life-card__verse-title">${escapeHtml(featured.title)}</span>
                  ${featured.text ? `<p class="life-card__text">“${escapeHtml(truncate(featured.text, 180))}”</p>` : ""}
                </div>`
              : ""
          }
          ${extra ? `<ul class="life-card__more">${extra}</ul>` : ""}
          <button type="button" class="life-card__ask" data-life-ask="${escapeHtml(area.id)}">
            Preguntar sobre ${escapeHtml(area.label.toLowerCase())}
          </button>
        </article>`;
      })
      .join("");

    this.#list.querySelectorAll("[data-life-ask]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.lifeAsk;
        const area = this.#areas.find((a) => a.id === id);
        if (!area) return;
        this.#onAsk(`¿Qué enseña el ministerio sobre ${area.label.toLowerCase()}?`);
      });
    });

    if (activeId) this.highlight(activeId);
  }

  highlight(activeId) {
    if (!activeId) return;
    const card = this.#list.querySelector(`[data-life-area="${activeId}"]`);
    if (!card) return;
    this.#list.querySelectorAll("[data-life-area]").forEach((el) => {
      el.classList.toggle("life-card--active", el.dataset.lifeArea === activeId);
    });
    card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }
}
