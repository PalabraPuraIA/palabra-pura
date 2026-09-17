/**
 * backend.js — Elige el backend activo.
 *
 * Orden:
 *  1. Supabase nube (principal, permanente en GitHub Pages)
 *  2. Server Fintek / túnel (reserva si la nube falla o no responde)
 */

import { config } from "../config.js";

const HEALTH_TIMEOUT_MS = 3500;
let cached = { at: 0, serverBase: null, mode: "supabase", chatEndpoint: "" };
const CACHE_MS = 20_000;

function normalizeBase(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function cloudChatEndpoint() {
  return (
    config.endpoint ||
    config.fallbackEndpoint ||
    `${normalizeBase(config.supabaseUrl)}/functions/v1/chatbot-iglesia-palabra-pura`
  );
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
  if (!endpoint) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
  try {
    // OPTIONS/HEAD no siempre están en Edge Functions; un GET corto basta
    // para saber si el host responde (404/405 = vivo, network error = caído).
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

async function findReserveServer() {
  const candidates = [];
  if (
    typeof window !== "undefined" &&
    window.location?.origin &&
    !/github\.io$/i.test(window.location.hostname)
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
  const reserveBase = await findReserveServer();
  const reserveChat = reserveBase ? `${reserveBase}/api/chat` : null;
  const cloudOk = await probeCloud();

  if (cloudOk || !reserveChat) {
    cached = {
      at: now,
      mode: "supabase",
      serverBase: reserveBase,
      chatEndpoint: cloud,
      reserveChatEndpoint: reserveChat,
    };
    return cached;
  }

  // Nube caída → reserva (server viejo / túnel)
  cached = {
    at: now,
    mode: "server",
    serverBase: reserveBase,
    chatEndpoint: reserveChat,
    reserveChatEndpoint: cloud,
  };
  return cached;
}

export function currentBackend() {
  return cached;
}
