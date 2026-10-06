/**
 * Promesas y versículos por área de vida.
 * Textos en Reina-Valera (dominio público) para que GitHub Pages
 * no dependa de /api/life-areas.
 */

const norm = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const V = "Reina-Valera Antigua";

/** @type {Array<{id:string,label:string,keywords:string[],promise:string,verses:Array<{reference:string,title:string,text:string,bible_version:string}>}>} */
export const LIFE_AREAS = [
  {
    id: "fe",
    label: "Fe y confianza",
    keywords: ["fe", "confiar", "confianza", "creer", "temor", "miedo", "ansiedad", "angustia"],
    promise:
      "Dios te ha dado una fe que no depende de tus fuerzas, sino de Cristo en ti. Puedes descansar en Él aun cuando no entiendas todo.",
    verses: [
      { reference: "Romanos 4:5", title: "Justificado por fe", bible_version: V, text: "Mas al que no obra, pero cree en aquel que justifica al impío, su fe le es contada por justicia." },
      { reference: "Filipenses 4:19", title: "Dios suple", bible_version: V, text: "Mi Dios, pues, suplirá todo lo que os falta conforme a sus riquezas en gloria en Cristo Jesús." },
      { reference: "Isaías 41:10", title: "No temas", bible_version: V, text: "No temas, porque yo estoy contigo; no desmayes, porque yo soy tu Dios que te esfuerzo; siempre te ayudaré, siempre te sustentaré con la diestra de mi justicia." },
    ],
  },
  {
    id: "oracion",
    label: "Oración",
    keywords: ["orar", "oracion", "reza", "rezo", "clamar", "interceder"],
    promise:
      "Puedes acercarte a Dios con libertad, no por mérito propio sino por la gracia. Él escucha al que clama en el nombre de Jesús.",
    verses: [
      { reference: "Filipenses 4:6-7", title: "Paz en oración", bible_version: V, text: "Por nada estéis afanosos, sino sean conocidas vuestras peticiones delante de Dios en toda oración y ruego, con acción de gracias. Y la paz de Dios, que sobrepasa todo entendimiento, guardará vuestros corazones y vuestros pensamientos en Cristo Jesús." },
      { reference: "1 Juan 5:14", title: "Confianza al orar", bible_version: V, text: "Y esta es la confianza que tenemos en él, que si pedimos alguna cosa conforme a su voluntad, él nos oye." },
      { reference: "Mateo 7:7", title: "Pide y recibirás", bible_version: V, text: "Pedid, y se os dará; buscad, y hallaréis; llamad, y se os abrirá." },
    ],
  },
  {
    id: "sanidad",
    label: "Sanidad",
    keywords: ["sanidad", "sanar", "sano", "enfermedad", "milagro", "sintoma", "cura", "dolor"],
    promise:
      "El Señor es tu sanador. En Cristo hay vida, restauración y cuidado para cuerpo y alma según su voluntad bondadosa.",
    verses: [
      { reference: "Isaías 53:5", title: "Por sus llagas", bible_version: V, text: "Mas él herido fue por nuestras rebeliones, molido por nuestros pecados; el castigo de nuestra paz fue sobre él, y por su llaga fuimos nosotros curados." },
      { reference: "Salmo 103:3", title: "Sana enfermedades", bible_version: V, text: "Él es quien perdona todas tus iniquidades, el que sana todas tus dolencias." },
      { reference: "Santiago 5:15", title: "Oración del justo", bible_version: V, text: "Y la oración de fe salvará al enfermo, y el Señor lo levantará; y si hubiere cometido pecados, le serán perdonados." },
    ],
  },
  {
    id: "palabra",
    label: "La Palabra",
    keywords: ["palabra", "biblia", "escritura", "versiculo", "leer", "estudiar"],
    promise:
      "La Palabra de Dios es viva y te edifica. Bajo la gracia, la Escritura te forma y te confirma en la verdad de Cristo.",
    verses: [
      { reference: "2 Timoteo 3:16-17", title: "Escritura inspirada", bible_version: V, text: "Toda la Escritura es inspirada por Dios, y útil para enseñar, para redargüir, para corregir, para instruir en justicia, a fin de que el hombre de Dios sea perfecto, enteramente preparado para toda buena obra." },
      { reference: "Romanos 15:4", title: "Esperanza en la Palabra", bible_version: V, text: "Porque las cosas que se escribieron antes, para nuestra enseñanza se escribieron; para que por la paciencia, y por la consolación de las Escrituras, tengamos esperanza." },
      { reference: "Salmo 119:105", title: "Lámpara a mis pies", bible_version: V, text: "Lámpara es a mis pies tu palabra, y lumbrera a mi camino." },
    ],
  },
  {
    id: "salvacion",
    label: "Salvación y nuevo nacimiento",
    keywords: ["nacer", "nuevo", "salvacion", "salvo", "evangelio", "cruz", "convertir"],
    promise:
      "La salvación es un regalo por gracia, recibido por fe, no por obras. En Cristo eres hijo de Dios y tienes vida eterna.",
    verses: [
      { reference: "Efesios 2:8-9", title: "Por gracia sois salvos", bible_version: V, text: "Porque por gracia sois salvos por medio de la fe; y esto no de vosotros, pues es don de Dios; no por obras, para que nadie se gloríe." },
      { reference: "Juan 3:16", title: "De tal manera amó", bible_version: V, text: "Porque de tal manera amó Dios al mundo, que ha dado a su Hijo unigénito, para que todo aquel que en él cree, no se pierda, mas tenga vida eterna." },
      { reference: "Romanos 10:9", title: "Confesión y fe", bible_version: V, text: "Que si confesares con tu boca que Jesús es el Señor, y creyeres en tu corazón que Dios le levantó de los muertos, serás salvo." },
    ],
  },
  {
    id: "dones",
    label: "Dones espirituales",
    keywords: ["dones", "espiritu", "carisma", "ministerio", "servir", "llamado"],
    promise:
      "Dios te ha equipado con dones para edificar a otros en amor. Cada miembro del cuerpo de Cristo tiene un lugar.",
    verses: [
      { reference: "1 Corintios 12:7", title: "Manifestación del Espíritu", bible_version: V, text: "Pero a cada uno le es dada la manifestación del Espíritu para provecho." },
      { reference: "Romanos 12:6", title: "Diversidad de dones", bible_version: V, text: "De manera que, teniendo diferentes dones según la gracia que nos es dada, si el de profecía, úsese conforme a la medida de la fe." },
      { reference: "Efesios 4:7", title: "Gracia según la medida", bible_version: V, text: "Pero a cada uno de nosotros fue dada la gracia conforme a la medida del don de Cristo." },
    ],
  },
  {
    id: "familia",
    label: "Familia y matrimonio",
    keywords: ["familia", "matrimonio", "esposo", "esposa", "hijos", "pareja", "hogar"],
    promise:
      "En Cristo hay gracia para el hogar: amor, perdón y restauración. El Señor camina contigo en las relaciones más cercanas.",
    verses: [
      { reference: "Efesios 5:25", title: "Amor como Cristo", bible_version: V, text: "Maridos, amad a vuestras mujeres, así como Cristo amó a la iglesia, y se entregó a sí mismo por ella." },
      { reference: "Colosenses 3:13", title: "Perdonad unos a otros", bible_version: V, text: "Soportándoos unos a otros, y perdonándoos unos a otros si alguno tuviere queja contra otro. De la manera que Cristo os perdonó, así también hacedlo vosotros." },
      { reference: "Proverbios 3:5-6", title: "Confía en el Señor", bible_version: V, text: "Fíate de Jehová de todo tu corazón, y no te apoyes en tu propia prudencia. Reconócelo en todos tus caminos, y él enderezará tus veredas." },
    ],
  },
  {
    id: "restauracion",
    label: "Restauración y testimonio",
    keywords: ["testimonio", "restaurar", "restauracion", "perdon", "victoria", "libertad"],
    promise:
      "En Cristo hay nueva creación: lo viejo pasó. Dios puede restaurar lo que parecía perdido y usar tu historia para Su gloria.",
    verses: [
      { reference: "2 Corintios 5:17", title: "Nueva criatura", bible_version: V, text: "De modo que si alguno está en Cristo, nueva criatura es; las cosas viejas pasaron; he aquí todas son hechas nuevas." },
      { reference: "Joel 2:25", title: "Restauraré los años", bible_version: V, text: "Y os restituiré los años que comió la oruga, el pulgón, el saltón y la langosta." },
      { reference: "Romanos 8:1", title: "Ninguna condenación", bible_version: V, text: "Ahora, pues, ninguna condenación hay para los que están en Cristo Jesús." },
    ],
  },
  {
    id: "finanzas",
    label: "Finanzas y provisión",
    keywords: ["dinero", "finanza", "financiero", "mapa financiero", "deuda", "prosper", "provision", "ofrenda"],
    promise:
      "Dios suple tus necesidades según sus riquezas en gloria. Él es tu proveedor y te enseña a administrar con sabiduría.",
    verses: [
      { reference: "Filipenses 4:19", title: "Suplirá todo", bible_version: V, text: "Mi Dios, pues, suplirá todo lo que os falta conforme a sus riquezas en gloria en Cristo Jesús." },
      { reference: "Mateo 6:33", title: "Buscad primero el reino", bible_version: V, text: "Mas buscad primeramente el reino de Dios y su justicia, y todas estas cosas os serán añadidas." },
      { reference: "2 Corintios 9:8", title: "Abundancia en todo", bible_version: V, text: "Y poderoso es Dios para hacer que abunde en vosotros toda gracia, a fin de que, teniendo siempre en todas las cosas todo lo suficiente, abundéis para toda buena obra." },
    ],
  },
  {
    id: "paz",
    label: "Paz y ánimo",
    keywords: ["paz", "animo", "triste", "deprim", "solo", "desanim", "consuelo"],
    promise:
      "La paz de Cristo guarda tu corazón más allá de las circunstancias. Él no te deja solo en momentos difíciles.",
    verses: [
      { reference: "Juan 14:27", title: "Mi paz os doy", bible_version: V, text: "La paz os dejo, mi paz os doy; yo no os la doy como el mundo la da. No se turbe vuestro corazón, ni tenga miedo." },
      { reference: "Isaías 26:3", title: "Paz perfecta", bible_version: V, text: "Tú guardarás en completa paz a aquel cuyo pensamiento en ti persevera; porque en ti ha confiado." },
      { reference: "Romanos 15:13", title: "Dios de esperanza", bible_version: V, text: "Y el Dios de esperanza os llene de todo gozo y paz en el creer, para que abundéis en esperanza por el poder del Espíritu Santo." },
    ],
  },
  {
    id: "proposito",
    label: "Trabajo y propósito",
    keywords: ["trabajo", "empleo", "proposito", "vocacion", "carrera", "negocio", "oficio"],
    promise:
      "Lo que hagas, hazlo de corazón como para el Señor. Él tiene un propósito para tu vida y te guía paso a paso.",
    verses: [
      { reference: "Colosenses 3:23", title: "Como para el Señor", bible_version: V, text: "Y todo lo que hagáis, hacedlo de corazón, como para el Señor y no para los hombres." },
      { reference: "Jeremías 29:11", title: "Planes de bien", bible_version: V, text: "Porque yo sé los pensamientos que tengo acerca de vosotros, dice Jehová, pensamientos de paz, y no de mal, para daros el fin que esperáis." },
      { reference: "Proverbios 16:3", title: "Encomienda al Señor", bible_version: V, text: "Encomienda a Jehová tus obras, y tus pensamientos serán afirmados." },
    ],
  },
  {
    id: "perdon",
    label: "Perdón y culpa",
    keywords: ["perdon", "culpa", "pecado", "condenacion", "verguenza", "arrepent"],
    promise:
      "En Cristo tienes perdón pleno y completo. No hay condenación para los que están en Jesús; la gracia te cubre.",
    verses: [
      { reference: "Efesios 1:7", title: "Redención y perdón", bible_version: V, text: "En quien tenemos redención por su sangre, el perdón de pecados según las riquezas de su gracia." },
      { reference: "1 Juan 1:9", title: "Él es fiel", bible_version: V, text: "Si confesamos nuestros pecados, él es fiel y justo para perdonar nuestros pecados, y limpiarnos de toda maldad." },
      { reference: "Colosenses 2:13", title: "Perdonados", bible_version: V, text: "Y a vosotros, estando muertos en pecados y en la incircuncisión de vuestra carne, os dio vida juntamente con él, perdonándoos todos los pecados." },
    ],
  },
];

export function detectLifeArea(question) {
  const text = norm(question);
  if (!text) return null;
  const tokens = new Set(text.split(/\s+/).filter((t) => t.length > 2));

  let best = null;
  let bestScore = 0;
  for (const area of LIFE_AREAS) {
    let score = 0;
    for (const kw of area.keywords) {
      const k = norm(kw);
      if (text.includes(k)) score += 3;
      if (tokens.has(k)) score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = area;
    }
  }
  return bestScore > 0 ? best : null;
}

export function toPanelAreas(areas = LIFE_AREAS) {
  return areas.map((area) => ({
    id: area.id,
    label: area.label,
    promise: area.promise,
    verses: area.verses,
  }));
}
