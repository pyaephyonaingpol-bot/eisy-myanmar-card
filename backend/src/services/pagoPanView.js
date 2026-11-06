'use strict';

/**
 * Pagocards secure PAN iframe (4xx BIN series, effective 2026-11-03).
 * @see https://pagocards.com/documentation
 */

function sanitizeHttpsUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const url = new URL(s);
    if (url.protocol !== 'https:') return null;
    // Preserve signed fragments (#secret=…) required by Pagocards display URLs.
    return url.href;
  } catch {
    return null;
  }
}

function isPago4xxBinProduct(productCode) {
  const code = String(productCode || '').toLowerCase();
  if (!code) return false;
  if (code.includes('404') || code.includes('493')) return true;
  return /(?:^|[_-])4\d{2}(?:[_-]|$)/.test(code);
}

function readCardPanUrlFromSources(card, metadata = {}) {
  const nested = card?.secure_view && typeof card.secure_view === 'object'
    ? card.secure_view
    : null;
  const raw = card?.card_pan_url
    ?? card?.cardPanUrl
    ?? card?.pan_url
    ?? card?.secure_pan_url
    ?? card?.secure_card_url
    ?? card?.card_pan_view_url
    ?? card?.display_url
    ?? card?.pan_view_url
    ?? card?.card_pan_link
    ?? nested?.url
    ?? nested?.card_pan_url
    ?? metadata?.card_pan_url
    ?? metadata?.cardPanUrl
    ?? metadata?.pan_url
    ?? metadata?.display_url
    ?? null;
  return sanitizeHttpsUrl(raw);
}

function needsPagoPanUrlFetch(card) {
  if (readCardPanUrlFromSources(card)) return false;
  const product = card?.product_code || card?.productCode || null;
  return isPago4xxBinProduct(product);
}

function usesPagoPanIframe({ provider, product_code: productCode, productCode: camelProduct, card_pan_url: panUrl, metadata } = {}) {
  const prov = String(provider || metadata?.provider || '').toLowerCase();
  if (prov !== 'pago') return false;
  const product = productCode || camelProduct || metadata?.product_code || null;
  if (readCardPanUrlFromSources({ card_pan_url: panUrl }, metadata)) return true;
  return isPago4xxBinProduct(product);
}

module.exports = {
  sanitizeHttpsUrl,
  isPago4xxBinProduct,
  readCardPanUrlFromSources,
  usesPagoPanIframe,
  needsPagoPanUrlFetch,
};
