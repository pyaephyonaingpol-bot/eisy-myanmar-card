/**
 * Kripicard Hub service categories shown on the portal switch,
 * plus the flat $1 USD processing fee applied to every purchase.
 */
'use strict';

const KRIPICARD_HUB_PROCESSING_FEE_USD = 1;

const KRIPICARD_HUB_CATEGORIES = [
  {
    id: 'sms',
    slug: 'sms',
    title: 'SMS',
    description: 'Temporary numbers for SMS verification',
    i18n_title: 'hub_cat_sms_title',
    i18n_desc: 'hub_cat_sms_desc',
  },
  {
    id: 'sim_topup',
    slug: 'sim-top-up',
    title: 'SIM Top-Up',
    description: 'Mobile airtime top-ups worldwide',
    i18n_title: 'hub_cat_sim_topup_title',
    i18n_desc: 'hub_cat_sim_topup_desc',
  },
  {
    id: 'esim',
    slug: 'esim',
    title: 'eSIM',
    description: 'Global data eSIM packages',
    i18n_title: 'hub_cat_esim_title',
    i18n_desc: 'hub_cat_esim_desc',
  },
  {
    id: 'gift_cards',
    slug: 'gift-cards',
    title: 'Gift Cards',
    description: 'Digital gift cards from top brands',
    i18n_title: 'hub_cat_gift_cards_title',
    i18n_desc: 'hub_cat_gift_cards_desc',
  },
  {
    id: 'social_media',
    slug: 'social-media',
    title: 'Social Media',
    description: 'Social account tools and boosts',
    i18n_title: 'hub_cat_social_media_title',
    i18n_desc: 'hub_cat_social_media_desc',
  },
  {
    id: 'proxies',
    slug: 'proxies',
    title: 'Proxies',
    description: 'Residential and datacenter proxies',
    i18n_title: 'hub_cat_proxies_title',
    i18n_desc: 'hub_cat_proxies_desc',
  },
  {
    id: 'webhooks',
    slug: 'webhooks',
    title: 'Webhooks',
    description: 'Webhook delivery and event tooling',
    i18n_title: 'hub_cat_webhooks_title',
    i18n_desc: 'hub_cat_webhooks_desc',
  },
];

const CATEGORY_BY_ID = Object.fromEntries(
  KRIPICARD_HUB_CATEGORIES.map((c) => [c.id, c])
);
const CATEGORY_BY_SLUG = Object.fromEntries(
  KRIPICARD_HUB_CATEGORIES.map((c) => [c.slug, c])
);

function roundUsd(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeCategoryId(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return null;
  if (CATEGORY_BY_ID[value]) return value;
  const bySlug = CATEGORY_BY_SLUG[value];
  if (bySlug) return bySlug.id;
  const underscored = value.replace(/-/g, '_');
  if (CATEGORY_BY_ID[underscored]) return underscored;
  return null;
}

function getCategory(raw) {
  const id = normalizeCategoryId(raw);
  return id ? CATEGORY_BY_ID[id] : null;
}

/**
 * Flat $1 processing fee is always added on top of the product price.
 * total = product_price_usd + 1.00
 */
function calculateHubPurchaseTotals(productPriceUsd) {
  const product = roundUsd(productPriceUsd);
  if (!Number.isFinite(product) || product <= 0) {
    const err = new Error('Enter a valid product price');
    err.code = 'INVALID_PRODUCT_PRICE';
    throw err;
  }
  const processingFee = roundUsd(KRIPICARD_HUB_PROCESSING_FEE_USD);
  const total = roundUsd(product + processingFee);
  return {
    product_price_usd: product,
    processing_fee_usd: processingFee,
    total_charge_usd: total,
    total_charge_usdt: total,
    fee_label: `+$${processingFee.toFixed(2)} processing`,
    summary: `$${product.toFixed(2)} + $${processingFee.toFixed(2)} processing = $${total.toFixed(2)}`,
  };
}

module.exports = {
  KRIPICARD_HUB_PROCESSING_FEE_USD,
  KRIPICARD_HUB_CATEGORIES,
  CATEGORY_BY_ID,
  CATEGORY_BY_SLUG,
  roundUsd,
  normalizeCategoryId,
  getCategory,
  calculateHubPurchaseTotals,
};
