/**
 * admin-boot.js — Exige sesión antes de cargar el panel y cablea "Salir".
 */
import { ensureAdminSession, logout, authFetch, apiUrl } from "../js/auth-client.js?v=panel-login-1";

// En Pages, apunta al túnel Fintek (config o public-url.json).
if (/github\.io$/i.test(location.hostname)) {
  try {
    const mod = await import("../js/config.js");
    let base = mod.config?.fintekBaseUrl || mod.config?.serverBaseUrl || "";
    if (!base) {
      const res = await fetch(`../public-url.json?_=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        base = data.serverBaseUrl || data.baseUrl || data.chatUrl || "";
      }
    }
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
