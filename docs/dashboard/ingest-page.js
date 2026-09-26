const API_BASE = (() => {
  if (typeof location !== "undefined" && /github\.io$/i.test(location.hostname)) {
    return "https://earrings-balance-towers-bid.trycloudflare.com";
  }
  return "";
})();
function apiUrl(path) {
  return `${API_BASE}${path}`;
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

const form = document.querySelector("[data-ingest-form]");
const msg = document.querySelector("[data-form-msg]");
const submitBtn = document.querySelector("[data-submit]");

async function loadJobs() {
  const res = await fetch(apiUrl("/api/ingest/jobs", { cache: "no-store" });
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
    document.querySelector("[data-jobs-empty]").hidden = false;
    document.querySelector("[data-jobs-empty]").textContent =
      "No se pudo cargar la cola. ¿Migración ingest_job aplicada?";
  }
}

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  msg.hidden = true;
  const fd = new FormData(form);
  const url = String(fd.get("url") || "").trim();
  const file = fd.get("file");
  const hasFile = file && file.size > 0;
  if (!url && !hasFile) {
    msg.hidden = false;
    msg.textContent = "Pega un link de YouTube o elige un archivo.";
    msg.className = "form-msg form-msg--err";
    return;
  }
  if (url && hasFile) {
    msg.hidden = false;
    msg.textContent = "Usa solo link o solo archivo, no ambos a la vez.";
    msg.className = "form-msg form-msg--err";
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Enviando…";
  try {
    const body = new FormData();
    const title = String(fd.get("title") || "").trim();
    if (title) body.append("title", title);
    if (hasFile) body.append("file", file);
    else body.append("url", url);

    const res = await fetch(apiUrl("/api/ingest", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    form.reset();
    msg.hidden = false;
    msg.className = "form-msg form-msg--ok";
    msg.textContent = `Trabajo #${data.job.id} en cola. Se procesa en segundo plano.`;
    refreshJobs();
  } catch (err) {
    msg.hidden = false;
    msg.className = "form-msg form-msg--err";
    msg.textContent = err.message || String(err);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Indexar";
  }
});

document.querySelector("[data-refresh-jobs]").addEventListener("click", refreshJobs);
refreshJobs();
setInterval(refreshJobs, 5000);
