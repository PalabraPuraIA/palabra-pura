/**
 * backend.js — Elige el backend activo.
 *
 * - En GitHub Pages: Supabase nube primero; server/túnel de reserva.
 * - En el contenedor Fintek (same-origin): server local primero; nube de reserva.
 */

import { config } from "../config.js";

const HEALTH_TIMEOUT_MS = 3500;
let cached = { at: 0, serverBase: null, mode: "supabase", chatEndpoint: "" };
const CACHE_MS = 20_000;

function normalizeBase(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function isGitHubPages() {
  return (
    typeof window !== "undefined" &&
    /github\.io$/i.test(window.location?.hostname || "")
  );
}

function cloudChatEndpoint() {
  const raw =
    config.fallbackEndpoint ||
    config.endpoint ||
    `${normalizeBase(config.supabaseUrl)}/functions/v1/chatbot-iglesia-palabra-pura`;
  // En el contenedor, config.endpoint puede ser "/api/chat" (local).
  if (!raw || !/^https?:\/\//i.test(raw) || !/supabase\.co/.test(raw)) {
    return (
      config.fallbackEndpoint && /supabase\.co/.test(config.fallbackEndpoint)
        ? config.fallbackEndpoint
        : `${normalizeBase(config.supabaseUrl)}/functions/v1/chatbot-iglesia-palabra-pura`
    );
  }
  return raw;
}

async function probeHealth(base) {
  if (!base) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/api/health`, {
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    return Boolean(data?.ok);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function probeCloud() {
  const endpoint = cloudChatEndpoint();
  if (!endpoint || !/^https?:\/\//i.test(endpoint)) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "GET",
      cache: "no-store",
      signal: ctrl.signal,
      headers: config.publishableKey
        ? {
            apikey: config.publishableKey,
            Authorization: `Bearer ${config.publishableKey}`,
          }
        : {},
    });
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function readPublishedUrl() {
  try {
    const res = await fetch(`./public-url.json?_=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return normalizeBase(data.serverBaseUrl || data.baseUrl || data.chatUrl);
  } catch {
    return null;
  }
}

async function findLocalServer() {
  const candidates = [];
  if (
    typeof window !== "undefined" &&
    window.location?.origin &&
    !isGitHubPages()
  ) {
    candidates.push(normalizeBase(window.location.origin));
  }
  const published = await readPublishedUrl();
  const configured = normalizeBase(config.serverBaseUrl);
  for (const base of [published, configured]) {
    if (base && !candidates.includes(base) && !/supabase\.co/.test(base)) {
      candidates.push(base);
    }
  }
  for (const base of candidates) {
    if (await probeHealth(base)) return base;
  }
  return null;
}

/**
 * @returns {Promise<{
 *   mode: "supabase"|"server",
 *   serverBase: string|null,
 *   chatEndpoint: string,
 *   reserveChatEndpoint: string|null
 * }>}
 */
export async function resolveBackend({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - cached.at < CACHE_MS && cached.chatEndpoint) {
    return cached;
  }

  const cloud = cloudChatEndpoint();
  const localBase = await findLocalServer();
  const localChat = localBase
    ? `${localBase}/api/chat`
    : !isGitHubPages() && config.endpoint === "/api/chat"
      ? "/api/chat"
      : null;

  // Contenedor / LAN: local primero.
  if (!isGitHubPages() && localChat && (localBase ? true : await probeHealth(""))) {
    // If localBase null but endpoint is /api/chat, probe same-origin
    if (!localBase) {
      const origin =
        typeof window !== "undefined" ? normalizeBase(window.location.origin) : "";
      if (origin && (await probeHealth(origin))) {
        cached = {
          at: now,
          mode: "server",
          serverBase: origin,
          chatEndpoint: `${origin}/api/chat`,
          reserveChatEndpoint: cloud,
        };
        return cached;
      }
    } else {
      cached = {
        at: now,
        mode: "server",
        serverBase: localBase,
        chatEndpoint: localChat,
        reserveChatEndpoint: cloud,
      };
      return cached;
    }
  }

  if (!isGitHubPages() && localBase) {
    cached = {
      at: now,
      mode: "server",
      serverBase: localBase,
      chatEndpoint: localChat,
      reserveChatEndpoint: cloud,
    };
    return cached;
  }

  // Pages (o local caído): nube primero.
  const cloudOk = await probeCloud();
  if (cloudOk || !localChat) {
    cached = {
      at: now,
      mode: "supabase",
      serverBase: localBase,
      chatEndpoint: cloud,
      reserveChatEndpoint: localChat,
    };
    return cached;
  }

  cached = {
    at: now,
    mode: "server",
    serverBase: localBase,
    chatEndpoint: localChat,
    reserveChatEndpoint: cloud,
  };
  return cached;
}

export function currentBackend() {
  return cached;
}
