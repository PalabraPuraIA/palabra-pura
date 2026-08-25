/**
 * ArticleService.js — Busca artículos públicos en el WordPress de la iglesia.
 *
 * Usa el proxy local `/api/articles` (mismo origen). El servidor consulta WP
 * con términos sueltos (WP trata varias palabras como AND y a menudo
 * devuelve []).
 */

import { config } from "../config.js";

const STOPWORDS = new Set([
  "a", "al", "algo", "algun", "alguna", "algunas", "algunos", "ante", "antes",
  "como", "con", "contra", "cual", "cuando", "de", "del", "desde", "donde",
  "el", "ella", "ellas", "ellos", "en", "entre", "era", "es", "esa", "esas",
  "ese", "eso", "esos", "esta", "estas", "este", "esto", "estos", "ha", "hay",
  "la", "las", "le", "les", "lo", "los", "me", "mi", "mis", "muy", "no", "nos",
  "o", "para", "pero", "por", "porque", "que", "se", "si", "sin", "sobre",
  "su", "sus", "te", "tu", "tus", "un", "una", "unas", "unos", "y", "ya", "yo",
  "qué", "cómo", "cuál", "cuáles", "dónde", "quién", "quiénes", "dice", "dios",
  "significa", "puedo", "puede", "hacer", "tengo", "tiene", "ser", "son",
]);

/** Extrae términos útiles para la búsqueda WP. */
export function extractSearchTerms(question, maxTerms = 5) {
  const tokens = String(question ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));

  const unique = [...new Set(tokens)];
  unique.sort((a, b) => b.length - a.length);
  return unique.slice(0, maxTerms);
}

function normalizePost(post) {
  return {
    id: post.id,
    title: String(post.title ?? "Artículo").trim(),
    excerpt: String(post.excerpt ?? "").trim(),
    link: post.link,
    date: post.date ? String(post.date).slice(0, 10) : "",
  };
}

function isUsefulArticle(article) {
  const title = String(article.title || "").trim().toLowerCase();
  if (!title || !article.link) return false;
  // Muchos posts de la categoría son "TESTIMONIOS" genéricos.
  if (title === "testimonios" || /^testimonios\s*\d*$/i.test(title)) return false;
  return true;
}

export class ArticleService {
  #cache = new Map();

  /**
   * Recomienda artículos relacionados a la pregunta.
   * @param {string} question
   * @param {{ limit?: number }} [opts]
   * @returns {Promise<Array<{id:number,title:string,excerpt:string,link:string,date:string}>>}
   */
  async recommend(question, { limit = config.articlesLimit ?? 3 } = {}) {
    const terms = extractSearchTerms(question);
    const q = terms.slice(0, 4).join(" ") || String(question ?? "").trim();
    if (!q) return [];

    const cacheKey = `${q}|${limit}`;
    if (this.#cache.has(cacheKey)) return this.#cache.get(cacheKey);

    try {
      const url = new URL(config.articlesApiUrl, window.location.origin);
      url.searchParams.set("q", q);
      url.searchParams.set("limit", String(limit));

      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      const articles = (Array.isArray(data?.articles) ? data.articles : Array.isArray(data) ? data : [])
        .map(normalizePost)
        .filter(isUsefulArticle)
        .slice(0, limit);

      this.#cache.set(cacheKey, articles);
      return articles;
    } catch (error) {
      console.warn("[ArticleService]", error);
      return [];
    }
  }
}
