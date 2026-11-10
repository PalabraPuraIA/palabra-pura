import { adminFetch } from "./admin-boot.js?v=panel-login-1";

const TOPIC_LABELS = {
  fe: "Fe y confianza",
  oracion: "Oración",
  sanidad: "Sanidad",
  palabra: "La Palabra",
  nuevo: "Nuevo nacimiento",
  dones: "Dones",
  familia: "Familia",
  testimonio: "Testimonios",
  otros: "Otros",
};

const TOPICS = [
  { id: "fe", label: "Fe y confianza" },
  { id: "oracion", label: "Oración" },
  { id: "sanidad", label: "Sanidad" },
  { id: "palabra", label: "La Palabra" },
  { id: "nuevo", label: "Nuevo nacimiento / salvación" },
  { id: "dones", label: "Dones espirituales" },
  { id: "familia", label: "Familia y matrimonio" },
  { id: "testimonio", label: "Testimonios / restauración" },
];

const STOPWORDS = new Set([
  "a", "al", "algo", "como", "con", "de", "del", "el", "en", "es", "esta", "este",
  "la", "las", "lo", "los", "me", "mi", "no", "o", "para", "pero", "por", "que",
  "se", "si", "su", "te", "tu", "un", "una", "y", "ya", "yo", "qué", "cómo",
  "dice", "dios", "significa", "puedo", "puede", "hacer", "tengo", "tiene", "ser",
  "son", "sobre", "estoy", "hola", "tener", "hay", "eso", "esa", "ese", "esto",
  "aqui", "allí", "alli", "pues", "bien", "mal", "muy", "mas", "más", "todo",
  "todos", "hace", "porque", "cuando", "donde", "cual", "cuales", "tambien",
  "entonces", "ahora", "despues", "antes", "entre", "desde", "hasta", "sin",
  "quiero", "queria", "empiezo", "empezar", "pregunta", "preguntas", "gracias",
  "buenas", "dias", "tardes", "noches", "blaze", "chat", "ok", "vale",
]);

const TOPIC_TERMS = new Set([
  "fe", "confiar", "confianza", "creer", "temor", "miedo", "ansiedad",
  "orar", "oracion", "reza", "rezo", "clamar",
  "sanidad", "sanar", "sano", "enfermedad", "milagro", "sintoma", "cura",
  "palabra", "biblia", "escritura", "versiculo", "leer",
  "nacer", "nuevo", "salvacion", "salvo", "evangelio", "cruz", "nacimiento",
  "dones", "espiritu", "espirituales", "carisma", "ministerio",
  "familia", "matrimonio", "esposo", "esposa", "hijos", "pareja",
  "testimonio", "restaurar", "restauracion", "perdon",
]);

const SUPABASE_URL = "https://jkffgudzlcemapxprbws.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_WVH-EXfKrrBn9P8US9OA0w_Py4FSmzW";
const PAGE_SIZE = 20;
const RANGE_MS = 24 * 3600 * 1000;
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

let allEvents = [];
let allRecent = [];
let page = 0;
let rangeFilter = "today";
let customFrom = null;
let customTo = null;
let calPending = null;
let calView = null;

function fmtWhen(iso) {
  try {
    return new Date(iso).toLocaleString("es-CO", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function fmtMinute(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(total / 60);
  const rest = Math.floor(total % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function sourceLabel(source, mode) {
  if (source === "video") return "Enseñanza en video";
  if (source === "biblia") return "Biblia";
  if (mode === "guard") return "Filtro";
  return source || mode || "Chat";
}

function normalizeTokens(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t) && !TOPIC_TERMS.has(t));
}

function questionKey(q) {
  return String(q || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bogotaYmd(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function dayStartFromYmd(ymd) {
  return new Date(`${ymd}T00:00:00-05:00`).getTime();
}

function bogotaDayStart(date = new Date()) {
  return dayStartFromYmd(bogotaYmd(date));
}

function ymdParts(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return { y, m, d };
}

function monthTitle(y, m) {
  const name = MONTHS_SHORT[m - 1] || "";
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
}

function fmtDayLabel(ymd) {
  const { d, m } = ymdParts(ymd);
  return `${d} ${MONTHS_SHORT[m - 1] || ""}`;
}

function fmtRangeLabel(from, to) {
  if (!from || !to) return "";
  if (from === to) return fmtDayLabel(from);
  const a = ymdParts(from);
  const b = ymdParts(to);
  if (a.m === b.m && a.y === b.y) return `${a.d}–${fmtDayLabel(to)}`;
  return `${fmtDayLabel(from)} – ${fmtDayLabel(to)}`;
}

function weekdayMonday0(y, m, d) {
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function shiftMonth(y, m, delta) {
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1 };
}

function eventDaySet() {
  const set = new Set();
  for (const ev of allEvents) {
    const t = Date.parse(ev.at);
    if (!Number.isFinite(t)) continue;
    set.add(bogotaYmd(new Date(t)));
  }
  return set;
}

function rangeStart(range) {
  const today = bogotaDayStart();
  if (range === "today") return today;
  if (range === "7d") return today - 6 * RANGE_MS;
  if (range === "30d") return today - 29 * RANGE_MS;
  return 0;
}

function eventsInRange(events, range) {
  if (range === "custom" && customFrom && customTo) {
    const start = dayStartFromYmd(customFrom);
    const end = dayStartFromYmd(customTo) + RANGE_MS;
    return events.filter((ev) => {
      const t = Date.parse(ev.at);
      return Number.isFinite(t) && t >= start && t < end;
    });
  }
  const start = rangeStart(range);
  if (!start) return events;
  return events.filter((ev) => Date.parse(ev.at) >= start);
}

function buildRepeated(events, minCount = 2) {
  const map = new Map();
  for (const ev of events) {
    const key = questionKey(ev.question);
    if (!key || key.length < 4) continue;
    const prev = map.get(key);
    if (prev) {
      prev.count += 1;
      if (String(ev.at) > String(prev.lastAt || "")) {
        prev.question = ev.question;
        prev.lastAt = ev.at;
      }
    } else {
      map.set(key, { question: ev.question, count: 1, lastAt: ev.at });
    }
  }
  return [...map.values()]
    .filter((r) => r.count >= minCount)
    .sort((a, b) => b.count - a.count || String(b.lastAt).localeCompare(String(a.lastAt)))
    .slice(0, 25);
}

function buildSummary(events) {
  const topicCounts = Object.fromEntries(TOPICS.map((t) => [t.id, 0]));
  topicCounts.otros = 0;
  const termCounts = new Map();

  for (const ev of events) {
    for (const tid of ev.topics || []) {
      topicCounts[tid] = (topicCounts[tid] || 0) + 1;
    }
    for (const term of normalizeTokens(ev.question)) {
      termCounts.set(term, (termCounts.get(term) || 0) + 1);
    }
  }

  const topics = [
    ...TOPICS.map((t) => ({
      id: t.id,
      label: t.label,
      count: topicCounts[t.id] || 0,
    })),
    { id: "otros", label: "Otros temas", count: topicCounts.otros || 0 },
  ]
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);

  const topTerms = [...termCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([term, count]) => ({ term, count }));

  const recent = [...events].sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const last24h = events.filter(
    (e) => Date.now() - Date.parse(e.at) < 24 * 3600 * 1000,
  ).length;

  return {
    totalQuestions: events.length,
    last24h,
    topics,
    topTerms,
    recent,
    repeatedQuestions: buildRepeated(events, 2),
    generatedAt: new Date().toISOString(),
  };
}

function openKeys(root) {
  return new Set(
    [...(root?.querySelectorAll("details[open][data-open-key]") || [])].map((el) =>
      el.getAttribute("data-open-key"),
    ),
  );
}

function applyOpen(root, keys) {
  if (!root || !keys?.size) return;
  root.querySelectorAll("details[data-open-key]").forEach((el) => {
    if (keys.has(el.getAttribute("data-open-key"))) el.open = true;
  });
}

function cardKey(record) {
  return String(record.id || `${record.at || ""}|${record.question || ""}`);
}

function displayAnswer(raw) {
  let text = String(raw || "").trim();
  if (!text) return "";
  for (let i = 0; i < 3; i++) {
    if (!text.startsWith("{") || !/"answer"\s*:/.test(text)) break;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && parsed.answer != null) {
        text = String(parsed.answer).trim();
        continue;
      }
    } catch {
      break;
    }
    break;
  }
  return text;
}

function renderRecentCard(record) {
  const tags = (record.topics || [])
    .map((id) => `<span class="tag">${escapeHtml(TOPIC_LABELS[id] || id)}</span>`)
    .join("");
  const source = sourceLabel(record.source, record.mode);
  const cleanAnswer = displayAnswer(record.answer);
  const answer = cleanAnswer
    ? `<section class="qa-card__section">
         <h3>Respuesta de Blaze</h3>
         <p>${escapeHtml(cleanAnswer)}</p>
       </section>`
    : `<p class="qa-card__legacy">Esta consulta es anterior al registro de respuestas.</p>`;
  const excerpt = record.excerpt
    ? `<section class="qa-card__section qa-card__excerpt">
         <h3>Fragmento relevante de la transcripción</h3>
         <blockquote>${escapeHtml(record.excerpt)}</blockquote>
       </section>`
    : "";
  const video = record.video?.title
    ? `<section class="qa-card__section qa-card__meta">
         <h3>Fuente</h3>
         <p>${escapeHtml(record.video.title)}
           ${record.video.episode ? ` · episodio ${escapeHtml(record.video.episode)}` : ""}
           · desde ${escapeHtml(fmtMinute(record.video.start_second))}
         </p>
       </section>`
    : "";
  const passageList = Array.isArray(record.passages) ? record.passages : [];
  const passages = passageList.length
    ? `<section class="qa-card__section qa-card__meta">
         <h3>Referencias bíblicas</h3>
         <p>${passageList
           .map((p) => escapeHtml(p.reference))
           .filter(Boolean)
           .join(" · ")}</p>
       </section>`
    : "";

  return `<details class="qa-card" data-open-key="${escapeHtml(cardKey(record))}">
    <summary>
      <span class="qa-card__when">${escapeHtml(fmtWhen(record.at))}</span>
      <span class="qa-card__question">${escapeHtml(record.question)}</span>
      <span class="qa-card__summary-meta">
        <span class="qa-card__source">${escapeHtml(source)}</span>
        ${tags}
      </span>
      <span class="qa-card__chevron" aria-hidden="true">⌄</span>
    </summary>
    <div class="qa-card__body">
      ${answer}
      ${excerpt}
      ${video}
      ${passages}
    </div>
  </details>`;
}

async function loadFromLocal() {
  // skipAuthRedirect: en Pages un 401 del túnel no debe expulsar al login;
  // el historial se lee de Supabase como respaldo.
  const res = await adminFetch("/api/analytics/summary", {
    cache: "no-store",
    skipAuthRedirect: true,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadFromSupabase() {
  const url = new URL(`${SUPABASE_URL}/rest/v1/chat_interactions`);
  url.searchParams.set(
    "select",
    "id,question,answer,excerpt,source,mode,topics,video,passages,retrieval_meta,created_at",
  );
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", "1000");

  const res = await fetch(url.toString(), {
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${PUBLISHABLE_KEY}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase HTTP ${res.status}`);
  const rows = await res.json();
  const events = (Array.isArray(rows) ? rows : []).map((row) => ({
    id: row.id,
    question: row.question,
    answer: row.answer,
    excerpt: row.excerpt,
    source: row.source,
    mode: row.mode,
    topics: row.topics || [],
    video: row.video,
    passages: row.passages,
    retrieval: row.retrieval_meta,
    at: row.created_at,
  }));
  return events;
}

async function loadEvents() {
  const onPages =
    typeof location !== "undefined" && /github\.io$/i.test(location.hostname);
  // En GitHub Pages el histórico canónico está en Supabase (chat de Gemini).
  if (onPages) {
    try {
      return await loadFromSupabase();
    } catch {
      /* si falla la nube, intenta el túnel Fintek */
    }
  }
  try {
    const data = await loadFromLocal();
    if (Array.isArray(data?.recent) && data.recent.length) return data.recent;
  } catch {
    /* server sin analytics / sin auth */
  }
  return loadFromSupabase();
}

function pageCount() {
  return Math.max(1, Math.ceil(allRecent.length / PAGE_SIZE));
}

function renderRecentPage() {
  const tbody = document.querySelector("[data-recent]");
  const recentEmpty = document.querySelector("[data-recent-empty]");
  const pager = document.querySelector("[data-pager]");
  const meta = document.querySelector("[data-page-meta]");
  const label = document.querySelector("[data-page-label]");
  const prev = document.querySelector("[data-page-prev]");
  const next = document.querySelector("[data-page-next]");

  const total = allRecent.length;
  const pages = pageCount();
  if (page >= pages) page = Math.max(0, pages - 1);
  const start = page * PAGE_SIZE;
  const slice = allRecent.slice(start, start + PAGE_SIZE);

  if (!total) {
    tbody.innerHTML = "";
    recentEmpty.hidden = false;
    pager.hidden = true;
    meta.textContent = "";
    return;
  }

  recentEmpty.hidden = true;
  const open = openKeys(tbody);
  tbody.innerHTML = slice.map(renderRecentCard).join("");
  applyOpen(tbody, open);
  pager.hidden = pages <= 1;
  const from = start + 1;
  const to = Math.min(start + PAGE_SIZE, total);
  meta.textContent = `${from}–${to} de ${total}`;
  label.textContent = `Página ${page + 1} de ${pages}`;
  prev.disabled = page <= 0;
  next.disabled = page >= pages - 1;
}

function renderRepeated(items) {
  const body = document.querySelector("[data-repeated-body]");
  const empty = document.querySelector("[data-repeated-empty]");
  if (!items.length) {
    body.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  const open = openKeys(body);
  body.innerHTML = items
    .map(
      (r) => `<details class="repeat-item" data-open-key="${escapeHtml(questionKey(r.question))}">
        <summary>
          <span class="repeat-item__q">${escapeHtml(r.question)}</span>
          <span class="repeat-item__count">×${r.count}</span>
          <span class="repeat-item__chevron" aria-hidden="true">⌄</span>
        </summary>
        <div class="repeat-item__body">
          <p><strong>${r.count}</strong> veces preguntada</p>
          <p class="when">Última: ${escapeHtml(fmtWhen(r.lastAt))}</p>
        </div>
      </details>`,
    )
    .join("");
  applyOpen(body, open);
}

function updateRangeHint() {
  const el = document.querySelector("[data-range-hint]");
  if (!el) return;
  if (rangeFilter === "today") {
    el.textContent = "Temas y preguntas de hoy.";
  } else if (rangeFilter === "7d") {
    el.textContent = "Temas y preguntas de los últimos 7 días.";
  } else if (rangeFilter === "30d") {
    el.textContent = "Temas y preguntas de los últimos 30 días.";
  } else if (rangeFilter === "all") {
    el.textContent = "Temas y preguntas de todo el historial.";
  } else if (rangeFilter === "custom" && customFrom && customTo) {
    el.textContent = customFrom === customTo
      ? `Temas y preguntas del ${fmtDayLabel(customFrom)}.`
      : `Temas y preguntas del ${fmtRangeLabel(customFrom, customTo)}.`;
  }
}

function updateRecentHint() {
  const el = document.querySelector("[data-recent-hint]");
  if (!el) return;
  const suffix = " 20 por página. Abre una ficha para ver la respuesta.";
  if (rangeFilter === "today") {
    el.textContent = `Consultas de hoy.${suffix}`;
  } else if (rangeFilter === "7d") {
    el.textContent = `Consultas de los últimos 7 días.${suffix}`;
  } else if (rangeFilter === "30d") {
    el.textContent = `Consultas de los últimos 30 días.${suffix}`;
  } else if (rangeFilter === "all") {
    el.textContent = `Todas las consultas, de lo más reciente a lo más viejo.${suffix}`;
  } else if (rangeFilter === "custom" && customFrom && customTo) {
    el.textContent = customFrom === customTo
      ? `Consultas del ${fmtDayLabel(customFrom)}.${suffix}`
      : `Consultas del ${fmtRangeLabel(customFrom, customTo)}.${suffix}`;
  }
}

function applyRangeChange() {
  syncRangeButtons();
  updateRangeHint();
  updateRecentHint();
  renderTopicsAndRepeats();
  page = 0;
  allRecent = eventsInRange(allEvents, rangeFilter);
  renderRecentPage();
}

function setRange(next) {
  if (!next || next === rangeFilter) return;
  rangeFilter = next;
  if (next !== "custom") {
    customFrom = null;
    customTo = null;
    calPending = null;
    closeCal();
  }
  applyRangeChange();
}

function applyCustom(from, to) {
  customFrom = from;
  customTo = to;
  rangeFilter = "custom";
  applyRangeChange();
}

function syncRangeButtons() {
  document.querySelectorAll("[data-range-filter] [data-range]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.dataset.range === rangeFilter ? "true" : "false");
  });
  const customOn = rangeFilter === "custom";
  document.querySelectorAll("[data-cal-open]").forEach((btn) => {
    btn.setAttribute("aria-pressed", customOn ? "true" : "false");
  });
  document.querySelectorAll("[data-cal-label]").forEach((label) => {
    if (customOn && customFrom && customTo) {
      label.hidden = false;
      label.textContent = fmtRangeLabel(customFrom, customTo);
    } else {
      label.hidden = true;
      label.textContent = "";
    }
  });
}

function allCalTools() {
  return [...document.querySelectorAll("[data-range-tools]")];
}

function isCalOpen() {
  return allCalTools().some((tools) => !tools.querySelector("[data-cal-pop]")?.hidden);
}

function openCal(tools) {
  const today = ymdParts(bogotaYmd());
  if (customFrom) {
    const p = ymdParts(customFrom);
    calView = { y: p.y, m: p.m };
  } else {
    calView = { y: today.y, m: today.m };
  }
  allCalTools().forEach((other) => {
    const pop = other.querySelector("[data-cal-pop]");
    const btn = other.querySelector("[data-cal-open]");
    const on = other === tools;
    if (pop) pop.hidden = !on;
    if (btn) btn.setAttribute("aria-expanded", on ? "true" : "false");
  });
  renderCal(tools);
}

function closeCal() {
  calPending = null;
  allCalTools().forEach((tools) => {
    const pop = tools.querySelector("[data-cal-pop]");
    const btn = tools.querySelector("[data-cal-open]");
    if (pop) pop.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
  });
}

function toggleCal(tools) {
  const pop = tools?.querySelector("[data-cal-pop]");
  if (!pop) return;
  if (!pop.hidden) closeCal();
  else openCal(tools);
}

function renderCal(tools) {
  const targets = tools ? [tools] : allCalTools().filter((t) => !t.querySelector("[data-cal-pop]")?.hidden);
  const today = bogotaYmd();
  const todayParts = ymdParts(today);
  if (!calView) calView = { y: todayParts.y, m: todayParts.m };
  const dots = eventDaySet();
  const firstPad = weekdayMonday0(calView.y, calView.m, 1);
  const nDays = daysInMonth(calView.y, calView.m);
  const cells = [];
  for (let i = 0; i < firstPad; i += 1) cells.push('<span class="cal-pop__empty"></span>');
  for (let d = 1; d <= nDays; d += 1) {
    const ymd = `${calView.y}-${String(calView.m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const classes = ["cal-pop__day"];
    if (ymd === today) classes.push("is-today");
    if (customFrom && customTo && ymd >= customFrom && ymd <= customTo) classes.push("is-in");
    if (ymd === customFrom || ymd === customTo) classes.push("is-pick");
    if (dots.has(ymd)) classes.push("has-dot");
    const disabled = ymd > today ? " disabled" : "";
    cells.push(`<button type="button" class="${classes.join(" ")}" data-ymd="${ymd}"${disabled}>${d}</button>`);
  }
  const html = cells.join("");
  const canGoNext = !(calView.y > todayParts.y || (calView.y === todayParts.y && calView.m >= todayParts.m));
  targets.forEach((target) => {
    const monthEl = target.querySelector("[data-cal-month]");
    const grid = target.querySelector("[data-cal-grid]");
    const nextBtn = target.querySelector("[data-cal-next]");
    if (monthEl) monthEl.textContent = monthTitle(calView.y, calView.m);
    if (nextBtn) nextBtn.disabled = !canGoNext;
    if (grid) grid.innerHTML = html;
  });
}

function pickDay(ymd) {
  if (!calPending) {
    calPending = ymd;
    applyCustom(ymd, ymd);
    renderCal();
    return;
  }
  const from = calPending <= ymd ? calPending : ymd;
  const to = calPending <= ymd ? ymd : calPending;
  calPending = null;
  applyCustom(from, to);
  renderCal();
  closeCal();
}

function initFilters() {
  document.querySelectorAll("[data-range-filter] [data-range]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      setRange(btn.dataset.range);
    });
  });
}

function initCal() {
  allCalTools().forEach((tools) => {
    if (tools.dataset.bound === "1") return;
    tools.dataset.bound = "1";
    tools.querySelector("[data-cal-open]")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleCal(tools);
    });
    tools.querySelector("[data-cal-prev]")?.addEventListener("click", (event) => {
      event.preventDefault();
      if (!calView) return;
      calView = shiftMonth(calView.y, calView.m, -1);
      renderCal(tools);
    });
    tools.querySelector("[data-cal-next]")?.addEventListener("click", (event) => {
      event.preventDefault();
      if (!calView) return;
      const next = shiftMonth(calView.y, calView.m, 1);
      const today = ymdParts(bogotaYmd());
      if (next.y > today.y || (next.y === today.y && next.m > today.m)) return;
      calView = next;
      renderCal(tools);
    });
    tools.querySelector("[data-cal-grid]")?.addEventListener("click", (event) => {
      const day = event.target.closest("[data-ymd]");
      if (!day || day.disabled) return;
      pickDay(day.dataset.ymd);
    });
  });
  if (document.documentElement.dataset.calDocBound === "1") return;
  document.documentElement.dataset.calDocBound = "1";
  document.addEventListener("click", (event) => {
    if (!isCalOpen()) return;
    if (allCalTools().some((tools) => tools.contains(event.target))) return;
    closeCal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isCalOpen()) closeCal();
  });
}

function renderTopicsAndRepeats() {
  const slice = eventsInRange(allEvents, rangeFilter);
  const data = buildSummary(slice);
  const topics = data.topics || [];
  const namedTopics = topics.filter((t) => t.id !== "otros");
  const otherTopic = topics.find((t) => t.id === "otros");
  const minCount = rangeFilter === "all" ? 2 : 1;
  const repeats = buildRepeated(slice, minCount);

  const bars = document.querySelector("[data-topic-bars]");
  const topicsEmpty = document.querySelector("[data-topics-empty]");
  const topicsOther = document.querySelector("[data-topics-other]");
  const max = Math.max(1, ...namedTopics.map((t) => t.count));

  if (!namedTopics.length) {
    bars.innerHTML = "";
    topicsEmpty.hidden = false;
    if (topicsOther) topicsOther.hidden = true;
  } else {
    topicsEmpty.hidden = true;
    bars.innerHTML = namedTopics
      .map((t) => {
        const pct = Math.round((t.count / max) * 100);
        return `<div class="bar-row">
          <div class="bar-row__label">${escapeHtml(t.label)}</div>
          <div class="bar-row__track"><div class="bar-row__fill" style="width:${pct}%"></div></div>
          <div class="bar-row__n">${t.count}</div>
        </div>`;
      })
      .join("");
    if (topicsOther) {
      if (otherTopic?.count) {
        topicsOther.hidden = false;
        topicsOther.textContent = `${otherTopic.count} consultas no encajan en un tema concreto.`;
      } else {
        topicsOther.hidden = true;
      }
    }
  }

  renderRepeated(repeats);
}

function render(data) {
  document.querySelector("[data-total]").textContent = data.totalQuestions ?? 0;
  document.querySelector("[data-day]").textContent = data.last24h ?? 0;
  const namedTopics = (data.topics || []).filter((t) => t.id !== "otros");
  document.querySelector("[data-topics-n]").textContent = namedTopics.length;

  initFilters();
  initCal();
  syncRangeButtons();
  updateRangeHint();
  updateRecentHint();
  renderTopicsAndRepeats();
  if (isCalOpen()) renderCal();

  const termsEl = document.querySelector("[data-terms]");
  const termsEmpty = document.querySelector("[data-terms-empty]");
  const terms = data.topTerms || [];
  if (!terms.length) {
    termsEl.innerHTML = "";
    termsEmpty.hidden = false;
  } else {
    termsEmpty.hidden = true;
    const total = Math.max(1, data.totalQuestions || 1);
    termsEl.innerHTML = terms
      .map((t) => {
        const avg = ((t.count / total) * 100).toFixed(0);
        return `<li>${escapeHtml(t.term)} <span>×${t.count} · ~${avg}%</span></li>`;
      })
      .join("");
  }

  allRecent = eventsInRange(allEvents, rangeFilter);
  const pages = pageCount();
  if (page >= pages) page = Math.max(0, pages - 1);
  renderRecentPage();

  document.querySelector("[data-generated]").textContent =
    `Actualizado: ${fmtWhen(data.generatedAt)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function refresh() {
  try {
    allEvents = await loadEvents();
    render(buildSummary(allEvents));
  } catch (err) {
    console.error(err);
    document.querySelector("[data-generated]").textContent =
      "No se pudo cargar el resumen.";
  }
}

initFilters();
initCal();
document.querySelector("[data-refresh]").addEventListener("click", refresh);
document.querySelector("[data-page-prev]").addEventListener("click", () => {
  if (page > 0) {
    page -= 1;
    renderRecentPage();
  }
});
document.querySelector("[data-page-next]").addEventListener("click", () => {
  if (page < pageCount() - 1) {
    page += 1;
    renderRecentPage();
  }
});

refresh();
setInterval(refresh, 20000);
