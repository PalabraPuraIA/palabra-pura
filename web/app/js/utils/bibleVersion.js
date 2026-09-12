/**
 * bibleVersion.js — Preferencia TLA / Reina-Valera en el navegador.
 */

const STORAGE_KEY = "pp-bible-version";

/** @returns {"tla"|"rva"} */
export function getPreferredBibleVersion() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "rva" ? "rva" : "tla";
  } catch {
    return "tla";
  }
}

/** @param {"tla"|"rva"} id */
export function setPreferredBibleVersion(id) {
  const next = id === "rva" ? "rva" : "tla";
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* private mode */
  }
  return next;
}

/** @param {string} [label] */
export function versionIdFromLabel(label) {
  const s = String(label || "").toLowerCase();
  if (s.includes("tla") || s.includes("lenguaje actual")) return "tla";
  return "rva";
}

/**
 * Muestra la versión elegida dentro de un panel de versículos.
 * @param {HTMLElement} panel
 * @param {"tla"|"rva"} versionId
 */
export function applyBibleVersionToPanel(panel, versionId) {
  if (!panel) return;

  panel.querySelectorAll("[data-bible-version]").forEach((tab) => {
    const on = tab.getAttribute("data-bible-version") === versionId;
    tab.classList.toggle("source__tab--active", on);
    tab.setAttribute("aria-pressed", on ? "true" : "false");
  });

  panel.querySelectorAll(".source__verse").forEach((verse) => {
    const blocks = [...verse.querySelectorAll("[data-version]")];
    if (!blocks.length) return;

    let shown = false;
    for (const block of blocks) {
      const match = block.getAttribute("data-version") === versionId;
      block.hidden = !match;
      block.classList.toggle("source__version--active", match);
      if (match) shown = true;
    }
    // Si la versión pedida no existe en este versículo, muestra la primera.
    if (!shown && blocks[0]) {
      blocks[0].hidden = false;
      blocks[0].classList.add("source__version--active");
    }
  });
}

/** Aplica la preferencia a todos los paneles visibles del chat. */
export function applyBibleVersionEverywhere(versionId) {
  document.querySelectorAll("[data-bible-panel]").forEach((panel) => {
    applyBibleVersionToPanel(panel, versionId);
  });
}
