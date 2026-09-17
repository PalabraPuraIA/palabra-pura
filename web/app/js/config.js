/**
 * config.js — Configuración central de la aplicación.
 *
 * Orden de backends:
 *  1. Supabase nube (principal en GitHub Pages)
 *  2. Server Fintek / túnel (reserva si la nube falla)
 */

export const config = {
  /**
   * URL pública del contenedor Fintek (túnel) — reserva.
   * Si cambia al reiniciar el túnel, actualiza también docs/public-url.json.
   */
  serverBaseUrl: "",  // same-origin reserve when hosted in the container

  /** Endpoint principal: Edge Function en Supabase nube. */
  endpoint:
    "https://jkffgudzlcemapxprbws.supabase.co/functions/v1/chatbot-iglesia-palabra-pura",

  /** Alias de la nube (compatibilidad). */
  fallbackEndpoint:
    "https://jkffgudzlcemapxprbws.supabase.co/functions/v1/chatbot-iglesia-palabra-pura",

  /** Publishable / anon key del proyecto (pública). */
  publishableKey: "sb_publishable_WVH-EXfKrrBn9P8US9OA0w_Py4FSmzW",

  /** Proyecto Supabase (REST / analytics). */
  supabaseUrl: "https://jkffgudzlcemapxprbws.supabase.co",

  /** Preguntas de ejemplo que se muestran bajo el chat. */
  exampleQuestions: [
    "¿Qué significa nacer de nuevo?",
    "¿Cómo empiezo a orar?",
    "¿Qué son los dones espirituales?",
    "Tengo miedo, ¿qué dice Dios sobre eso?",
  ],

  /** Mensaje inicial del asistente. */
  welcomeMessage:
    "Hola, soy Blaze. Bienvenidos a la Escuela Bíblica de Palabra Pura. " +
    "Indícame qué pregunta tienes hoy, ¿cómo puedo guiarte?",

  /** Retardo simulado del modo demo, en milisegundos. */
  demoDelayMs: 800,

  /**
   * Artículos: WordPress directo; proxy del server solo de reserva.
   */
  articlesApiUrl: "/api/articles",
  wpPostsUrl: "https://iglesiapalabrapura.com/site/wp-json/wp/v2/posts",
  wpArticlesCategory: "50",
  articlesHubUrl: "https://iglesiapalabrapura.com/site/articulos/",
  articlesLimit: 5,
};

/** Cambia el endpoint en caliente (desde el modal de conexión). */
export function setEndpoint(url) {
  config.endpoint = (url || "").trim();
  return config.endpoint;
}

/** ¿Está conectado a un backend real? */
export function isConnected() {
  return Boolean(config.endpoint || config.serverBaseUrl || config.fallbackEndpoint);
}
