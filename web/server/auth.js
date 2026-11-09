/**
 * auth.js — Login del panel admin (dashboard).
 * Usa panel_user en Postgres cuando hay tablas RBAC;
 * si aún no hay usuarios, hace bootstrap desde ADMIN_USER/ADMIN_PASSWORD.
 * El chat público no pasa por aquí.
 */

import crypto from "node:crypto";
import { verifyPassword } from "./panel-passwords.js";
import {
  bootstrapSuperadmin,
  countPanelUsers,
  findUserByLogin,
  getAuthProfile,
  touchLogin,
} from "./panel-rbac.js";
import { panelTablesReady } from "./panel-db.js";

const COOKIE = "pp_admin";
const TTL_MS = 7 * 24 * 3600 * 1000;

function adminUser() {
  return String(process.env.ADMIN_USER || "admin").trim();
}

function adminPassword() {
  return String(process.env.ADMIN_PASSWORD || "Palabra123*").trim();
}

function authSecret() {
  return String(
    process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD || "palabra-pura-dev-secret",
  );
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function sign(payloadB64) {
  return b64url(
    crypto.createHmac("sha256", authSecret()).update(payloadB64).digest(),
  );
}

/** Token con id de panel_user y lista de permisos. */
export function issueToken({ id, username, permissions = [] }) {
  const payload = b64url(
    JSON.stringify({
      id,
      u: username,
      p: permissions,
      exp: Date.now() + TTL_MS,
    }),
  );
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    if (!data?.exp || Date.now() > Number(data.exp)) return null;
    return data;
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  const raw = String(req.headers.cookie || "");
  const parts = raw.split(/;\s*/);
  for (const part of parts) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

export function tokenFromRequest(req) {
  const header = String(req.headers.authorization || "");
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return readCookie(req, COOKIE) || String(req.query?.token || "").trim() || null;
}

export function setAuthCookie(res, token) {
  const secure = process.env.COOKIE_SECURE === "1" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TTL_MS / 1000)}${secure}`,
  );
}

export function clearAuthCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}

function safeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function envFallbackOk(username, password) {
  return safeEqualStr(username, adminUser()) && safeEqualStr(password, adminPassword());
}

async function ensureBootstrapIfEmpty() {
  const ready = await panelTablesReady();
  if (!ready) return { mode: "env" };
  const n = await countPanelUsers();
  if (n > 0) return { mode: "db" };
  try {
    await bootstrapSuperadmin({
      username: adminUser(),
      password: adminPassword(),
      fullName: "Administrador",
    });
  } catch (err) {
    console.warn("[auth] bootstrap superadmin:", err.message);
  }
  return { mode: "db" };
}

async function authenticate(username, password) {
  const u = String(username || "").trim();
  const p = String(password || "");
  if (!u || !p) return null;

  const mode = await ensureBootstrapIfEmpty();

  if (mode.mode === "db") {
    const row = await findUserByLogin(u);
    if (row) {
      if (row.status !== "ACTIVE") {
        const err = new Error("Usuario suspendido o pendiente");
        err.status = 403;
        throw err;
      }
      const ok = await verifyPassword(p, row.password_hash);
      if (!ok) return null;
      await touchLogin(row.id);
      const profile = await getAuthProfile(row.id);
      return {
        id: profile.id,
        username: profile.username,
        fullName: profile.full_name,
        roles: profile.roles,
        permissions: profile.permissions,
      };
    }
    // Tablas listas pero usuario no existe: no caer a env (evita bypass).
    return null;
  }

  // Sin migración RBAC: login legacy por env.
  if (!envFallbackOk(u, p)) return null;
  return {
    id: null,
    username: adminUser(),
    fullName: "Administrador",
    roles: [{ name: "Superadmin", type: "SYSTEM" }],
    permissions: ["*"],
  };
}

/** POST /api/auth/login */
export async function handleLogin(req, res) {
  try {
    const username = String(req.body?.username || req.body?.user || "").trim();
    const password = String(req.body?.password || "");
    const user = await authenticate(username, password);
    if (!user) {
      return res.status(401).json({ ok: false, error: "Usuario o contraseña incorrectos" });
    }
    const token = issueToken({
      id: user.id,
      username: user.username,
      permissions: user.permissions,
    });
    setAuthCookie(res, token);
    res.json({
      ok: true,
      token,
      user: user.username,
      fullName: user.fullName,
      roles: user.roles,
      permissions: user.permissions,
      expiresInMs: TTL_MS,
    });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message || "login failed" });
  }
}

/** POST /api/auth/logout */
export function handleLogout(_req, res) {
  clearAuthCookie(res);
  res.json({ ok: true });
}

/** GET /api/auth/me */
export async function handleMe(req, res) {
  const data = verifyToken(tokenFromRequest(req));
  if (!data) return res.status(401).json({ ok: false, authenticated: false });

  if (data.id) {
    try {
      const profile = await getAuthProfile(data.id);
      if (!profile || profile.status !== "ACTIVE") {
        return res.status(401).json({ ok: false, authenticated: false });
      }
      return res.json({
        ok: true,
        authenticated: true,
        user: profile.username,
        id: profile.id,
        fullName: profile.full_name,
        roles: profile.roles,
        permissions: profile.permissions,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  res.json({
    ok: true,
    authenticated: true,
    user: data.u,
    permissions: data.p || ["*"],
  });
}

function adminFromToken(data) {
  return {
    id: data.id || null,
    username: data.u,
    permissions: Array.isArray(data.p) ? data.p : [],
  };
}

function hasPermission(admin, permission) {
  if (!permission) return true;
  if (!admin) return false;
  const perms = admin.permissions || [];
  if (perms.includes("*")) return true;
  if (perms.includes(permission)) return true;
  // Superadmin implícito si tiene users:write + roles:write (por si el token es viejo)
  return false;
}

/** Middleware: APIs del panel. */
export function requireAuth(req, res, next) {
  const data = verifyToken(tokenFromRequest(req));
  if (!data) {
    return res.status(401).json({ ok: false, error: "No autenticado" });
  }
  req.admin = adminFromToken(data);
  next();
}

/** Middleware: exige un permiso concreto (ej. users:write). */
export function requirePermission(...needed) {
  return (req, res, next) => {
    const data = verifyToken(tokenFromRequest(req));
    if (!data) {
      return res.status(401).json({ ok: false, error: "No autenticado" });
    }
    req.admin = adminFromToken(data);
    const ok = needed.every((p) => hasPermission(req.admin, p));
    if (!ok) {
      return res.status(403).json({
        ok: false,
        error: "Sin permiso",
        required: needed,
      });
    }
    next();
  };
}

/** Middleware: páginas HTML del dashboard. */
export function requireAuthPage(req, res, next) {
  if (/\.(js|css|map|png|jpg|jpeg|svg|ico|webp|woff2?)$/i.test(req.path)) {
    return next();
  }
  const data = verifyToken(tokenFromRequest(req));
  if (data) {
    req.admin = adminFromToken(data);
    return next();
  }
  const accept = String(req.headers.accept || "");
  if (accept.includes("application/json")) {
    return res.status(401).json({ ok: false, error: "No autenticado" });
  }
  const nextUrl = encodeURIComponent(req.originalUrl || "/dashboard/");
  return res.redirect(`/login.html?next=${nextUrl}`);
}
