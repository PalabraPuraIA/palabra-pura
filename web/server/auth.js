/**
 * auth.js — Login simple para el panel admin (dashboard).
 * El chat público no pasa por aquí.
 */

import crypto from "node:crypto";

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

export function issueToken(username = adminUser()) {
  const payload = b64url(
    JSON.stringify({
      u: username,
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

export function checkCredentials(username, password) {
  const u = String(username || "").trim();
  const p = String(password || "");
  return safeEqualStr(u, adminUser()) && safeEqualStr(p, adminPassword());
}

/** POST /api/auth/login */
export function handleLogin(req, res) {
  const username = String(req.body?.username || req.body?.user || "").trim();
  const password = String(req.body?.password || "");
  if (!checkCredentials(username, password)) {
    return res.status(401).json({ ok: false, error: "Usuario o contraseña incorrectos" });
  }
  const token = issueToken(username);
  setAuthCookie(res, token);
  res.json({ ok: true, token, user: username, expiresInMs: TTL_MS });
}

/** POST /api/auth/logout */
export function handleLogout(_req, res) {
  clearAuthCookie(res);
  res.json({ ok: true });
}

/** GET /api/auth/me */
export function handleMe(req, res) {
  const data = verifyToken(tokenFromRequest(req));
  if (!data) return res.status(401).json({ ok: false, authenticated: false });
  res.json({ ok: true, authenticated: true, user: data.u });
}

/** Middleware: APIs del panel. */
export function requireAuth(req, res, next) {
  const data = verifyToken(tokenFromRequest(req));
  if (!data) {
    return res.status(401).json({ ok: false, error: "No autenticado" });
  }
  req.admin = data;
  next();
}

/** Middleware: páginas HTML del dashboard. */
export function requireAuthPage(req, res, next) {
  // Assets del panel no son secretos; la protección real está en las APIs.
  if (/\.(js|css|map|png|jpg|jpeg|svg|ico|webp|woff2?)$/i.test(req.path)) {
    return next();
  }
  const data = verifyToken(tokenFromRequest(req));
  if (data) {
    req.admin = data;
    return next();
  }
  const accept = String(req.headers.accept || "");
  if (accept.includes("application/json")) {
    return res.status(401).json({ ok: false, error: "No autenticado" });
  }
  const nextUrl = encodeURIComponent(req.originalUrl || "/dashboard/");
  return res.redirect(`/login.html?next=${nextUrl}`);
}
