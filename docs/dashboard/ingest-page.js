const SUPABASE_URL = "https://jkffgudzlcemapxprbws.supabase.co";
const SUPABASE_ANON = "sb_publishable_WVH-EXfKrrBn9P8US9OA0w_Py4FSmzW";
const ON_PAGES = typeof location !== "undefined" && /github\.io$/i.test(location.hostname);
const HUB = `${SUPABASE_URL}/functions/v1/knowledge-hub`;

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

async function loadJobs() {
  if (ON_PAGES) {
    const data = await hub("list");
    return { jobs: data.jobs || [] };
  }
  const res = await fetch("/api/ingest/jobs", { cache: "no-store" });
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
      "No se pudo cargar la cola.";
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
  submitBtn.textContent = "Indexando…";
  try {
    const title = String(fd.get("title") || "").trim();
    if (ON_PAGES) {
      if (hasFile) {
        throw new Error("En GitHub Pages sube el video por link de YouTube. El archivo se transcribe en el servidor local.");
      }
      msg.hidden = false;
      msg.className = "form-msg form-msg--ok";
      msg.textContent = "Indexando ahora… puede tardar un minuto.";
      const data = await hub("ingestVideo", { url, title });
      let job = data.job;
      if (data.started && job?.id) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < 240000) {
          const listed = await hub("list");
          job = (listed.jobs || []).find((j) => Number(j.id) === Number(job.id)) || job;
          if (job.progress) msg.textContent = job.progress;
          if (job.status === "done") break;
          if (job.status === "error") throw new Error(job.error || "Error al indexar");
          await new Promise((r) => setTimeout(r, 2500));
        }
        if (job.status !== "done") throw new Error("Sigue indexando. Recarga en un minuto.");
      }
      form.reset();
      msg.textContent = `Listo${job?.fragments_created ? ` · ${job.fragments_created} fragmentos` : ""}. Ya puedes preguntarle a Blaze.`;
      refreshJobs();
      return;
    }

    const body = new FormData();
    if (title) body.append("title", title);
    if (hasFile) body.append("file", file);
    else body.append("url", url);
    const res = await fetch("/api/ingest", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
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
