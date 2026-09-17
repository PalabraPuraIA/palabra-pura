/**
 * demoResponses.js — Respuestas de ejemplo para el modo demostración.
 *
 * Solo se usan cuando NO hay endpoint configurado.
 * Los versículos son de la Reina-Valera 1909 (dominio público).
 */

export const demoResponses = {
  "¿Qué significa nacer de nuevo?": {
    answer:
      "Nacer de nuevo es un nuevo comienzo que Dios hace en tu interior por medio de su Espíritu. " +
      "No se trata de volver a nacer físicamente, sino de recibir una vida nueva: dejar atrás lo viejo " +
      "y empezar a vivir guiado por Él. Es el primer paso de todo el que decide seguir a Jesús.",
    passage: {
      reference: "Juan 3:6",
      text: "Lo que es nacido de la carne, carne es; y lo que es nacido del Espíritu, espíritu es.",
    },
    video: {
      title: "El nuevo nacimiento",
      episode: 3,
      youtube_id: "DEMO0000001",
      start_second: 132,
    },
  },

  "¿Cómo empiezo a orar?": {
    answer:
      "Orar es simplemente hablar con Dios, con tus propias palabras y en confianza. No necesitas frases " +
      "elaboradas: puedes agradecer, pedir, o solo contarle cómo estás. Busca un momento tranquilo, a solas, " +
      "y háblale como a un Padre que te escucha.",
    passage: {
      reference: "Salmos 145:18",
      text: "Cercano está Jehová á todos los que le invocan, á todos los que le invocan de veras.",
    },
    video: {
      title: "Aprendiendo a orar",
      episode: 7,
      youtube_id: "DEMO0000002",
      start_second: 220,
    },
  },

  "¿Qué son los dones espirituales?": {
    answer:
      "Son capacidades que Dios pone en cada creyente por medio de su Espíritu, para servir y edificar a los demás. " +
      "Todos recibimos alguno: enseñar, ayudar, animar, dar. No son para presumir, sino para el bien de la comunidad. " +
      "Descubrir el tuyo es parte de crecer en la fe.",
    passage: {
      reference: "1 Corintios 12:7",
      text: "Empero á cada uno le es dada manifestación del Espíritu para provecho.",
    },
    video: {
      title: "Tus dones tienen un propósito",
      episode: 12,
      youtube_id: "DEMO0000003",
      start_second: 95,
    },
  },

  "Tengo miedo, ¿qué dice Dios sobre eso?": {
    answer:
      "El miedo es humano, y Dios no te reprende por sentirlo. Una y otra vez en la Biblia Él nos dice «no temas», " +
      "no porque el problema no exista, sino porque nos promete su compañía. No estás sola: Él sostiene tu mano.",
    passage: {
      reference: "Isaías 41:10",
      text: "No temas, que yo soy contigo; no desmayes, que yo soy tu Dios que te esfuerzo.",
    },
    video: {
      title: "Descansar en medio del temor",
      episode: 9,
      youtube_id: "DEMO0000004",
      start_second: 61,
    },
  },
};

/** Respuesta genérica cuando la pregunta no está entre los ejemplos. */
export const fallbackDemoResponse = {
  answer:
    "Esta es una respuesta de ejemplo. Conecta tu chatbot (botón «Demo · Conectar» arriba) para recibir " +
    "respuestas reales, basadas en los videos del canal y en la Biblia. Así se verá cada respuesta: " +
    "con su pasaje y su video de referencia.",
  passage: {
    reference: "Salmos 119:105",
    text: "Lámpara es á mis pies tu palabra, y lumbrera á mi camino.",
  },
  video: {
    title: "Bienvenido a la Palabra",
    episode: 1,
    youtube_id: "DEMO0000000",
    start_second: 0,
  },
};
