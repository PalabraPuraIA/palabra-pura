import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { apiUrl, setToken, getToken } from "./auth-client.js";
import { config } from "./config.js";

const ON_PAGES = typeof location !== "undefined" && /github\.io$/i.test(location.hostname);
const GOOGLE_SESSION_KEY = "pp_google_session";
const DEVICE_KEY = "pp_device_id";
const MAX_GOOGLE_EMAILS = 2;

/** Id estable del navegador para limitar correos distintos de Google. */
function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (id && id.length >= 8) return id.slice(0, 64);
    id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, "")
        : `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return `d${Date.now().toString(36)}fallback`;
  }
}

/**
 * Guarda el usuario en app_user y valida el tope de correos por dispositivo.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function registerGoogleUser(supabase, user) {
  const name =
    user?.user_metadata?.full_name || user?.user_metadata?.name || "";
  const { data, error } = await supabase.rpc("register_google_login", {
    p_device_id: getDeviceId(),
    p_name: name,
  });
  if (error) {
    console.warn("[login] register_google_login", error.message);
    // Si la migración aún no está en la nube, no bloqueamos el chat.
    if (/register_google_login|schema cache|does not exist/i.test(error.message || "")) {
      return { ok: true, skipped: true };
    }
    return { ok: false, error: error.message };
  }
  if (data && data.ok === false) {
    return { ok: false, error: data.error || "register_failed", limit: data.limit };
  }
  return { ok: true, data };
}

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
const googleBtn = document.querySelector("[data-google-login]");

function showMsg(text, ok = false) {
  msg.hidden = false;
  msg.className = `login-msg ${ok ? "login-msg--ok" : "login-msg--err"}`;
  msg.textContent = text;
}

function supabaseClient() {
  const url = String(config.supabaseUrl || "").replace(/\/+$/, "");
  const key = String(config.publishableKey || "");
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: {
      persistSession: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  });
}

function rememberAuthUser(user) {
  try {
    localStorage.setItem(
      GOOGLE_SESSION_KEY,
      JSON.stringify({
        email: user?.email || "",
        name: user?.user_metadata?.full_name || user?.user_metadata?.name || "",
        at: Date.now(),
      }),
    );
  } catch {
    /* ignore */
  }
}

function chatHome() {
  return ON_PAGES ? new URL("./", location.href).href : "/";
}

function friendlyAuthError(err) {
  const message = String(err?.message || err || "");
  if (/already registered|already been registered/i.test(message)) {
    return "Ese correo ya tiene cuenta. Entra con tu contraseña.";
  }
  if (/invalid login/i.test(message)) return "Correo o contraseña incorrectos.";
  if (/email not confirmed/i.test(message)) return "Confirma tu correo y vuelve a entrar.";
  if (/provider is not enabled|signup is disabled|Email logins are disabled/i.test(message)) {
    return "Activa el proveedor Email en Supabase (Authentication → Providers).";
  }
  return message || "No se pudo entrar.";
}

await resolveApiBase();

const supabase = supabaseClient();
if (supabase) {
  const { data } = await supabase.auth.getSession();
  if (data?.session?.user) {
    const reg = await registerGoogleUser(supabase, data.session.user);
    if (!reg.ok) {
      await supabase.auth.signOut().catch(() => {});
      try {
        localStorage.removeItem(GOOGLE_SESSION_KEY);
      } catch {
        /* ignore */
      }
      showMsg(
        reg.error === "too_many_accounts"
          ? `Este dispositivo ya usó ${reg.limit || MAX_GOOGLE_EMAILS} correos distintos. Entra con uno de los que ya registraste.`
          : "No se pudo validar tu cuenta de Google. Intenta de nuevo.",
      );
    } else {
      rememberAuthUser(data.session.user);
      location.href = chatHome();
    }
  }
}

googleBtn?.addEventListener("click", async () => {
  msg.hidden = true;
  if (!supabase) {
    showMsg("Falta la configuración de Supabase para Google.");
    return;
  }
  googleBtn.disabled = true;
  try {
    const redirectTo = new URL("./login.html", location.href).href;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) throw error;
  } catch (err) {
    showMsg(
      err?.message?.includes("provider is not enabled")
        ? "Activa el proveedor Google en Supabase (Authentication → Providers) y agrega esta URL de redirección."
        : err?.message || String(err),
    );
    googleBtn.disabled = false;
  }
});

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

const emailForm = document.querySelector("[data-email-form]");
const emailSignin = document.querySelector("[data-email-signin]");
const emailSignup = document.querySelector("[data-email-signup]");

async function emailAuth(mode) {
  if (!emailForm) return;
  const fd = new FormData(emailForm);
  const email = String(fd.get("email") || "").trim();
  const password = String(fd.get("password") || "");
  if (!email || !password) {
    showMsg("Escribe tu correo y una contraseña.");
    return;
  }
  if (password.length < 6) {
    showMsg("La contraseña debe tener al menos 6 caracteres.");
    return;
  }
  if (!supabase) {
    showMsg("Falta la configuración de Supabase.");
    return;
  }
  if (emailSignin) emailSignin.disabled = true;
  if (emailSignup) emailSignup.disabled = true;
  try {
    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      if (data.session?.user) {
        rememberAuthUser(data.session.user);
        location.href = chatHome();
        return;
      }
      showMsg("Cuenta creada. Revisa tu correo para confirmarla y luego entra.", true);
      return;
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (data.session?.user) {
      rememberAuthUser(data.session.user);
      location.href = chatHome();
    }
  } catch (err) {
    showMsg(friendlyAuthError(err));
  } finally {
    if (emailSignin) emailSignin.disabled = false;
    if (emailSignup) emailSignup.disabled = false;
  }
}

emailForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  emailAuth("signin");
});
emailSignup?.addEventListener("click", () => emailAuth("signup"));

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
