import { apiUrl, setToken, getToken } from "./auth-client.js";

// En GitHub Pages, el API vive en el túnel Fintek (si config lo define).
async function resolveApiBase() {
  if (!/github\.io$/i.test(location.hostname)) return;
  try {
    const mod = await import("./config.js");
    const base = mod.config?.fintekBaseUrl || "";
    if (base) window.__PP_API_BASE__ = String(base).replace(/\/+$/, "");
  } catch {
    /* config opcional */
  }
}

function nextTarget() {
  const params = new URLSearchParams(location.search);
  const next = params.get("next") || "/dashboard/";
  // Evitar open redirect
  if (!next.startsWith("/") && !next.includes("/dashboard")) return "/dashboard/";
  if (next.includes("://") && !next.includes(location.host) && !/github\.io/.test(next)) {
    return "/dashboard/";
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
