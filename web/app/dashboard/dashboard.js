import { adminFetch } from "./admin-boot.js";

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
]);

const SUPABASE_URL = "https://jkffgudzlcemapxprbws.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_WVH-EXfKrrBn9P8US9OA0w_Py4FSmzW";
const PAGE_SIZE = 20;

let allRecent = [];
let page = 0;

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
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
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

function buildRepeated(events) {
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
    .filter((r) => r.count >= 2)
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
    repeatedQuestions: buildRepeated(events),
    generatedAt: new Date().toISOString(),
  };
}

function renderRecentCard(record) {
  const tags = (record.topics || [])
    .map((id) => `<span class="tag">${escapeHtml(TOPIC_LABELS[id] || id)}</span>`)
    .join("");
  const source = sourceLabel(record.source, record.mode);
  const answer = record.answer
    ? `<section class="qa-card__section">
         <h3>Respuesta de Blaze</h3>
         <p>${escapeHtml(record.answer)}</p>
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

  return `<details class="qa-card">
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
  const res = await adminFetch("/api/analytics/summary", { cache: "no-store" });
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
  return buildSummary(events);
}

async function load() {
  try {
    return await loadFromLocal();
  } catch (_) {
    return loadFromSupabase();
  }
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
  tbody.innerHTML = slice.map(renderRecentCard).join("");
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
  body.innerHTML = items
    .map(
      (r) => `<details class="repeat-item">
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
}

function render(data) {
  document.querySelector("[data-total]").textContent = data.totalQuestions ?? 0;
  document.querySelector("[data-day]").textContent = data.last24h ?? 0;
  document.querySelector("[data-topics-n]").textContent = (data.topics || []).length;

  const bars = document.querySelector("[data-topic-bars]");
  const topicsEmpty = document.querySelector("[data-topics-empty]");
  const topics = data.topics || [];
  const max = Math.max(1, ...topics.map((t) => t.count));

  if (!topics.length) {
    bars.innerHTML = "";
    topicsEmpty.hidden = false;
  } else {
    topicsEmpty.hidden = true;
    bars.innerHTML = topics
      .map((t) => {
        const pct = Math.round((t.count / max) * 100);
        return `<div class="bar-row">
          <div class="bar-row__label">${escapeHtml(t.label)}</div>
          <div class="bar-row__track"><div class="bar-row__fill" style="width:${pct}%"></div></div>
          <div class="bar-row__n">${t.count}</div>
        </div>`;
      })
      .join("");
  }

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

  renderRepeated(data.repeatedQuestions || []);

  allRecent = data.recent || [];
  page = 0;
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
    render(await load());
  } catch (err) {
    console.error(err);
    document.querySelector("[data-generated]").textContent =
      "No se pudo cargar el resumen.";
  }
}

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
