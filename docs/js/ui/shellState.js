/**
 * shellState.js — Abre/cierra el historial y el cajón de enseñanza.
 * En celular solo uno puede estar abierto; el chat se desplaza.
 */

export const NAV_DRAWER = "(max-width: 1100px)";
export const PHONE = "(max-width: 900px)";

export function isNavDrawer() {
  return window.matchMedia(NAV_DRAWER).matches;
}

export function isPhone() {
  return window.matchMedia(PHONE).matches;
}

export function syncShell() {
  const navOpen = document.body.classList.contains("nav-open");
  const navCollapsed = document.body.classList.contains("nav-collapsed");
  const mediaOpen = document.body.classList.contains("media-open");
  const drawer = isNavDrawer();

  const navBackdrop = document.querySelector("[data-nav-backdrop]");
  if (navBackdrop) navBackdrop.hidden = !navOpen;

  const mediaBackdrop = document.querySelector("[data-media-backdrop]");
  if (mediaBackdrop) mediaBackdrop.hidden = !mediaOpen;

  document.querySelectorAll("[data-nav-toggle]").forEach((btn) => {
    const expanded = drawer ? navOpen : !navCollapsed;
    btn.setAttribute("aria-expanded", expanded ? "true" : "false");
    btn.setAttribute("aria-label", expanded ? "Cerrar historial" : "Abrir historial");
  });

  document.querySelectorAll("[data-media-toggle]").forEach((btn) => {
    btn.setAttribute("aria-expanded", mediaOpen ? "true" : "false");
  });
}

export function setNavOpen(open) {
  if (open) document.body.classList.remove("media-open");
  document.body.classList.toggle("nav-open", Boolean(open));
  syncShell();
}

export function setMediaOpen(open) {
  if (open) document.body.classList.remove("nav-open");
  document.body.classList.toggle("media-open", Boolean(open));
  syncShell();
}

export function toggleNav() {
  if (isNavDrawer()) {
    setNavOpen(!document.body.classList.contains("nav-open"));
    return;
  }
  document.body.classList.toggle("nav-collapsed");
  syncShell();
}

export function toggleMedia() {
  if (!isPhone()) return;
  setMediaOpen(!document.body.classList.contains("media-open"));
}

export function initShell() {
  syncShell();
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (document.body.classList.contains("media-open")) {
      setMediaOpen(false);
      return;
    }
    setNavOpen(false);
  });
  window.matchMedia(PHONE).addEventListener("change", (event) => {
    if (!event.matches) setMediaOpen(false);
  });
  window.matchMedia(NAV_DRAWER).addEventListener("change", (event) => {
    if (!event.matches) setNavOpen(false);
  });
}
