import "./admin-boot.js?v=kb-audio-5";

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
  const recent = jobs.filter((j) => ["queued", "running", "done", "error"].includes(j.status)).slice(0, 8);
  if (!recent.length) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  for (const job of recent) {
    const tr = document.createElement("tr");
    const detail = job.error || job.progress || job.status;
    tr.innerHTML = `
      <td>${escapeHtml(job.youtube_id || "—")}</td>
      <td>${escapeHtml(job.title || "Sin título")}</td>
      <td>${escapeHtml(detail)}</td>
    `;
    body.appendChild(tr);
  }
}

async function waitForJob(jobId, onProgress) {
  const started = Date.now();
  while (Date.now() - started < 240000) {
    const data = await hub("list");
    const job = (data.jobs || []).find((j) => Number(j.id) === Number(jobId));
    if (job && typeof onProgress === "function") onProgress(job);
    if (job?.status === "done") return job;
    if (job?.status === "error") throw new Error(job.error || "Error al indexar el video");
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error("Sigue indexando. Recarga en un minuto y mira el catálogo.");
}

const openSeries = new Set();
const selectedVideoIds = new Set();
let picking = false;

function setPicking(on) {
  picking = Boolean(on);
  $("[data-kb-panel='catalog']")?.classList.toggle("is-picking", picking);
  const open = $("[data-export-open]");
  const tools = $("[data-export-tools]");
  const hint = $("[data-catalog-hint]");
  if (open) open.hidden = picking;
  if (tools) tools.hidden = !picking;
  if (hint) {
    hint.textContent = picking
      ? "Marca las casillas de las series o episodios que quieras. Luego descarga lo marcado o todo."
      : "Filtra o toca una serie. Para bajar el texto, pulsa Descargar.";
  }
  if (!picking) {
    selectedVideoIds.clear();
    document.querySelectorAll("[data-select-video], [data-select-series], [data-select-all-videos]").forEach((box) => {
      box.checked = false;
      box.indeterminate = false;
    });
  }
  updateSelectionUi();
}

function videoKey(video) {
  return String(video?.id || video?.youtube_id || "");
}

function videosForSeries(key) {
  return lastVideos.filter((video) => seriesKey(seriesFromTitle(video.title)) === key);
}

function updateSelectionUi() {
  const allIds = lastVideos.map(videoKey).filter(Boolean);
  const allBox = $("[data-select-all-videos]");
  if (allBox) {
    const n = allIds.filter((id) => selectedVideoIds.has(id)).length;
    allBox.checked = allIds.length > 0 && n === allIds.length;
    allBox.indeterminate = n > 0 && n < allIds.length;
  }
  document.querySelectorAll("[data-select-series]").forEach((box) => {
    const key = box.getAttribute("data-select-series");
    const ids = videosForSeries(key).map(videoKey).filter(Boolean);
    const n = ids.filter((id) => selectedVideoIds.has(id)).length;
    box.checked = ids.length > 0 && n === ids.length;
    box.indeterminate = n > 0 && n < ids.length;
  });
  const label = $("[data-selected-n]");
  if (label) {
    const n = selectedVideoIds.size;
    label.textContent = n ? `${n} video${n === 1 ? "" : "s"} marcado${n === 1 ? "" : "s"}` : "Ninguno marcado";
  }
}

function seriesKey(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "otras";
}

function seriesFromTitle(title) {
  let raw = String(title || "").trim();
  raw = raw
    .replace(/\s*[-–/]\s*PASTOR(?:A|ES)?\b.*$/i, "")
    .replace(/\s*\/\s*[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ\s.]{2,}$/u, "")
    .replace(/\s*\(\s*ROMANOS[^)]*\)\s*/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  const numbered = raw.match(/^\s*(.+?)\s*[-–]\s*\d{2,4}\b/);
  const parteParen = raw.match(/^\s*(.+?)\s*\(\s*PARTE\s*\d+/i);
  const partePlain = raw.match(/^\s*(.+?)\s+PARTE\s*\d+/i);
  const prefix = (numbered?.[1] || parteParen?.[1] || partePlain?.[1] || "").replace(/\s+/g, " ").trim();
  const key = seriesKey(prefix || raw).replace(/^el-/, "");
  if (key.includes("escuela-biblica")) return "Escuela Bíblica";
  if (key.includes("globalismo")) return "El Globalismo Falso";
  if (key.includes("amor") && key.includes("aceptacion")) return "El Amor No Es Aceptación";
  if (key.includes("lengua") && (key.includes("arma") || key.includes("poderosa"))) {
    return "La Lengua, un Arma Poderosa";
  }
  // Enseñanzas sueltas (p. ej. audio subido) usan su propio título como serie.
  if (prefix) return prefix;
  if (raw && !/^(sin t[ií]tulo|audio|untitled|local-)/i.test(raw)) return raw;
  return "Otras enseñanzas";
}

function episodeFromTitle(title) {
  const raw = String(title || "");
  const parte = raw.match(/PARTE\s*0*(\d+)/i);
  const numbered = raw.match(/[-–]\s*(\d{2,4})\s*[-–]/);
  return parte?.[1] || numbered?.[1] || null;
}

function episodeLabel(video) {
  const title = String(video.title || "").trim();
  const match = title.match(/^\s*.+?\s*[-–]\s*(\d+)\s*[-–]\s*(.+)$/);
  let topic = match
    ? match[2].replace(/\s*[-–]\s*PASTORES.*$/i, "").trim()
    : title;
  const ep = video.episode != null ? video.episode : episodeFromTitle(title);
  const series = seriesFromTitle(title);
  if (ep != null && topic && topic !== title) return `Ep. ${Number(ep)} — ${topic}`;
  if (ep != null && series && series !== "Otras enseñanzas") return `Ep. ${Number(ep)} — ${series}`;
  if (ep != null) return `Ep. ${Number(ep)} — ${title || "Sin título"}`;
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
    group.videos.sort((a, b) => {
      const ae = Number(a.episode != null ? a.episode : episodeFromTitle(a.title)) || 0;
      const be = Number(b.episode != null ? b.episode : episodeFromTitle(b.title)) || 0;
      return ae - be;
    });
    if (!/escuela/i.test(group.name)) openSeries.add(group.key);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function catalogFilter() {
  return String($("[data-catalog-filter]")?.value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function renderCatalog(videos) {
  const body = $("[data-catalog-body]");
  const empty = $("[data-catalog-empty]");
  if (!body) return;
  body.innerHTML = "";
  const q = catalogFilter();
  const groups = groupVideosBySeries(videos).filter((group) => {
    if (!q) return true;
    const hay = `${group.name} ${group.videos.map((v) => v.title).join(" ")}`
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return hay.includes(q);
  });
  if (!videos.length) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  if (!groups.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6" class="muted">Ninguna serie coincide con «${escapeHtml(q)}».</td>`;
    body.appendChild(tr);
    return;
  }
  for (const group of groups) {
    if (q) openSeries.add(group.key);
    const expanded = openSeries.has(group.key);
    const seriesIds = group.videos.map(videoKey).filter(Boolean);
    const selectedInSeries = seriesIds.filter((id) => selectedVideoIds.has(id)).length;
    const head = document.createElement("tr");
    head.className = "catalog-series";
    head.innerHTML = `
      <td colspan="6">
        <div class="catalog-series-row">
          <input class="catalog-pick" type="checkbox" data-select-series="${escapeHtml(group.key)}" ${selectedInSeries === seriesIds.length && seriesIds.length ? "checked" : ""} aria-label="Seleccionar ${escapeHtml(group.name)}" />
          <button class="catalog-series__btn" type="button" data-toggle-series="${escapeHtml(group.key)}" aria-expanded="${expanded ? "true" : "false"}">
            <span class="catalog-series__caret" aria-hidden="true">${expanded ? "▾" : "▸"}</span>
            <span class="catalog-series__copy">
              <strong>${escapeHtml(group.name)}</strong>
              <span class="muted">${group.videos.length} episodio${group.videos.length === 1 ? "" : "s"} · ${group.fragments} fragmentos${group.paid ? ` · ${group.paid} de pago` : ""}</span>
            </span>
          </button>
        </div>
      </td>
    `;
    body.appendChild(head);
    const seriesBox = head.querySelector("[data-select-series]");
    if (seriesBox) seriesBox.indeterminate = selectedInSeries > 0 && selectedInSeries < seriesIds.length;
    for (const video of group.videos) {
      const paid = video.access_mode === "paid";
      const id = videoKey(video);
      const tr = document.createElement("tr");
      tr.className = "catalog-episode";
      tr.dataset.seriesEp = group.key;
      tr.hidden = !expanded;
      tr.innerHTML = `
        <td>
          <label class="catalog-check">
            <input class="catalog-pick" type="checkbox" data-select-video="${escapeHtml(id)}" ${selectedVideoIds.has(id) ? "checked" : ""} aria-label="Seleccionar ${escapeHtml(episodeLabel(video))}" />
          </label>
        </td>
        <td>
          <strong>${escapeHtml(episodeLabel(video))}</strong>
          <div class="muted">${escapeHtml(video.youtube_id || "")}</div>
        </td>
        <td>${video.fragments ?? 0}</td>
        <td>
          <select data-access="${escapeHtml(video.youtube_id)}">
            <option value="free" ${paid ? "" : "selected"}>Libre — la IA responde</option>
            <option value="paid" ${paid ? "selected" : ""}>De pago — responde e invita a comprar</option>
          </select>
        </td>
        <td>
          <div class="catalog-offer">
            <input type="url" data-offer-url="${escapeHtml(video.youtube_id)}" value="${escapeHtml(video.offer_url || "")}" placeholder="https://…" />
            <input type="text" data-offer-label="${escapeHtml(video.youtube_id)}" value="${escapeHtml(video.offer_label || "")}" placeholder="Texto del botón" />
          </div>
        </td>
        <td><button class="btn btn--primary btn--tiny" type="button" data-save-access="${escapeHtml(video.youtube_id)}">Guardar</button></td>
      `;
      body.appendChild(tr);
    }
  }
  updateSelectionUi();
}

let lastVideos = [];

async function loadHub() {
  const empty = $("[data-catalog-empty]");
  if (empty) {
    empty.hidden = false;
    empty.textContent = "Cargando catálogo desde la nube…";
  }
  const data = await hub("list");
  const facts = data.facts || [];
  const docs = data.documents || [];
  lastVideos = data.videos || [];
  const jobs = data.jobs || [];
  renderFacts(facts);
  renderDocs(docs);
  renderJobs(jobs);
  renderCatalog(lastVideos);
  $("[data-facts-n]").textContent = facts.length;
  $("[data-docs-n]").textContent = docs.length;
  $("[data-videos-n]").textContent = lastVideos.length;
  $("[data-paid-n]").textContent = lastVideos.filter((v) => v.access_mode === "paid").length;
  $("[data-queued-n]").textContent = jobs.filter((j) => ["queued", "running"].includes(j.status)).length;
  $("[data-generated]").textContent = `Actualizado ${new Date().toLocaleString("es-CO")} · nube Supabase`;
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
  setMsg(msg, "Indexando ahora… puede tardar un minuto.", true);
  try {
    const data = await hub("ingestVideo", {
      url: form.url.value,
      title: form.title.value,
    });
    let job = data.job;
    if (data.started && job?.id) {
      job = await waitForJob(job.id, (current) => {
        setMsg(msg, current.progress || "Indexando…", true);
      });
    }
    form.reset();
    const n = job?.fragments_created || data.fragments || 0;
    setMsg(msg, `Listo. ${n} fragmentos. Ya puedes preguntarle a Blaze.`, true);
    await loadHub();
  } catch (err) {
    setMsg(msg, err.message, false);
    loadHub().catch(() => {});
  } finally {
    submit.disabled = false;
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

async function onAudioSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = $("[data-audio-submit]");
  const msg = $("[data-audio-msg]");
  const title = String(form.title?.value || "").trim();
  const file = form.file?.files?.[0];
  if (!file) {
    setMsg(msg, "Elige un archivo de audio.", false);
    return;
  }
  const maxMb = 22;
  const sizeMb = file.size / (1024 * 1024);
  if (sizeMb > maxMb) {
    setMsg(
      msg,
      `El archivo pesa ${sizeMb.toFixed(1)} MB (máx. ${maxMb} MB para Whisper en la nube). Comprime a MP3 mono ~32 kbps (p. ej. con Audacity o ffmpeg) y vuelve a subirlo.`,
      false,
    );
    return;
  }
  submit.disabled = true;
  setMsg(msg, "Subiendo y transcribiendo… puede tardar unos minutos.", true);
  try {
    const audioBase64 = await readFileAsBase64(file);
    const data = await hub("ingestAudio", {
      title: title || file.name.replace(/\.[^.]+$/, ""),
      filename: file.name,
      mime: file.type || "audio/mpeg",
      audioBase64,
      access_mode: form.paid?.checked ? "paid" : "free",
    });
    form.reset();
    const n = data.fragments || data.job?.fragments_created || 0;
    setMsg(msg, `Listo. ${n} fragmentos en el catálogo de Palabra Pura.`, true);
    await loadHub();
    showKbPanel("catalog");
  } catch (err) {
    setMsg(msg, err.message || String(err), false);
    loadHub().catch(() => {});
  } finally {
    submit.disabled = false;
  }
}

document.addEventListener("change", (event) => {
  const allBox = event.target.closest("[data-select-all-videos]");
  if (allBox) {
    lastVideos.map(videoKey).filter(Boolean).forEach((id) => {
      if (allBox.checked) selectedVideoIds.add(id);
      else selectedVideoIds.delete(id);
    });
    document.querySelectorAll("[data-select-video]").forEach((box) => {
      box.checked = allBox.checked;
    });
    updateSelectionUi();
    return;
  }
  const seriesBox = event.target.closest("[data-select-series]");
  if (seriesBox) {
    const key = seriesBox.getAttribute("data-select-series");
    videosForSeries(key).map(videoKey).filter(Boolean).forEach((id) => {
      if (seriesBox.checked) selectedVideoIds.add(id);
      else selectedVideoIds.delete(id);
    });
    document.querySelectorAll(`[data-series-ep="${CSS.escape(key)}"] [data-select-video]`).forEach((box) => {
      box.checked = seriesBox.checked;
    });
    updateSelectionUi();
    return;
  }
  const videoBox = event.target.closest("[data-select-video]");
  if (videoBox) {
    const id = videoBox.getAttribute("data-select-video");
    if (videoBox.checked) selectedVideoIds.add(id);
    else selectedVideoIds.delete(id);
    updateSelectionUi();
  }
});

document.addEventListener("click", async (event) => {
  if (event.target.closest("[data-select-series], [data-select-video], [data-select-all-videos]")) return;
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

function showKbPanel(id) {
  const target = String(id || "catalog");
  document.querySelectorAll("[data-kb-panel]").forEach((panel) => {
    panel.hidden = panel.getAttribute("data-kb-panel") !== target;
  });
  document.querySelectorAll("[data-kb-nav]").forEach((btn) => {
    const active = btn.getAttribute("data-kb-nav") === target;
    btn.classList.toggle("is-active", active);
    if (active) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  try {
    history.replaceState(null, "", `#${target}`);
  } catch {
    /* ignore */
  }
}

function mmss(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n < 0) return "";
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function buildExportText({ facts, documents, videos, fragments, includeFacts = true, includeDocs = true, selected = false }) {
  const byVideo = new Map();
  for (const row of fragments) {
    const id = Number(row.video_id);
    if (!byVideo.has(id)) byVideo.set(id, []);
    byVideo.get(id).push(row);
  }
  for (const list of byVideo.values()) {
    list.sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
  }
  const lines = [];
  const now = new Date().toLocaleString("es-CO");
  lines.push("ENCICLOPEDIA DE PALABRA PURA");
  lines.push("Texto indexado para la IA (transcripciones y datos). No incluye la Biblia completa.");
  lines.push(`Generado: ${now}`);
  lines.push(selected ? "Alcance: selección marcada en el catálogo" : "Alcance: catálogo completo");
  lines.push(`Videos: ${videos.length} · Fragmentos: ${fragments.length}`);
  lines.push("");

  if (includeFacts) {
    lines.push("========== DATOS DEL MINISTERIO ==========");
    lines.push("");
    if (!facts.length) lines.push("(No hay datos verificados.)");
    for (const fact of facts) {
      lines.push(`[${fact.category || "general"}] ${fact.title || ""}`);
      if (fact.status && fact.status !== "active") lines.push(`Estado: ${fact.status}`);
      if ((fact.aliases || []).length) lines.push(`Claves: ${(fact.aliases || []).join(", ")}`);
      lines.push(String(fact.content || "").trim());
      lines.push("");
    }
  }

  if (includeDocs) {
    lines.push("========== DOCUMENTOS ==========");
    lines.push("");
    if (!documents.length) lines.push("(No hay documentos.)");
    for (const doc of documents) {
      lines.push(`# ${doc.title || "Documento"}`);
      if (doc.source_name) lines.push(`Fuente: ${doc.source_name}`);
      lines.push(String(doc.content || "").trim());
      lines.push("");
    }
  }

  const groups = groupVideosBySeries(videos);
  lines.push("========== ENSEÑANZAS POR SERIE ==========");
  lines.push("");
  for (const group of groups) {
    lines.push(`##### SERIE: ${group.name} (${group.videos.length} episodios)`);
    lines.push("");
    for (const video of group.videos) {
      const frags = byVideo.get(Number(video.id)) || [];
      lines.push(`--- ${episodeLabel(video)} ---`);
      if (video.youtube_id) {
        lines.push(`YouTube: https://www.youtube.com/watch?v=${video.youtube_id}`);
      }
      if (video.title) lines.push(`Título: ${video.title}`);
      lines.push("");
      if (!frags.length) {
        lines.push("(Sin transcripción indexada.)");
        lines.push("");
        continue;
      }
      for (const frag of frags) {
        const t = mmss(frag.start_second);
        lines.push(t ? `[${t}]` : `[frag ${Number(frag.position) + 1}]`);
        lines.push(String(frag.content || "").replace(/\s+/g, " ").trim());
        lines.push("");
      }
    }
  }
  return lines.join("\n");
}

function saveTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function downloadAllText({ selectedOnly = false } = {}) {
  const includeFacts = selectedOnly ? Boolean($("[data-export-facts]")?.checked) : true;
  const includeDocs = selectedOnly ? Boolean($("[data-export-docs]")?.checked) : true;
  const allBtn = $("[data-export-text]");
  const selBtn = $("[data-export-selected]");
  const msg = $("[data-export-msg]");
  if (selectedOnly && !selectedVideoIds.size && !includeFacts && !includeDocs) {
    setMsg(msg, "Marca al menos una serie, un episodio, o datos / documentos.", false);
    return;
  }
  if (allBtn) allBtn.disabled = true;
  if (selBtn) selBtn.disabled = true;
  setMsg(msg, "Preparando descarga…", true);
  try {
    let offset = 0;
    let facts = [];
    let documents = [];
    let videos = [];
    const fragments = [];
    while (true) {
      const page = await hub("exportTextPage", { offset, limit: 250 });
      if (page.facts) facts = page.facts;
      if (page.documents) documents = page.documents;
      if (page.videos) videos = page.videos;
      fragments.push(...(page.fragments || []));
      setMsg(msg, `Bajando transcripciones… ${fragments.length} fragmentos`, true);
      if (page.done || !(page.fragments || []).length) break;
      offset += page.fragments.length;
      if (offset > 20000) break;
    }
    if (selectedOnly) {
      videos = videos.filter((video) => selectedVideoIds.has(videoKey(video)));
      const keep = new Set(videos.map((video) => Number(video.id)));
      fragments.splice(0, fragments.length, ...fragments.filter((row) => keep.has(Number(row.video_id))));
    }
    if (!includeFacts) facts = [];
    if (!includeDocs) documents = [];
    if (!videos.length && !facts.length && !documents.length) {
      setMsg(msg, "No hay nada para descargar con esa selección.", false);
      return;
    }
    const text = buildExportText({
      facts,
      documents,
      videos,
      fragments,
      includeFacts,
      includeDocs,
      selected: selectedOnly,
    });
    const day = new Date().toISOString().slice(0, 10);
    saveTextFile(
      selectedOnly ? `palabra-pura-seleccion-${day}.txt` : `palabra-pura-conocimientos-${day}.txt`,
      text,
    );
    setMsg(
      msg,
      `Listo. ${videos.length} video${videos.length === 1 ? "" : "s"}, ${fragments.length} fragmento${fragments.length === 1 ? "" : "s"}.`,
      true,
    );
  } catch (err) {
    setMsg(msg, err.message || String(err), false);
  } finally {
    if (allBtn) allBtn.disabled = false;
    if (selBtn) selBtn.disabled = false;
  }
}

$("[data-fact-form]")?.addEventListener("submit", onFactSubmit);
$("[data-doc-form]")?.addEventListener("submit", onDocSubmit);
$("[data-audio-form]")?.addEventListener("submit", onAudioSubmit);
$("[data-video-form]")?.addEventListener("submit", onVideoSubmit);
$("[data-refresh]")?.addEventListener("click", () => loadHub().catch((err) => alert(err.message)));
$("[data-catalog-filter]")?.addEventListener("input", () => renderCatalog(lastVideos));
$("[data-export-open]")?.addEventListener("click", () => setPicking(true));
$("[data-export-cancel]")?.addEventListener("click", () => setPicking(false));
$("[data-export-text]")?.addEventListener("click", () => downloadAllText());
$("[data-export-selected]")?.addEventListener("click", () => downloadAllText({ selectedOnly: true }));

document.querySelectorAll("[data-kb-nav]").forEach((btn) => {
  btn.addEventListener("click", () => showKbPanel(btn.getAttribute("data-kb-nav")));
});

const hashPanel = String(location.hash || "").replace(/^#/, "");
showKbPanel(["catalog", "facts", "docs", "video", "audio"].includes(hashPanel) ? hashPanel : "catalog");

loadHub().catch((err) => {
  const empty = $("[data-catalog-empty]");
  if (empty) {
    empty.hidden = false;
    empty.textContent = err.message || "No se pudo cargar el catálogo.";
  }
  if ($("[data-generated]")) $("[data-generated]").textContent = err.message;
});
