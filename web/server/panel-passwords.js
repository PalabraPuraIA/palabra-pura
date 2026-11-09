/**
 * Hash de contraseñas del panel (scrypt nativo, sin dependencias).
 * Formato: scrypt$n$r$p$saltB64$hashB64
 */
import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

export async function hashPassword(plain) {
  const password = String(plain || "");
  if (password.length < 6) {
    throw new Error("La contraseña debe tener al menos 6 caracteres");
  }
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${Buffer.from(derived).toString("base64")}`;
}

export async function verifyPassword(plain, stored) {
  const password = String(plain || "");
  const raw = String(stored || "");
  const parts = raw.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (!n || !r || !p || !salt.length || !expected.length) return false;
  const derived = await scrypt(password, salt, expected.length, { N: n, r, p });
  const a = Buffer.from(derived);
  if (a.length !== expected.length) return false;
  return crypto.timingSafeEqual(a, expected);
}
