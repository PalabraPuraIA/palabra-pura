/**
 * ArticleService.js — Busca artículos públicos en el WordPress de la iglesia.
 *
 * En GitHub Pages no existe /api/articles, así que consulta WP directo
 * (CORS ya permite palabrapuraia.github.io). Si hay proxy local, lo usa primero.
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

const TERM_SYNONYMS = {
  orar: ["oracion", "oración", "orar"],
  oracion: ["oracion", "oración", "orar"],
  miedo: ["miedo", "temor", "confianza", "fe"],
  temor: ["temor", "miedo", "fe"],
  fe: ["fe", "confianza", "creer"],
  nacer: ["nacer", "nuevo", "salvacion"],
  dones: ["dones", "espiritu", "carisma"],
  sanidad: ["sanidad", "sanar", "milagro"],
};

const MIN_ARTICLE_SCORE = 5;

const WP_POSTS_URL =
  config.wpPostsUrl || "https://iglesiapalabrapura.com/site/wp-json/wp/v2/posts";
const WP_CATEGORY = config.wpArticlesCategory || "50";

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

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#8211;/g, "–")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function countTerm(haystack, term) {
  if (term.length < 3) return 0;
  const root = term.length > 5 ? term.slice(0, -1) : term;
  const matches = haystack.match(new RegExp(`\\b${root}`, "g"));
  return matches ? matches.length : 0;
}

function scoreArticle(post, terms, matchedQueries) {
  const title = normalizeText(post.title);
  const body = normalizeText(post.excerpt);
  let score = 0;
  for (const term of terms) {
    if (countTerm(title, term)) score += 5;
    score += Math.min(countTerm(body, term), 4);
  }
  for (const query of matchedQueries) {
    if (terms.includes(query)) continue;
    if (countTerm(title, query)) score += 3;
    score += Math.min(countTerm(body, query), 2);
  }
  return score;
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
  if (title === "testimonios" || /^testimonios\s*\d*$/i.test(title)) return false;
  return true;
}

function mapWpPost(post) {
  return {
    id: post.id,
    title: stripHtml(post.title?.rendered ?? post.title ?? "Artículo"),
    excerpt: stripHtml(post.excerpt?.rendered ?? post.excerpt ?? ""),
    link: post.link,
    date: post.date ? String(post.date).slice(0, 10) : "",
  };
}

async function fetchWpPosts(search, perPage = 6) {
  const url = new URL(WP_POSTS_URL);
  url.searchParams.set("search", search);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("categories", WP_CATEGORY);
  url.searchParams.set("orderby", "relevance");
  url.searchParams.set("_fields", "id,date,title,link,excerpt");

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`WP HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? data.map(mapWpPost) : [];
}

async function recommendFromWordpress(question, limit) {
  const terms = extractSearchTerms(question);
  const base = terms.length
    ? terms.slice(0, 4)
    : [String(question || "").trim()].filter(Boolean);
  const queries = [];
  for (const term of base) {
    for (const q of TERM_SYNONYMS[term] || [term]) {
      if (!queries.includes(q)) queries.push(q);
    }
  }

  const byId = new Map();
  for (const term of queries.slice(0, 6)) {
    try {
      const posts = await fetchWpPosts(term, Math.max(limit + 3, 6));
      for (const post of posts) {
        if (!isUsefulArticle(post)) continue;
        const known = byId.get(post.id);
        if (known) known.matched.add(normalizeText(term));
        else byId.set(post.id, { post, matched: new Set([normalizeText(term)]) });
      }
    } catch (err) {
      console.warn("[ArticleService] wp", term, err);
    }
  }

  const normalizedTerms = base.map(normalizeText);
  return [...byId.values()]
    .map(({ post, matched }) => ({
      post,
      score: scoreArticle(post, normalizedTerms, matched),
    }))
    .filter((entry) => entry.score >= MIN_ARTICLE_SCORE)
    .sort(
      (a, b) =>
        b.score - a.score || String(b.post.date).localeCompare(String(a.post.date)),
    )
    .slice(0, limit)
    .map(({ post }) => post);
}

async function recommendFromProxy(question, limit) {
  const terms = extractSearchTerms(question);
  const q = terms.slice(0, 4).join(" ") || String(question ?? "").trim();
  if (!q) return [];

  const url = new URL(config.articlesApiUrl, window.location.origin);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = await response.json();
  return (Array.isArray(data?.articles) ? data.articles : Array.isArray(data) ? data : [])
    .map(normalizePost)
    .filter(isUsefulArticle)
    .slice(0, limit);
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

    let articles = [];
    try {
      articles = await recommendFromProxy(question, limit);
    } catch (_) {
      articles = [];
    }

    if (!articles.length) {
      try {
        articles = await recommendFromWordpress(question, limit);
      } catch (error) {
        console.warn("[ArticleService]", error);
        articles = [];
      }
    }

    this.#cache.set(cacheKey, articles);
    return articles;
  }
}
