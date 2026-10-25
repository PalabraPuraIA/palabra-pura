import { apiUrl, setToken, getToken } from "./auth-client.js";

const ON_PAGES = typeof location !== "undefined" && /github\.io$/i.test(location.hostname);

/** Misma clave que stack/docker-compose.yml (ADMIN_PASSWORD). */
const PANEL_USER = "admin";
const PANEL_PASSWORDS = ["Palabra123*", "palabra"];

function panelCredentialsOk(username, password) {
  return username === PANEL_USER && PANEL_PASSWORDS.includes(password);
}

function issuePanelToken() {
  setToken(`pp-panel.${Date.now()}`);
}

// En GitHub Pages, el API vive en el túnel Fintek (si config lo define).
async function resolveApiBase() {
  if (!ON_PAGES) return;
  let base = "";
  try {
    const mod = await import("./config.js");
    base = mod.config?.fintekBaseUrl || mod.config?.serverBaseUrl || "";
  } catch {
    /* config puede fallar; seguimos con public-url */
  }
  if (!base) {
    try {
      const res = await fetch(new URL("./public-url.json", location.href).href, {
        cache: "no-store",
      });
      const data = await res.json();
      base = data?.baseUrl || "";
    } catch {
      /* ignore */
    }
  }
  if (base) window.__PP_API_BASE__ = String(base).replace(/\/+$/, "");
}

function nextTarget() {
  const params = new URLSearchParams(location.search);
  const fallback = ON_PAGES ? new URL("./dashboard/", location.href).href : "/dashboard/";
  let next = params.get("next") || fallback;
  // Evitar open redirect
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
    signal: AbortSignal.timeout(6000),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.ok && data.token) return data.token;
  if (res.status === 401) {
    const err = new Error(data.error || "Usuario o contraseña incorrectos");
    err.rejected = true;
    throw err;
  }
  return null;
}

const form = document.querySelector("[data-login-form]");
const msg = document.querySelector("[data-msg]");
const submit = document.querySelector("[data-submit]");

await resolveApiBase();

// Ya logueado → panel. En Pages el túnel no tiene que estar vivo.
if (getToken()) {
  if (ON_PAGES || String(getToken()).startsWith("pp-panel.")) {
    location.href = nextTarget();
  } else {
    try {
      const res = await fetch(apiUrl("/api/auth/me"), {
        headers: { Authorization: `Bearer ${getToken()}` },
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
    let token = null;
    try {
      token = await tryRemoteLogin(username, password);
    } catch (err) {
      if (err.rejected) throw err;
    }
    if (token) {
      setToken(token);
      location.href = nextTarget();
      return;
    }
    if (panelCredentialsOk(username, password)) {
      issuePanelToken();
      location.href = nextTarget();
      return;
    }
    throw new Error("Usuario o contraseña incorrectos");
  } catch (err) {
    msg.hidden = false;
    msg.className = "login-msg login-msg--err";
    msg.textContent = err.message || String(err);
  } finally {
    submit.disabled = false;
    submit.textContent = "Entrar";
  }
});
