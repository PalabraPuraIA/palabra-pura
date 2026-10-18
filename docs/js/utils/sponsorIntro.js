/**
 * Bumper de apertura que se repite en varios audios:
 * "Este programa llega a ti gracias al apoyo financiero..."
 * Solo se omite si el recorte está al inicio de la enseñanza.
 */

const SPONSOR_NEAR_SECONDS = 90;

const SPONSOR_MARK =
  /este programa (te )?llega|apoyo financiero de los miembros/i;

export function excerptIsNearSponsorIntro(fragment, text) {
  const blob = String(text || fragment?.content || "");
  if (!SPONSOR_MARK.test(blob)) return false;
  if (!fragment) return true;
  const start = Number(fragment.start_second);
  const pos = Number(fragment.position);
  if (Number.isFinite(start) && start <= SPONSOR_NEAR_SECONDS) return true;
  if (Number.isFinite(pos) && pos <= 1) return true;
  return false;
}

export function stripSponsorIntro(text) {
  const raw = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!raw || !SPONSOR_MARK.test(raw)) return raw;

  const startMatch = raw.match(/este programa (te )?llega a ti/i);
  if (!startMatch) {
    return raw
      .replace(/gracias al apoyo financiero de los miembros[^.]{0,280}\.?/i, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const from = startMatch.index ?? 0;
  const after = raw.slice(from);
  const endMatch = after.match(/c[oó]digo qr(?:[\s\S]{0,480}?\bbendiciones\b)?|\bbendiciones\b/i);
  const end = endMatch
    ? from + endMatch.index + endMatch[0].length
    : from + Math.min(after.length, 480);
  return `${raw.slice(0, from)} ${raw.slice(end)}`.replace(/\s+/g, " ").trim();
}
