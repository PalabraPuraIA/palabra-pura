import { apiUrl, setToken, getToken } from "./auth-client.js";

// En GitHub Pages, el API vive en el túnel Fintek (si config lo define).
async function resolveApiBase() {
  if (!/github\.io$/i.test(location.hostname)) return;
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
  const onPages = /github\.io$/i.test(location.hostname);
  const fallback = onPages ? new URL("./dashboard/", location.href).href : "/dashboard/";
  let next = params.get("next") || fallback;
  // Evitar open redirect
  if (next.includes("://") && !next.includes(location.host) && !/github\.io/.test(next)) {
    return fallback;
  }
  if (onPages) {
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

const form = document.querySelector("[data-login-form]");
const msg = document.querySelector("[data-msg]");
const submit = document.querySelector("[data-submit]");

await resolveApiBase();

// Ya logueado → panel
if (getToken()) {
  try {
    const res = await fetch(apiUrl("/api/auth/me"), {
      headers: { Authorization: `Bearer ${getToken()}` },
      cache: "no-store",
    });
    if (res.ok) {
      location.href = nextTarget();
    }
  } catch {
    /* stay on login */
  }
}

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  msg.hidden = true;
  const fd = new FormData(form);
  submit.disabled = true;
  submit.textContent = "Entrando…";
  try {
    const res = await fetch(apiUrl("/api/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: String(fd.get("username") || "").trim(),
        password: String(fd.get("password") || ""),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok || !data.token) {
      throw new Error(data.error || "No se pudo iniciar sesión");
    }
    setToken(data.token);
    location.href = nextTarget();
  } catch (err) {
    msg.hidden = false;
    msg.className = "login-msg login-msg--err";
    msg.textContent = err.message || String(err);
  } finally {
    submit.disabled = false;
    submit.textContent = "Entrar";
  }
});
