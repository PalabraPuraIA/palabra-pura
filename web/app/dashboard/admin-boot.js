/**
 * admin-boot.js — Exige sesión antes de cargar el panel y cablea "Salir".
 */
import { ensureAdminSession, logout, authFetch, apiUrl } from "../js/auth-client.js?v=kb-audio-5";

// En Pages, apunta al túnel Fintek si hay config.
if (/github\.io$/i.test(location.hostname)) {
  try {
    const mod = await import("../js/config.js");
    const base = mod.config?.fintekBaseUrl || "";
    if (base) window.__PP_API_BASE__ = String(base).replace(/\/+$/, "");
  } catch {
    /* ok */
  }
}

const ok = await ensureAdminSession();
if (!ok) {
  // ensureAdminSession ya redirige
  throw new Error("auth required");
}

document.querySelectorAll("[data-logout]").forEach((btn) => {
  btn.addEventListener("click", () => logout());
});

/** fetch autenticado para las páginas del panel */
export function adminFetch(path, options) {
  return authFetch(path, options);
}

export { apiUrl, authFetch };
