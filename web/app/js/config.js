/**
 * config.js — Configuración central de la aplicación.
 *
 * Pon aquí la URL de tu Edge Function para que la página
 * arranque ya conectada. Si la dejas vacía, funciona en
 * modo demostración y puedes conectarla desde la interfaz.
 */

export const config = {
  /** URL de tu Edge Function de Supabase. Ej:
   *  "https://oxlmqzheogkharxpqjwp.supabase.co/functions/v1/bright-action" */
  endpoint: "https://oxlmqzheogkharxpqjwp.supabase.co/functions/v1/chatbot-iglesia-palabra-pura",

  /** Preguntas de ejemplo que se muestran bajo el chat. */
  exampleQuestions: [
    "¿Qué significa nacer de nuevo?",
    "¿Cómo empiezo a orar?",
    "¿Qué son los dones espirituales?",
    "Tengo miedo, ¿qué dice Dios sobre eso?",
  ],

  /** Mensaje inicial del asistente. */
  welcomeMessage:
    "La paz sea contigo. Estoy aquí para acompañarte a entender la Palabra. " +
    "Puedes preguntarme lo que quieras, o empezar con uno de los ejemplos de abajo.",

  /** Retardo simulado del modo demo, en milisegundos. */
  demoDelayMs: 800,

  /**
   * Artículos públicos de la iglesia (WordPress REST, solo lectura).
   * Misma información publicada en /site/articulos/
   */
  articlesApiUrl: "https://iglesiapalabrapura.com/site/wp-json/wp/v2/posts",
  articlesHubUrl: "https://iglesiapalabrapura.com/site/articulos/",
  articlesLimit: 3,
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
