/**
 * config.js — Configuración central de la aplicación.
 *
 * Entornos:
 * - Server Fintek / Docker (:8088): same-origin → /api/chat
 * - GitHub Pages: Edge Function Supabase (chat). El panel admin necesita
 *   el túnel Fintek vía public-url.json (no hardcodear trycloudflare).
 */

const isGitHubPages =
  typeof location !== "undefined" && /github\.io$/i.test(location.hostname);

/** Proyecto Supabase canónico (Palabra Pura). */
export const SUPABASE_PROJECT = "jkffgudzlcemapxprbws";
export const SUPABASE_URL = `https://${SUPABASE_PROJECT}.supabase.co`;
export const SUPABASE_CHAT_FN = `${SUPABASE_URL}/functions/v1/chatbot-iglesia-palabra-pura`;

export const config = {
  /**
   * Base del API Fintek cuando el front está en Pages.
   * Vacío a propósito: se resuelve en runtime con ./public-url.json
   * (watchdog del túnel). Solo usa un valor fijo en emergencias locales.
   */
  fintekBaseUrl: "",
  serverBaseUrl: "",

  endpoint: isGitHubPages ? SUPABASE_CHAT_FN : "/api/chat",

  fallbackEndpoint: SUPABASE_CHAT_FN,

  publishableKey: "sb_publishable_WVH-EXfKrrBn9P8US9OA0w_Py4FSmzW",

  supabaseUrl: SUPABASE_URL,

  exampleQuestions: [
    "¿Qué significa nacer de nuevo?",
    "¿Cómo empiezo a orar?",
    "¿Qué son los dones espirituales?",
    "Tengo miedo, ¿qué dice Dios sobre eso?",
  ],

  welcomeMessage:
    "Hola, soy Blaze. Bienvenidos a la Escuela Bíblica de Palabra Pura. " +
    "Indícame qué pregunta tienes hoy, ¿cómo puedo guiarte?",

  demoDelayMs: 800,

  lifeAreasApiUrl: "/api/life-areas",
  articlesApiUrl: "/api/articles",
  wpPostsUrl: "https://iglesiapalabrapura.com/site/wp-json/wp/v2/posts",
  wpArticlesCategory: "50",
  articlesHubUrl: "https://iglesiapalabrapura.com/site/articulos/",
  articlesLimit: 5,
};

export function setEndpoint(url) {
  config.endpoint = (url || "").trim();
  return config.endpoint;
}

export function isConnected() {
  return Boolean(config.endpoint || config.serverBaseUrl || config.fallbackEndpoint);
}
