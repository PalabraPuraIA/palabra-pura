const SUPABASE_URL = "https://jkffgudzlcemapxprbws.supabase.co";
const SUPABASE_ANON = "sb_publishable_WVH-EXfKrrBn9P8US9OA0w_Py4FSmzW";
const ON_PAGES = typeof location !== "undefined" && /github\.io$/i.test(location.hostname);
const HUB = ON_PAGES ? `${SUPABASE_URL}/functions/v1/knowledge-hub` : "/api/knowledge-hub";

const CATEGORY_LABEL = {
  horario: "Horario",
  contacto: "Contacto",
  redes: "Redes",
  evento: "Evento",
  persona: "Persona",
  lugar: "Lugar",
  terminologia: "Término",
  general: "General",
};

const $ = (sel, root = document) => root.querySelector(sel);

function setMsg(el, text, ok) {
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || "";
  el.classList.toggle("form-msg--ok", Boolean(ok));
  el.classList.toggle("form-msg--err", Boolean(text) && !ok);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function hub(action, extra = {}) {
  const headers = { "Content-Type": "application/json" };
  if (ON_PAGES) {
    headers.Authorization = `Bearer ${SUPABASE_ANON}`;
    headers.apikey = SUPABASE_ANON;
  }
  const res = await fetch(HUB, {
    method: "POST",
    headers,
    body: JSON.stringify({ action, ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Error ${res.status}`);
  }
  return data;
}

function parseAliases(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function renderFacts(facts) {
  const body = $("[data-facts-body]");
  const empty = $("[data-facts-empty]");
  if (!body) return;
  body.innerHTML = "";
  if (!facts.length) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  for (const fact of facts) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(CATEGORY_LABEL[fact.category] || fact.category)}</td>
      <td>
        <strong>${escapeHtml(fact.title)}</strong>
        <div class="muted">${escapeHtml((fact.content || "").slice(0, 180))}</div>
      </td>
      <td>${escapeHtml((fact.aliases || []).join(", "))}</td>
      <td><button class="btn btn--ghost" type="button" data-del-fact="${escapeHtml(fact.id)}">Quitar</button></td>
    `;
    body.appendChild(tr);
  }
}

function renderDocs(docs) {
  const body = $("[data-docs-body]");
  const empty = $("[data-docs-empty]");
  if (!body) return;
  body.innerHTML = "";
  if (!docs.length) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  for (const doc of docs) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(doc.title)}</strong>
        <div class="muted">${escapeHtml((doc.preview || "").slice(0, 140))}</div>
      </td>
      <td>${doc.chunks ?? 0}</td>
      <td><button class="btn btn--ghost" type="button" data-del-doc="${escapeHtml(doc.id)}">Quitar</button></td>
    `;
    body.appendChild(tr);
  }
}

function renderJobs(jobs) {
  const body = $("[data-jobs-body]");
  const empty = $("[data-jobs-empty]");
  if (!body) return;
  body.innerHTML = "";
  const queued = jobs.filter((j) => ["queued", "running"].includes(j.status));
  if (!queued.length) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  for (const job of queued) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(job.youtube_id || "—")}</td>
      <td>${escapeHtml(job.title || "Sin título")}</td>
      <td>${escapeHtml(job.status)}</td>
    `;
    body.appendChild(tr);
  }
}

const openSeries = new Set();

function seriesKey(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "otras";
}

function seriesFromTitle(title) {
  const raw = String(title || "").trim();
  const match = raw.match(/^\s*(.+?)\s*[-–]\s*\d+/);
  const prefix = (match ? match[1] : "").replace(/\s+/g, " ").trim();
  const key = seriesKey(prefix || raw);
  if (key.includes("escuela-biblica")) return "Escuela Bíblica";
  return prefix || "Otras enseñanzas";
}

function episodeLabel(video) {
  const title = String(video.title || "").trim();
  const match = title.match(/^\s*.+?\s*[-–]\s*(\d+)\s*[-–]\s*(.+)$/);
  let topic = match
    ? match[2].replace(/\s*[-–]\s*PASTORES.*$/i, "").trim()
    : title;
  const ep = video.episode != null ? video.episode : match?.[1];
  if (ep != null && topic && topic !== title) return `Ep. ${ep} — ${topic}`;
  if (ep != null) return `Ep. ${ep} — ${title || "Sin título"}`;
  return title || "Sin título";
}

function groupVideosBySeries(videos) {
  const groups = new Map();
  for (const video of videos) {
    const name = seriesFromTitle(video.title);
    const key = seriesKey(name);
    if (!groups.has(key)) {
      groups.set(key, { key, name, videos: [], fragments: 0, paid: 0 });
    }
    const group = groups.get(key);
    group.videos.push(video);
    group.fragments += Number(video.fragments) || 0;
    if (video.access_mode === "paid") group.paid += 1;
  }
  for (const group of groups.values()) {
    group.videos.sort((a, b) => (Number(a.episode) || 0) - (Number(b.episode) || 0));
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function renderCatalog(videos) {
  const body = $("[data-catalog-body]");
  const empty = $("[data-catalog-empty]");
  if (!body) return;
  body.innerHTML = "";
  if (!videos.length) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  for (const group of groupVideosBySeries(videos)) {
    const expanded = openSeries.has(group.key);
    const head = document.createElement("tr");
    head.className = "catalog-series";
    head.innerHTML = `
      <td colspan="5">
        <button class="catalog-series__btn" type="button" data-toggle-series="${escapeHtml(group.key)}" aria-expanded="${expanded ? "true" : "false"}">
          <span class="catalog-series__caret" aria-hidden="true">${expanded ? "▾" : "▸"}</span>
          <span class="catalog-series__copy">
            <strong>${escapeHtml(group.name)}</strong>
            <span class="muted">${group.videos.length} episodio${group.videos.length === 1 ? "" : "s"} · ${group.fragments} fragmentos${group.paid ? ` · ${group.paid} de pago` : ""}</span>
          </span>
        </button>
      </td>
    `;
    body.appendChild(head);
    for (const video of group.videos) {
      const paid = video.access_mode === "paid";
      const tr = document.createElement("tr");
      tr.className = "catalog-episode";
      tr.dataset.seriesEp = group.key;
      tr.hidden = !expanded;
      tr.innerHTML = `
        <td>
          <strong>${escapeHtml(episodeLabel(video))}</strong>
          <div class="muted">${escapeHtml(video.youtube_id || "")}</div>
        </td>
        <td>${video.fragments ?? 0}</td>
        <td>
          <select data-access="${escapeHtml(video.youtube_id)}">
            <option value="free" ${paid ? "" : "selected"}>Libre — la IA responde</option>
            <option value="paid" ${paid ? "selected" : ""}>De pago — invita a comprar</option>
          </select>
        </td>
        <td>
          <input type="url" data-offer-url="${escapeHtml(video.youtube_id)}" value="${escapeHtml(video.offer_url || "")}" placeholder="https://…" />
          <input type="text" data-offer-label="${escapeHtml(video.youtube_id)}" value="${escapeHtml(video.offer_label || "")}" placeholder="Comprar esta enseñanza" />
        </td>
        <td><button class="btn btn--primary" type="button" data-save-access="${escapeHtml(video.youtube_id)}">Guardar</button></td>
      `;
      body.appendChild(tr);
    }
  }
}

async function loadHub() {
  const data = await hub("list");
  const facts = data.facts || [];
  const docs = data.documents || [];
  const videos = data.videos || [];
  const jobs = data.jobs || [];
  renderFacts(facts);
  renderDocs(docs);
  renderJobs(jobs);
  renderCatalog(videos);
  $("[data-facts-n]").textContent = facts.length;
  $("[data-docs-n]").textContent = docs.length;
  $("[data-videos-n]").textContent = videos.length;
  $("[data-paid-n]").textContent = videos.filter((v) => v.access_mode === "paid").length;
  $("[data-queued-n]").textContent = jobs.filter((j) => ["queued", "running"].includes(j.status)).length;
  $("[data-generated]").textContent = `Actualizado ${new Date().toLocaleString("es-CO")}`;
}

async function onFactSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = $("[data-fact-submit]");
  const msg = $("[data-fact-msg]");
  submit.disabled = true;
  setMsg(msg, "Guardando…", true);
  try {
    await hub("saveFact", {
      category: form.category.value,
      title: form.title.value,
      content: form.content.value,
      aliases: parseAliases(form.aliases.value),
    });
    form.reset();
    setMsg(msg, "Dato guardado e indexado.", true);
    await loadHub();
  } catch (err) {
    setMsg(msg, err.message, false);
  } finally {
    submit.disabled = false;
  }
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsText(file);
  });
}

async function onDocSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = $("[data-doc-submit]");
  const msg = $("[data-doc-msg]");
  submit.disabled = true;
  setMsg(msg, "Indexando…", true);
  try {
    let content = form.content.value.trim();
    const file = form.file.files[0];
    if (file) content = (await readFileText(file)).trim() || content;
    if (!content) throw new Error("Pega un texto o sube un archivo.");
    await hub("saveDocument", {
      title: form.title.value,
      content,
    });
    form.reset();
    setMsg(msg, "Documento indexado.", true);
    await loadHub();
  } catch (err) {
    setMsg(msg, err.message, false);
  } finally {
    submit.disabled = false;
  }
}

async function onVideoSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = $("[data-video-submit]");
  const msg = $("[data-video-msg]");
  submit.disabled = true;
  setMsg(msg, "Encolando…", true);
  try {
    await hub("queueVideo", {
      url: form.url.value,
      title: form.title.value,
    });
    form.reset();
    setMsg(msg, "Video en cola para transcribir.", true);
    await loadHub();
  } catch (err) {
    setMsg(msg, err.message, false);
  } finally {
    submit.disabled = false;
  }
}

document.addEventListener("click", async (event) => {
  const toggle = event.target.closest("[data-toggle-series]");
  if (toggle) {
    const key = toggle.getAttribute("data-toggle-series");
    const open = !openSeries.has(key);
    if (open) openSeries.add(key);
    else openSeries.delete(key);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    const caret = toggle.querySelector(".catalog-series__caret");
    if (caret) caret.textContent = open ? "▾" : "▸";
    document.querySelectorAll(`[data-series-ep="${CSS.escape(key)}"]`).forEach((row) => {
      row.hidden = !open;
    });
    return;
  }
  const delFact = event.target.closest("[data-del-fact]");
  if (delFact) {
    await hub("deleteFact", { id: delFact.getAttribute("data-del-fact") });
    await loadHub();
    return;
  }
  const delDoc = event.target.closest("[data-del-doc]");
  if (delDoc) {
    await hub("deleteDocument", { id: delDoc.getAttribute("data-del-doc") });
    await loadHub();
    return;
  }
  const save = event.target.closest("[data-save-access]");
  if (save) {
    const youtubeId = save.getAttribute("data-save-access");
    const row = save.closest("tr");
    const access = row.querySelector("[data-access]")?.value || "free";
    const offerUrl = row.querySelector("[data-offer-url]")?.value || "";
    const offerLabel = row.querySelector("[data-offer-label]")?.value || "";
    save.disabled = true;
    try {
      await hub("setVideoAccess", {
        youtube_id: youtubeId,
        access_mode: access,
        offer_url: offerUrl,
        offer_label: offerLabel,
      });
      await loadHub();
    } catch (err) {
      alert(err.message);
    } finally {
      save.disabled = false;
    }
  }
});

$("[data-fact-form]")?.addEventListener("submit", onFactSubmit);
$("[data-doc-form]")?.addEventListener("submit", onDocSubmit);
$("[data-video-form]")?.addEventListener("submit", onVideoSubmit);
$("[data-refresh]")?.addEventListener("click", () => loadHub().catch((err) => alert(err.message)));

loadHub().catch((err) => {
  $("[data-generated]").textContent = err.message;
});
