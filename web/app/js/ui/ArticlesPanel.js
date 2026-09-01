/**
 * ArticlesPanel.js — Lista de artículos recomendados (solo lectura / enlaces).
 */

import { escapeHtml } from "../utils/format.js";
import { config } from "../config.js";

export class ArticlesPanel {
  #root;
  #list;
  #empty;
  #status;

  /** @param {HTMLElement} root */
  constructor(root) {
    this.#root = root;
    this.#list = root.querySelector("[data-articles-list]");
    this.#empty = root.querySelector("[data-articles-empty]");
    this.#status = root.querySelector("[data-articles-status]");
  }

  showLoading() {
    this.#root.hidden = false;
    this.#list.innerHTML = "";
    this.#empty.hidden = true;
    this.#status.hidden = false;
    this.#status.textContent = "Buscando artículos relacionados…";
  }

  /**
   * @param {Array<{id:number,title:string,excerpt:string,link:string,date:string}>} articles
   * @param {string} [question]
   */
  render(articles, question = "") {
    this.#root.hidden = false;
    this.#status.hidden = true;

    if (!articles?.length) {
      this.#list.innerHTML = "";
      this.#empty.hidden = false;
      this.#empty.innerHTML = `
        <p class="articles__empty-title">Sin coincidencias claras ahora</p>
        <p class="articles__empty-text">
          Puedes explorar todos los artículos en
          <a href="${escapeHtml(config.articlesHubUrl)}" target="_blank" rel="noopener">
            iglesiapalabrapura.com
          </a>.
        </p>`;
      return;
    }

    this.#empty.hidden = true;
    const hint = question
      ? `<p class="articles__match">Relacionados con tu pregunta</p>`
      : "";

    this.#list.innerHTML =
      hint +
      articles
        .map(
          (a) => `
      <a class="articles__item" href="${escapeHtml(a.link)}" target="_blank" rel="noopener">
        <span class="articles__item-kicker">${a.date ? escapeHtml(a.date) : "Artículo"}</span>
        <span class="articles__item-title">${escapeHtml(a.title)}</span>
        ${
          a.excerpt
            ? `<span class="articles__item-excerpt">${escapeHtml(a.excerpt.slice(0, 160))}${
                a.excerpt.length > 160 ? "…" : ""
              }</span>`
            : ""
        }
        <span class="articles__item-cta">Leer en la web de la iglesia</span>
      </a>`,
        )
        .join("");
  }

  clear() {
    this.#list.innerHTML = "";
    this.#status.hidden = true;
    this.#empty.hidden = false;
    this.#empty.innerHTML = `
      <p class="articles__empty-title">Artículos relacionados</p>
      <p class="articles__empty-text">
        Cuando preguntes, te sugeriremos lecturas de
        <a href="${escapeHtml(config.articlesHubUrl)}" target="_blank" rel="noopener">
          la sección de artículos
        </a>
        de la Enciclopedia de Palabra Pura.
      </p>`;
    this.#root.hidden = false;
  }
}
