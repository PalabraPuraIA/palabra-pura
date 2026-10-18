/**
 * Enlaces al carrito de la tienda de la iglesia.
 * WooCommerce solo acepta un add-to-cart por visita, así que
 * "Ver todas" abre una ventana y agrega cada enseñanza en secuencia.
 */

import { escapeHtml } from "../utils/format.js";

export const CHURCH_CART = "https://iglesiapalabrapura.com/site/cart/";
const CART_WINDOW = "pp-iglesia-cart";

export function cartProductId(url) {
  const text = String(url || "").trim();
  const match = text.match(/add-to-cart=(\d+)/i);
  if (match) return match[1];
  return /^\d+$/.test(text) ? text : "";
}

export function cartUrlForId(id) {
  return `${CHURCH_CART}?add-to-cart=${encodeURIComponent(id)}`;
}

export function normalizeOffers(offer, offers) {
  const list = Array.isArray(offers) && offers.length ? offers : offer ? [offer] : [];
  return list
    .filter((item) => item && (item.url || item.title))
    .map((item) => {
      const id = cartProductId(item.url);
      return {
        title: item.title || "Esta enseñanza",
        url: item.url || (id ? cartUrlForId(id) : ""),
        label: item.label || (item.kind === "tienda" ? "Ver esta" : "Ver en el carrito"),
        hint: item.hint || "",
        kind: item.kind || "",
        id,
      };
    });
}

export function isShopRecommendation(offer, offers) {
  const list = normalizeOffers(offer, offers);
  return list.some((item) => item.kind === "tienda") || list.length > 1;
}

/**
 * Panel compacto: una fila por enseñanza + "Ver todas" si hay varias.
 * @param {object} [offer]
 * @param {object[]} [offers]
 * @param {{ variant?: "chat" | "player" }} [opts]
 */
export function renderShopOfferPanel(offer, offers, { variant = "chat" } = {}) {
  const list = normalizeOffers(offer, offers);
  if (!list.length) return "";

  const shop = isShopRecommendation(offer, offers);
  const ids = list.map((item) => item.id).filter(Boolean);
  const intro = shop
    ? "Elige una, o ábrellas todas juntas en el carrito."
    : "Para más información, abre esta enseñanza en el carrito de la iglesia.";

  const rows = list
    .map((item) => {
      const link = item.url
        ? `<a class="source__cta source__cta--link source__cta--tight" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.label || "Ver esta")}</a>`
        : "";
      const hint = item.hint
        ? `<p class="source__shop-hint">${escapeHtml(String(item.hint).slice(0, 140))}</p>`
        : "";
      return `<li class="source__shop-item">
        <div class="source__shop-copy">
          <p class="source__shop-title">${escapeHtml(item.title)}</p>
          ${hint}
        </div>
        ${link}
      </li>`;
    })
    .join("");

  const allBtn =
    ids.length > 1
      ? `<button type="button" class="source__cta source__cta--all" data-cart-all="${escapeHtml(ids.join(","))}">Ver todas</button>`
      : "";

  const cls =
    variant === "player"
      ? "player__shop-panel"
      : "source__panel source__panel--offer";

  return `
    <section class="${cls}" aria-label="Enseñanzas en la tienda">
      <h3 class="source__panel-title">En la tienda</h3>
      <p class="source__shop-intro">${intro}</p>
      <ul class="source__shop-list">${rows}</ul>
      ${allBtn ? `<div class="source__shop-all">${allBtn}</div>` : ""}
    </section>`;
}

/** Agrega uno o varios productos al carrito de la iglesia. */
export function openChurchCart(rawIds) {
  const ids = (Array.isArray(rawIds) ? rawIds : String(rawIds || "").split(","))
    .map((id) => String(id).trim())
    .filter((id) => /^\d+$/.test(id));
  if (!ids.length) return false;

  if (ids.length === 1) {
    window.open(cartUrlForId(ids[0]), "_blank", "noopener");
    return true;
  }

  const named = window.open("about:blank", CART_WINDOW);
  if (!named) {
    window.open(cartUrlForId(ids[0]), "_blank", "noopener");
    return false;
  }
  try {
    named.document.write(
      "<!doctype html><title>Carrito</title><p style='font-family:Poppins,sans-serif;padding:16px'>Agregando las enseñanzas al carrito…</p>",
    );
    named.document.close();
  } catch {
    /* la ventana puede volverse de otro origen después */
  }

  let step = 0;
  const tick = () => {
    if (step > ids.length) return;
    const form = document.createElement("form");
    form.method = "GET";
    form.action = CHURCH_CART;
    form.target = CART_WINDOW;
    form.style.display = "none";
    if (step < ids.length) {
      const input = document.createElement("input");
      input.name = "add-to-cart";
      input.value = ids[step];
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
    form.remove();
    step += 1;
    if (step <= ids.length) window.setTimeout(tick, 1200);
  };
  tick();
  return true;
}
