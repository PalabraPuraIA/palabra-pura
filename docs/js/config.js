/**
 * config.js — Configuración central de la aplicación.
 *
 * Pon aquí la URL de tu Edge Function para que la página
 * arranque ya conectada. Si la dejas vacía, funciona en
 * modo demostración y puedes conectarla desde la interfaz.
 */

export const config = {
  /**
   * En GitHub Pages el chat llama directo a la Edge Function de Supabase.
   * Proyecto: jkffgudzlcemapxprbws
   */
  endpoint:
    "https://jkffgudzlcemapxprbws.supabase.co/functions/v1/chatbot-iglesia-palabra-pura",

  /** Reserva por si el endpoint principal falla. */
  fallbackEndpoint:
    "https://jkffgudzlcemapxprbws.supabase.co/functions/v1/chatbot-iglesia-palabra-pura",

  /** Publishable / anon key del proyecto (pública). */
  publishableKey: "sb_publishable_WVH-EXfKrrBn9P8US9OA0w_Py4FSmzW",

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
   * Artículos públicos de la iglesia.
   * En el server local usa /api/articles; en GitHub Pages cae a WordPress directo.
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
  return Boolean(config.endpoint);
}
