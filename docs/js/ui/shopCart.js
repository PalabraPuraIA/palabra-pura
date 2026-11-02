/**
 * Enlaces a la tienda de la iglesia.
 * "Ver esta" abre la ficha (o un solo add-to-cart).
 * Ya no hay "Ver todas" que llene el carrito con varias de golpe.
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
    .filter((item) => item && (item.url || item.title || item.cartUrl))
    .map((item) => {
      const cartId = cartProductId(item.cartUrl || item.url);
      const rawUrl = String(item.url || "").trim();
      const isAddToCart = /add-to-cart=/i.test(rawUrl);
      // Si hay ficha de producto, úsala para "ver". El add-to-cart queda aparte.
      const viewUrl = !isAddToCart && rawUrl
        ? rawUrl
        : item.product || rawUrl || (cartId ? cartUrlForId(cartId) : "");
      return {
        title: item.title || "Esta enseñanza",
        url: viewUrl,
        cartUrl: item.cartUrl || (cartId ? cartUrlForId(cartId) : ""),
        label: item.label || (isAddToCart && !item.product ? "Agregar al carrito" : "Ver esta"),
        hint: item.hint || "",
        kind: item.kind || "",
        id: cartId,
      };
    });
}

export function isShopRecommendation(offer, offers) {
  const list = normalizeOffers(offer, offers);
  return list.some((item) => item.kind === "tienda") || list.length > 1;
}

/**
 * Panel: una fila por enseñanza. Sin botón de agregar todas.
 * @param {object} [offer]
 * @param {object[]} [offers]
 * @param {{ variant?: "chat" | "player" }} [opts]
 */
export function renderShopOfferPanel(offer, offers, { variant = "chat" } = {}) {
  const list = normalizeOffers(offer, offers);
  if (!list.length) return "";

  const shop = isShopRecommendation(offer, offers);
  const intro = shop
    ? "Elige la que te interese. Solo se agrega al carrito si tú lo decides."
    : "Para más información, abre esta enseñanza en la tienda de la iglesia.";

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

  const cls =
    variant === "player"
      ? "player__shop-panel"
      : "source__panel source__panel--offer";

  return `
    <section class="${cls}" aria-label="Enseñanzas en la tienda">
      <h3 class="source__panel-title">En la tienda</h3>
      <p class="source__shop-intro">${intro}</p>
      <ul class="source__shop-list">${rows}</ul>
    </section>`;
}

/** Agrega un solo producto al carrito de la iglesia (ya no en lote). */
export function openChurchCart(rawIds) {
  const ids = (Array.isArray(rawIds) ? rawIds : String(rawIds || "").split(","))
    .map((id) => String(id).trim())
    .filter((id) => /^\d+$/.test(id));
  if (!ids.length) return false;
  // Solo el primero: evitar llenar el carrito con varias enseñanzas.
  window.open(cartUrlForId(ids[0]), CART_WINDOW);
  return true;
}
