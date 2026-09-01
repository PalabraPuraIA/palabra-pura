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

function fmtWhen(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("es-CO", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

async function load() {
  const res = await fetch("/api/analytics/summary", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
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

  const tbody = document.querySelector("[data-recent]");
  const recentEmpty = document.querySelector("[data-recent-empty]");
  const recent = data.recent || [];
  if (!recent.length) {
    tbody.innerHTML = "";
    recentEmpty.hidden = false;
  } else {
    recentEmpty.hidden = true;
    tbody.innerHTML = recent
      .map((r) => {
        const tags = (r.topics || [])
          .map((id) => `<span class="tag">${escapeHtml(TOPIC_LABELS[id] || id)}</span>`)
          .join("");
        return `<tr>
          <td class="when">${escapeHtml(fmtWhen(r.at))}</td>
          <td>${escapeHtml(r.question)}</td>
          <td>${tags}</td>
        </tr>`;
      })
      .join("");
  }

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
      "No se pudo cargar el resumen. ¿El servidor web está activo?";
  }
}

document.querySelector("[data-refresh]").addEventListener("click", refresh);
refresh();
setInterval(refresh, 15000);
