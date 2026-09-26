const CATEGORY_LABELS = {
  horario: "Horario",
  persona: "Persona",
  terminologia: "Terminología",
  lugar: "Lugar",
  contacto: "Contacto",
  general: "General",
};

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

async function loadCorpus() {
  const res = await fetch("/api/corpus", { cache: "no-store" });
  if (!res.ok) throw new Error(`corpus HTTP ${res.status}`);
  return res.json();
}

async function loadKnowledge() {
  const res = await fetch("/api/knowledge", { cache: "no-store" });
  if (!res.ok) throw new Error(`knowledge HTTP ${res.status}`);
  return res.json();
}

async function loadFacts() {
  const res = await fetch("/api/facts", { cache: "no-store" });
  if (!res.ok) throw new Error(`facts HTTP ${res.status}`);
  return res.json();
}

function renderCorpus(data) {
  const st = data.stats || {};
  document.querySelector("[data-videos]").textContent = st.videos ?? 0;

  const tbody = document.querySelector("[data-videos-body]");
  const empty = document.querySelector("[data-videos-empty]");
  const videos = data.videos || [];
  if (!videos.length) {
    tbody.innerHTML = "";
    empty.hidden = false;
  } else {
    empty.hidden = true;
    tbody.innerHTML = videos
      .map((v) => {
        const id = v.youtube_id || "";
        const link = /^[a-zA-Z0-9_-]{11}$/.test(id)
          ? `<a href="https://www.youtube.com/watch?v=${escapeHtml(id)}" target="_blank" rel="noopener">${escapeHtml(id)}</a>`
          : escapeHtml(id);
        return `<tr>
          <td>${escapeHtml(v.title)}</td>
          <td>${link}</td>
          <td>${v.fragments ?? 0}</td>
          <td class="when">${escapeHtml(fmtWhen(v.updated_at || v.created_at))}</td>
        </tr>`;
      })
      .join("");
  }
}

function renderKnowledge(data) {
  const st = data.stats || {};
  document.querySelector("[data-kb-total]").textContent = st.total ?? 0;

  const tbody = document.querySelector("[data-kb-body]");
  const empty = document.querySelector("[data-kb-empty]");
  const entries = data.entries || [];
  if (!entries.length) {
    tbody.innerHTML = "";
    empty.hidden = false;
  } else {
    empty.hidden = true;
    tbody.innerHTML = entries
      .map((e) => {
        const answer = String(e.answer || "").slice(0, 160);
        return `<tr>
          <td>
            <strong>${escapeHtml(e.question_display)}</strong>
            <div class="muted">${escapeHtml(answer)}${answer.length >= 160 ? "…" : ""}</div>
            ${e.video_title ? `<div class="muted">Video: ${escapeHtml(e.video_title)}</div>` : ""}
          </td>
          <td>${statusBadge(e.status)}</td>
          <td>+${e.useful_count || 0} / −${e.not_useful_count || 0}</td>
          <td class="row-actions">
            <button type="button" class="btn btn--tiny" data-stale="${e.id}">Archivar</button>
            <button type="button" class="btn btn--tiny btn--danger" data-del="${e.id}">Borrar</button>
          </td>
        </tr>`;
      })
      .join("");
  }
}

function renderFacts(data) {
  const st = data.stats || {};
  document.querySelector("[data-facts-n]").textContent = st.active ?? st.total ?? 0;

  const tbody = document.querySelector("[data-facts-body]");
  const empty = document.querySelector("[data-facts-empty]");
  const facts = data.facts || [];
  if (!facts.length) {
    tbody.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  tbody.innerHTML = facts
    .map((f) => {
      const aliases = (f.aliases || []).map((a) => `<span class="tag">${escapeHtml(a)}</span>`).join("");
      const archived = f.status === "archived";
      return `<tr class="${archived ? "row--muted" : ""}">
        <td><span class="badge">${escapeHtml(CATEGORY_LABELS[f.category] || f.category)}</span>
          ${archived ? statusBadge("archived") : ""}</td>
        <td>
          <strong>${escapeHtml(f.title)}</strong>
          <div class="muted">${escapeHtml(f.content)}</div>
        </td>
        <td>${aliases || "—"}</td>
        <td class="row-actions">
          ${
            archived
              ? `<button type="button" class="btn btn--tiny" data-fact-activate="${f.id}">Activar</button>`
              : `<button type="button" class="btn btn--tiny" data-fact-archive="${f.id}">Archivar</button>`
          }
          <button type="button" class="btn btn--tiny btn--danger" data-fact-del="${f.id}">Borrar</button>
        </td>
      </tr>`;
    })
    .join("");
}

async function refresh() {
  try {
    const [corpus, kb, facts] = await Promise.all([loadCorpus(), loadKnowledge(), loadFacts()]);
    renderCorpus(corpus);
    renderKnowledge(kb);
    renderFacts(facts);
    document.querySelector("[data-generated]").textContent =
      `Actualizado: ${fmtWhen(new Date().toISOString())}`;
  } catch (err) {
    console.error(err);
    document.querySelector("[data-generated]").textContent =
      "No se pudo cargar. ¿Postgres activo y migraciones aplicadas?";
  }
}

document.querySelector("[data-refresh]").addEventListener("click", refresh);

document.querySelector("[data-kb-body]").addEventListener("click", async (ev) => {
  const stale = ev.target.closest("[data-stale]");
  const del = ev.target.closest("[data-del]");
  if (stale) {
    await fetch(`/api/knowledge/${stale.dataset.stale}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "stale" }),
    });
    refresh();
  }
  if (del && confirm("¿Borrar esta entrada FAQ?")) {
    await fetch(`/api/knowledge/${del.dataset.del}`, { method: "DELETE" });
    refresh();
  }
});

document.querySelector("[data-facts-body]").addEventListener("click", async (ev) => {
  const archive = ev.target.closest("[data-fact-archive]");
  const activate = ev.target.closest("[data-fact-activate]");
  const del = ev.target.closest("[data-fact-del]");
  if (archive) {
    await fetch(`/api/facts/${archive.dataset.factArchive}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
    refresh();
  }
  if (activate) {
    await fetch(`/api/facts/${activate.dataset.factActivate}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    refresh();
  }
  if (del && confirm("¿Borrar este dato puntual?")) {
    await fetch(`/api/facts/${del.dataset.factDel}`, { method: "DELETE" });
    refresh();
  }
});

const factForm = document.querySelector("[data-fact-form]");
const factMsg = document.querySelector("[data-fact-msg]");
const factSubmit = document.querySelector("[data-fact-submit]");

factForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  factMsg.hidden = true;
  const fd = new FormData(factForm);
  const body = {
    category: String(fd.get("category") || "general"),
    title: String(fd.get("title") || "").trim(),
    content: String(fd.get("content") || "").trim(),
    aliases: String(fd.get("aliases") || ""),
  };
  if (!body.title || !body.content) {
    factMsg.hidden = false;
    factMsg.className = "form-msg form-msg--err";
    factMsg.textContent = "Título y respuesta son obligatorios.";
    return;
  }
  factSubmit.disabled = true;
  try {
    const res = await fetch("/api/facts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    factForm.reset();
    factForm.querySelector('[name="category"]').value = "general";
    factMsg.hidden = false;
    factMsg.className = "form-msg form-msg--ok";
    factMsg.textContent = "Dato guardado. El chat ya puede usarlo.";
    refresh();
  } catch (err) {
    factMsg.hidden = false;
    factMsg.className = "form-msg form-msg--err";
    factMsg.textContent = err.message || String(err);
  } finally {
    factSubmit.disabled = false;
  }
});

refresh();
setInterval(refresh, 20000);
