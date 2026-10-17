import { adminFetch } from "./admin-boot.js";

const ON_PAGES = typeof location !== "undefined" && /github\.io$/i.test(location.hostname);
const SUPABASE_URL = "https://jkffgudzlcemapxprbws.supabase.co";
const SUPABASE_ANON = "sb_publishable_WVH-EXfKrrBn9P8US9OA0w_Py4FSmzW";
const HUB = `${SUPABASE_URL}/functions/v1/knowledge-hub`;

async function hub(action, extra = {}) {
  const res = await fetch(HUB, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON}`,
      apikey: SUPABASE_ANON,
    },
    body: JSON.stringify({ action, ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtWhen(iso) {
  try {
    return new Date(iso).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso || "—";
  }
}

function statusBadge(status) {
  const s = String(status || "—");
  return `<span class="badge badge--${escapeHtml(s)}">${escapeHtml(s)}</span>`;
}

function showIngestPanel(id) {
  const target = String(id || "youtube");
  document.querySelectorAll("[data-ingest-panel]").forEach((panel) => {
    panel.hidden = panel.getAttribute("data-ingest-panel") !== target;
  });
  document.querySelectorAll("[data-ingest-nav]").forEach((btn) => {
    const active = btn.getAttribute("data-ingest-nav") === target;
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

async function loadJobs() {
  if (ON_PAGES) {
    const data = await hub("list");
    return { jobs: data.jobs || [] };
  }
  const res = await adminFetch("/api/ingest/jobs", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function renderJobs(data) {
  const tbody = document.querySelector("[data-jobs]");
  const empty = document.querySelector("[data-jobs-empty]");
  const jobs = data.jobs || [];
  if (!jobs.length) {
    tbody.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  tbody.innerHTML = jobs
    .map((j) => {
      const source =
        j.source_type === "youtube"
          ? `<a href="${escapeHtml(j.source_url || "#")}" target="_blank" rel="noopener">YouTube</a>`
          : escapeHtml(j.source_type);
      const detail = j.error
        ? `<span class="err">${escapeHtml(j.error)}</span>`
        : escapeHtml(j.progress || "");
      return `<tr>
        <td class="when">${escapeHtml(fmtWhen(j.created_at))}</td>
        <td>${source}</td>
        <td>${escapeHtml(j.title || "—")}</td>
        <td>${statusBadge(j.status)}</td>
        <td>${detail}${j.fragments_created ? ` · ${j.fragments_created} frag.` : ""}</td>
      </tr>`;
    })
    .join("");
}

async function refreshJobs() {
  try {
    renderJobs(await loadJobs());
  } catch (err) {
    console.error(err);
    const empty = document.querySelector("[data-jobs-empty]");
    empty.hidden = false;
    empty.textContent = "No se pudo cargar la cola.";
  }
}

async function submitYoutube(ev) {
  ev.preventDefault();
  const form = ev.currentTarget;
  const msg = form.querySelector("[data-form-msg]");
  const submitBtn = form.querySelector("[data-submit]");
  msg.hidden = true;
  const fd = new FormData(form);
  const url = String(fd.get("url") || "").trim();
  const title = String(fd.get("title") || "").trim();
  if (!url) {
    msg.hidden = false;
    msg.className = "form-msg form-msg--err";
    msg.textContent = "Pega un link de YouTube.";
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Enviando…";
  try {
    if (ON_PAGES) {
      const data = await hub("ingestVideo", { url, title });
      form.reset();
      msg.hidden = false;
      msg.className = "form-msg form-msg--ok";
      const n = data.job?.fragments_created || data.fragments || 0;
      msg.textContent = n
        ? `Listo. ${n} fragmentos en la nube.`
        : "Indexando en la nube. Mira la cola en un momento.";
      refreshJobs();
      return;
    }

    const body = new FormData();
    if (title) body.append("title", title);
    body.append("url", url);
    const res = await adminFetch("/api/ingest", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    form.reset();
    msg.hidden = false;
    msg.className = "form-msg form-msg--ok";
    msg.textContent = `Trabajo #${data.job.id} en cola.`;
    refreshJobs();
    showIngestPanel("jobs");
  } catch (err) {
    msg.hidden = false;
    msg.className = "form-msg form-msg--err";
    msg.textContent = err.message || String(err);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Indexar";
  }
}

async function submitFile(ev) {
  ev.preventDefault();
  const form = ev.currentTarget;
  const msg = form.querySelector("[data-form-msg-file]");
  const submitBtn = form.querySelector("[data-submit-file]");
  msg.hidden = true;
  const fd = new FormData(form);
  const title = String(fd.get("title") || "").trim();
  const file = fd.get("file");
  if (!file || !file.size) {
    msg.hidden = false;
    msg.className = "form-msg form-msg--err";
    msg.textContent = "Elige un archivo.";
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Enviando…";
  try {
    const body = new FormData();
    if (title) body.append("title", title);
    body.append("file", file);
    const res = await adminFetch("/api/ingest", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    form.reset();
    msg.hidden = false;
    msg.className = "form-msg form-msg--ok";
    msg.textContent = `Trabajo #${data.job.id} en cola.`;
    refreshJobs();
    showIngestPanel("jobs");
  } catch (err) {
    msg.hidden = false;
    msg.className = "form-msg form-msg--err";
    msg.textContent = err.message || String(err);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Indexar archivo";
  }
}

document.querySelectorAll("[data-ingest-nav]").forEach((btn) => {
  btn.addEventListener("click", () => showIngestPanel(btn.getAttribute("data-ingest-nav")));
});
document.querySelector("[data-ingest-form]")?.addEventListener("submit", submitYoutube);
document.querySelector("[data-ingest-form-file]")?.addEventListener("submit", submitFile);
document.querySelector("[data-refresh-jobs]")?.addEventListener("click", refreshJobs);

const hash = String(location.hash || "").replace(/^#/, "");
showIngestPanel(["youtube", "file", "jobs"].includes(hash) ? hash : "youtube");
refreshJobs();
setInterval(refreshJobs, 5000);
