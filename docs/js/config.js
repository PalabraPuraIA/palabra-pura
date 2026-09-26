/**
 * config.js — Configuración central de la aplicación.
 *
 * - En el server Fintek (:8088): same-origin /api/chat (Postgres local).
 * - En GitHub Pages: Edge Function Supabase (misma nube).
 * Ambos deben verse igual; la info coincide cuando el server está en proxy
 * a la misma Edge, o cuando Pages usa el túnel hacia el server.
 */

const isGitHubPages =
  typeof location !== "undefined" && /github\.io$/i.test(location.hostname);

export const config = {
  fintekBaseUrl: isGitHubPages
    ? "https://earrings-balance-towers-bid.trycloudflare.com"
    : "",
  serverBaseUrl: "",

  endpoint: isGitHubPages
    ? "https://earrings-balance-towers-bid.trycloudflare.com/api/chat"
    : "/api/chat",

  fallbackEndpoint:
    "https://jkffgudzlcemapxprbws.supabase.co/functions/v1/chatbot-iglesia-palabra-pura",

  publishableKey: "sb_publishable_WVH-EXfKrrBn9P8US9OA0w_Py4FSmzW",

  supabaseUrl: "https://jkffgudzlcemapxprbws.supabase.co",

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
