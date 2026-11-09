import { apiUrl, setToken, getToken } from "./auth-client.js";

const ON_PAGES = typeof location !== "undefined" && /github\.io$/i.test(location.hostname);

/** En Pages, resuelve el API Fintek vía public-url.json (túnel vivo). */
async function resolveApiBase() {
  if (!ON_PAGES) return;
  let origin = "";

  try {
    const res = await fetch(new URL("./public-url.json", location.href).href, {
      cache: "no-store",
    });
    const data = await res.json();
    const candidate = data?.baseUrl || data?.chatUrl || data?.dashboardUrl || "";
    if (candidate) origin = new URL(candidate, location.href).origin;
  } catch {
    /* ignore */
  }

  if (!origin) {
    try {
      const mod = await import("./config.js");
      const fallback = mod.config?.fintekBaseUrl || mod.config?.serverBaseUrl || "";
      if (fallback) origin = new URL(fallback, location.href).origin;
    } catch {
      /* ignore */
    }
  }

  if (origin) window.__PP_API_BASE__ = origin.replace(/\/+$/, "");
}

function nextTarget() {
  const params = new URLSearchParams(location.search);
  const fallback = ON_PAGES ? new URL("./dashboard/", location.href).href : "/dashboard/";
  let next = params.get("next") || fallback;
  if (next.includes("://") && !next.includes(location.host) && !/github\.io/.test(next)) {
    return fallback;
  }
  if (ON_PAGES) {
    if (next.startsWith("/dashboard")) {
      return new URL("." + next, location.href).href;
    }
    if (next === "/" || next === "/login.html") {
      return fallback;
    }
  } else if (!next.startsWith("/") && !next.includes("/dashboard")) {
    return fallback;
  }
  return next;
}

async function tryRemoteLogin(username, password) {
  const res = await fetch(apiUrl("/api/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.ok && data.token) return data.token;
  const err = new Error(
    data.error ||
      (res.status === 401
        ? "Usuario o contraseña incorrectos"
        : `No se pudo conectar al servidor (${res.status})`),
  );
  err.rejected = true;
  throw err;
}

const form = document.querySelector("[data-login-form]");
const msg = document.querySelector("[data-msg]");
const submit = document.querySelector("[data-submit]");
const chatLink = document.querySelector("[data-chat-link]");

if (chatLink) {
  chatLink.href = ON_PAGES ? new URL("./", location.href).href : "/";
}

await resolveApiBase();

// Sesión previa: solo tokens reales del API (no pp-panel.* legado).
const existing = getToken();
if (existing && !String(existing).startsWith("pp-panel.")) {
  if (ON_PAGES) {
    location.href = nextTarget();
  } else {
    try {
      const res = await fetch(apiUrl("/api/auth/me"), {
        headers: { Authorization: `Bearer ${existing}` },
        cache: "no-store",
      });
      if (res.ok) location.href = nextTarget();
    } catch {
      /* stay on login */
    }
  }
}

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  msg.hidden = true;
  const fd = new FormData(form);
  const username = String(fd.get("username") || "").trim();
  const password = String(fd.get("password") || "");
  submit.disabled = true;
  submit.textContent = "Entrando…";
  try {
    const token = await tryRemoteLogin(username, password);
    setToken(token);
    location.href = nextTarget();
  } catch (err) {
    msg.hidden = false;
    msg.className = "login-msg login-msg--err";
    msg.textContent = err.message || String(err);
  } finally {
    submit.disabled = false;
    submit.textContent = "Entrar al panel";
  }
});
