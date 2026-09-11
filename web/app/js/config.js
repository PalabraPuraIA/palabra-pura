/**
 * config.js — Configuración central de la aplicación.
 *
 * Pon aquí la URL de tu Edge Function para que la página
 * arranque ya conectada. Si la dejas vacía, funciona en
 * modo demostración y puedes conectarla desde la interfaz.
 */

export const config = {
  /**
   * Endpoint del chat. Por defecto same-origin: el mismo contenedor que sirve
   * la página responde en /api/chat (modo local con Postgres, o proxy).
   */
  endpoint: "/api/chat",

  /** Si /api/chat no existe (hosting estático), se usa la Edge Function. */
  fallbackEndpoint:
    "https://roxbekpxdgvqbosepmdd.supabase.co/functions/v1/chatbot-iglesia-palabra-pura",

  /** Publishable key (pública). Solo se usa con el fallback a Supabase. */
  publishableKey: "sb_publishable_be42gEb2YMLen6FWYrUbZg_rwhKDd65",

  /** Preguntas de ejemplo que se muestran bajo el chat. */
  exampleQuestions: [
    "¿Qué significa nacer de nuevo?",
    "¿Cómo empiezo a orar?",
    "¿Qué son los dones espirituales?",
    "Tengo miedo, ¿qué dice Dios sobre eso?",
  ],

  /** Mensaje inicial del asistente. */
  welcomeMessage:
    "Hola, soy Grace. Bienvenidos a la Escuela Bíblica de Palabra Pura. " +
    "Indícame qué pregunta tienes hoy, ¿cómo puedo guiarte?",

  /** Retardo simulado del modo demo, en milisegundos. */
  demoDelayMs: 800,

  /**
   * Artículos públicos de la iglesia.
   * Preferimos el proxy same-origin (/api/articles) para evitar CORS y
   * búsquedas vacías de WordPress con varias palabras.
   */
  articlesApiUrl: "/api/articles",
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
