/**
 * config.js — Configuración central de la aplicación.
 *
 * Prueba experimental: GitHub Pages → server Fintek (Ollama local).
 * Chat Gemini / Edge Function desconectado.
 * El hostname trycloudflare puede cambiar; docs/public-url.json lo refleja.
 */

const isGitHubPages =
  typeof location !== "undefined" && /github\.io$/i.test(location.hostname);

/** Proyecto Supabase (analytics / REST; no chat). */
export const SUPABASE_PROJECT = "jkffgudzlcemapxprbws";
export const SUPABASE_URL = `https://${SUPABASE_PROJECT}.supabase.co`;
export const SUPABASE_CHAT_FN = `${SUPABASE_URL}/functions/v1/chatbot-iglesia-palabra-pura`;

/** Túnel actual hacia server-fintek (también en public-url.json). */
const FINTEK_TUNNEL = "https://showing-leads-aim-angeles.trycloudflare.com";

export const config = {
  fintekBaseUrl: isGitHubPages ? FINTEK_TUNNEL : "",
  serverBaseUrl: isGitHubPages ? FINTEK_TUNNEL : "",

  /** Chat: Fintek local. En Docker, same-origin. */
  endpoint: isGitHubPages ? `${FINTEK_TUNNEL}/api/chat` : "/api/chat",

  /** Sin fallback a Gemini. */
  fallbackEndpoint: "",

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
