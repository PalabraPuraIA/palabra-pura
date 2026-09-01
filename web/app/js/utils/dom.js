/**
 * dom.js — Pequeños ayudantes para trabajar con el DOM.
 */

/** Busca un elemento por selector. */
export const qs = (selector, scope = document) => scope.querySelector(selector);

/** Busca todos los elementos que coinciden. */
export const qsa = (selector, scope = document) => [...scope.querySelectorAll(selector)];

/**
 * Crea un elemento con clase y contenido HTML opcionales.
 * @param {string} tag
 * @param {{ className?: string, html?: string, attrs?: Record<string,string> }} options
 */
export function createEl(tag, { className = "", html = "", attrs = {} } = {}) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (html) el.innerHTML = html;
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

/** Desplaza un contenedor hasta el final. */
export function scrollToBottom(el) {
  el.scrollTop = el.scrollHeight;
}
