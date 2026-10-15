/**
 * auth-client.js — Token de admin en el navegador (Fintek + GitHub Pages).
 */

const TOKEN_KEY = "pp_admin_token";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function clearToken() {
  setToken("");
}

export function apiBase() {
  if (typeof location !== "undefined" && /github\.io$/i.test(location.hostname)) {
    // Prefer config if the page loaded it; fallback to same tunnel pattern via meta
    const fromWindow = window.__PP_API_BASE__;
    if (fromWindow) return String(fromWindow).replace(/\/+$/, "");
  }
  return "";
}

export function apiUrl(path) {
  return `${apiBase()}${path}`;
}

export async function authFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(apiUrl(path), { ...options, headers });
  if (res.status === 401 && !options.skipAuthRedirect) {
    clearToken();
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `${apiBase() || ""}/login.html?next=${next}`.replace(
      /^\/login/,
      "/login",
    );
    // On Pages, login is relative
    if (/github\.io$/i.test(location.hostname)) {
      location.href = new URL(`../login.html?next=${next}`, location.href).href;
    }
  }
  return res;
}

export async function ensureAdminSession() {
  const token = getToken();
  if (!token) {
    redirectToLogin();
    return false;
  }
  try {
    const res = await fetch(apiUrl("/api/auth/me"), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      clearToken();
      redirectToLogin();
      return false;
    }
    return true;
  } catch {
    // Si el API no responde, igual dejamos pasar la UI estática con token local
    return Boolean(token);
  }
}

function redirectToLogin() {
  const next = encodeURIComponent(location.pathname + location.search);
  if (/github\.io$/i.test(location.hostname)) {
    location.href = new URL(`../login.html?next=${next}`, location.href).href;
  } else {
    location.href = `/login.html?next=${next}`;
  }
}

export async function logout() {
  try {
    await authFetch("/api/auth/logout", { method: "POST", skipAuthRedirect: true });
  } catch {
    /* ignore */
  }
  clearToken();
  if (/github\.io$/i.test(location.hostname)) {
    location.href = new URL("../login.html", location.href).href;
  } else {
    location.href = "/login.html";
  }
}
