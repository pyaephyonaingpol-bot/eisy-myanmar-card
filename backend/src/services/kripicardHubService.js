/**
 * Kripicard Hub catalog + purchase (flat $1 processing fee on every buy).
 *
 * Catalog prefers Kripicard's single main /api/external/services endpoint, then
 * maps the payload into Hub categories (platforms → subcategories → services).
 * Falls back to the local starter catalog when the API key is missing or the
 * provider is unreachable so the Hub remains usable offline/dev.
 */
'use strict';

const crypto = require('crypto');
const { getDb } = require('../db');
const {
  KRIPICARD_HUB_CATEGORIES,
  KRIPICARD_HUB_PROCESSING_FEE_USD,
  getCategory,
  calculateHubPurchaseTotals,
  roundUsd,
} = require('../constants/kripicardServiceCategories');
const { KRIPICARD_HUB_CATALOG } = require('../constants/kripicardHubCatalog');
const { debitUsdt, formatUsdt } = require('./walletService');
const { creditPlatformUsdtRevenue } = require('./platformRevenueService');
const { PLATFORM_FEE_TYPES } = require('../constants/platformFeeTypes');
const {
  ALL_KEY,
  isApiConfigured,
  fetchLiveHubCatalog,
  buildFilterMeta,
  normalizeServiceProduct,
  slugKey,
} = require('../../../lib/kripicardHubApi');

/** Short-lived product cache so purchase can resolve live product_ids. */
const PRODUCT_CACHE_TTL_MS = Number(process.env.KRIPICARD_HUB_PRODUCT_CACHE_MS) || 15 * 60 * 1000;
const productCache = new Map(); // product_id -> { product, categoryId, expires }

function listCategories() {
  return KRIPICARD_HUB_CATEGORIES.map((c) => ({
    id: c.id,
    slug: c.slug,
    title: c.title,
    description: c.description,
    i18n_title: c.i18n_title,
    i18n_desc: c.i18n_desc,
    processing_fee_usd: KRIPICARD_HUB_PROCESSING_FEE_USD,
  }));
}

function rememberProducts(categoryId, products) {
  const expires = Date.now() + PRODUCT_CACHE_TTL_MS;
  for (const product of products || []) {
    if (!product?.product_id) continue;
    productCache.set(String(product.product_id), {
      categoryId,
      product,
      expires,
    });
  }
}

function getCachedProduct(categoryId, productId) {
  const hit = productCache.get(String(productId));
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    productCache.delete(String(productId));
    return null;
  }
  if (categoryId && hit.categoryId !== categoryId) return null;
  return hit;
}

function decorateProduct(product, category) {
  const totals = calculateHubPurchaseTotals(product.price_usd);
  return {
    ...product,
    category_id: category.id,
    category_title: category.title,
    processing_fee_usd: totals.processing_fee_usd,
    total_charge_usd: totals.total_charge_usd,
    fee_label: totals.fee_label,
    price_label: `$${Number(product.price_usd).toFixed(2)} + $${totals.processing_fee_usd.toFixed(2)} fee`,
  };
}

function fallbackCatalog(category, filters = {}) {
  const rawProducts = (KRIPICARD_HUB_CATALOG[category.id] || []).map((p) => (
    normalizeServiceProduct({
      ...p,
      group: p.subcategory,
    }, {
      categoryId: category.id,
      platform: p.platform,
      subcategory: p.subcategory,
    }) || {
      product_id: p.product_id,
      name: p.name,
      description: p.description || '',
      price_usd: p.price_usd,
      platform: p.platform || 'general',
      platform_key: slugKey(p.platform || 'general'),
      subcategory: p.subcategory || null,
      subcategory_key: p.subcategory ? slugKey(p.subcategory) : ALL_KEY,
      pricing_model: p.pricing_model || 'package',
      min_quantity: 1,
      max_quantity: null,
      features: [],
    }
  )).filter(Boolean);

  const meta = buildFilterMeta(rawProducts, {
    platform: filters.platform,
    subcategory: filters.subcategory,
  });

  if (filters.search) {
    const q = String(filters.search).trim().toLowerCase();
    meta.products = meta.products.filter((p) => (
      p.name.toLowerCase().includes(q)
      || (p.description || '').toLowerCase().includes(q)
      || (p.platform || '').toLowerCase().includes(q)
      || (p.subcategory || '').toLowerCase().includes(q)
    ));
  }

  return {
    source: 'fallback',
    enabled: true,
    count: rawProducts.length,
    requires_input: null,
    message: null,
    ...meta,
  };
}

async function loadCatalog(categoryId, filters = {}) {
  const category = getCategory(categoryId);
  if (!category) {
    const err = new Error('Unknown Kripicard Hub category');
    err.code = 'UNKNOWN_HUB_CATEGORY';
    throw err;
  }

  let catalog;
  let liveError = null;

  if (isApiConfigured() && process.env.KRIPICARD_HUB_FORCE_FALLBACK !== '1') {
    try {
      catalog = await fetchLiveHubCatalog(category.id, filters);
    } catch (err) {
      liveError = err;
      console.warn(
        '[kripicardHub] live catalog failed, using fallback:',
        category.id,
        err.code || '',
        err.message
      );
      catalog = fallbackCatalog(category, filters);
      catalog.live_error = {
        code: err.code || 'KRIPICARD_HUB_LIVE_FAILED',
        message: err.message,
      };
    }
  } else {
    catalog = fallbackCatalog(category, filters);
  }

  const products = (catalog.products || []).map((p) => decorateProduct(p, category));
  rememberProducts(category.id, products);

  return {
    category,
    processing_fee_usd: KRIPICARD_HUB_PROCESSING_FEE_USD,
    source: catalog.source || 'fallback',
    enabled: catalog.enabled !== false,
    count: catalog.count ?? products.length,
    platforms: catalog.platforms || [],
    subcategories: catalog.subcategories || [],
    filters: {
      platform: catalog.filters?.platform || ALL_KEY,
      subcategory: catalog.filters?.subcategory || ALL_KEY,
      search: filters.search || null,
      country: filters.country || null,
      number: filters.number || null,
    },
    requires_input: catalog.requires_input || null,
    message: catalog.message || null,
    live_error: catalog.live_error || (liveError ? {
      code: liveError.code,
      message: liveError.message,
    } : null),
    products,
  };
}

/** @deprecated sync helper — prefer catalogForCategoryAsync */
function catalogForCategory(categoryId, filters = {}) {
  const category = getCategory(categoryId);
  if (!category) {
    const err = new Error('Unknown Kripicard Hub category');
    err.code = 'UNKNOWN_HUB_CATEGORY';
    throw err;
  }
  const catalog = fallbackCatalog(category, filters);
  const products = catalog.products.map((p) => decorateProduct(p, category));
  rememberProducts(category.id, products);
  return {
    category,
    processing_fee_usd: KRIPICARD_HUB_PROCESSING_FEE_USD,
    source: 'fallback',
    enabled: true,
    count: products.length,
    platforms: catalog.platforms,
    subcategories: catalog.subcategories,
    filters: catalog.filters,
    requires_input: null,
    message: null,
    live_error: null,
    products,
  };
}

async function catalogForCategoryAsync(categoryId, filters = {}) {
  return loadCatalog(categoryId, filters);
}

function findProduct(categoryId, productId) {
  const category = getCategory(categoryId);
  if (!category) return null;

  const cached = getCachedProduct(category.id, productId);
  if (cached) {
    return {
      category,
      product: cached.product,
      totals: calculateHubPurchaseTotals(cached.product.price_usd),
    };
  }

  const list = KRIPICARD_HUB_CATALOG[category.id] || [];
  const product = list.find((p) => String(p.product_id) === String(productId));
  if (!product) return null;
  return { category, product, totals: calculateHubPurchaseTotals(product.price_usd) };
}

function quotePurchase({ categoryId, productId, productPriceUsd = null, quantity = 1 } = {}) {
  const found = findProduct(categoryId, productId);
  if (found) {
    const qty = Math.max(1, Number(quantity) || 1);
    let productPrice = found.totals.product_price_usd;
    if (found.product.pricing_model === 'per_1000') {
      productPrice = roundUsd((found.product.price_usd * qty) / 1000);
    } else if (qty > 1 && found.product.pricing_model === 'package') {
      productPrice = roundUsd(found.product.price_usd * qty);
    }
    const totals = calculateHubPurchaseTotals(productPrice);
    return {
      category: found.category,
      product: found.product,
      quantity: qty,
      ...totals,
    };
  }
  // Allow quote by explicit price when product came from a prior live fetch
  // that expired, or a custom admin/future path.
  if (productPriceUsd != null) {
    const category = getCategory(categoryId);
    if (!category) {
      const err = new Error('Unknown Kripicard Hub category');
      err.code = 'UNKNOWN_HUB_CATEGORY';
      throw err;
    }
    const totals = calculateHubPurchaseTotals(productPriceUsd);
    return {
      category,
      product: {
        product_id: productId || 'custom',
        name: 'Custom product',
        price_usd: totals.product_price_usd,
      },
      quantity: Math.max(1, Number(quantity) || 1),
      ...totals,
    };
  }
  const err = new Error('Product not found in this category');
  err.code = 'HUB_PRODUCT_NOT_FOUND';
  throw err;
}

async function uniqueRefCode() {
  const db = getDb();
  for (let i = 0; i < 8; i += 1) {
    const ref = `KH-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const existing = await db.get(
      'SELECT id FROM kripicard_hub_purchases WHERE ref_code = ? LIMIT 1',
      ref
    );
    if (!existing) return ref;
  }
  return `KH-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}

async function purchaseHubProduct(userId, {
  categoryId,
  productId,
  recipientEmail = null,
  note = null,
  productPriceUsd = null,
  quantity = 1,
  link = null,
} = {}) {
  const quote = quotePurchase({
    categoryId,
    productId,
    productPriceUsd,
    quantity,
  });
  const email = String(recipientEmail || '').trim() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const err = new Error('Enter a valid recipient email');
    err.code = 'INVALID_RECIPIENT_EMAIL';
    throw err;
  }

  const refCode = await uniqueRefCode();
  const db = getDb();
  const insert = await db.run(
    `INSERT INTO kripicard_hub_purchases (
      user_id, ref_code, category_id, product_id, product_name,
      product_price_usd, processing_fee_usd, total_charge_usd,
      status, recipient_email, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    userId,
    refCode,
    quote.category.id,
    quote.product.product_id,
    quote.product.name,
    quote.product_price_usd,
    quote.processing_fee_usd,
    quote.total_charge_usd,
    email,
    JSON.stringify({
      note: note ? String(note).slice(0, 200) : null,
      fee_policy: 'flat_1_usd_processing',
      quantity: quote.quantity || 1,
      link: link ? String(link).slice(0, 500) : null,
      platform: quote.product.platform || null,
      subcategory: quote.product.subcategory || null,
      catalog_source: getCachedProduct(quote.category.id, quote.product.product_id) ? 'cache' : 'fallback',
    })
  );
  const purchaseId = insert.lastID;

  const debitDescription = `Kripicard Hub ${quote.category.title} — ${quote.product.name} `
    + `(${formatUsdt(quote.total_charge_usdt)}; product $${quote.product_price_usd.toFixed(2)} `
    + `+ $${quote.processing_fee_usd.toFixed(2)} processing)`;

  try {
    await debitUsdt(userId, quote.total_charge_usdt, {
      description: debitDescription,
      referenceType: 'kripicard_hub_purchase',
      referenceId: purchaseId,
      createdBy: 'user',
      metadata: {
        purpose: 'kripicard_hub_purchase',
        category_id: quote.category.id,
        product_id: quote.product.product_id,
        product_price_usd: quote.product_price_usd,
        processing_fee_usd: quote.processing_fee_usd,
        total_charge_usd: quote.total_charge_usd,
        ref_code: refCode,
      },
    });
  } catch (err) {
    await db.run(
      `UPDATE kripicard_hub_purchases
       SET status = 'failed', updated_at = datetime('now'),
           metadata = json_set(COALESCE(metadata, '{}'), '$.error', ?)
       WHERE id = ?`,
      err.message || 'debit_failed',
      purchaseId
    ).catch(() => {});
    throw err;
  }

  try {
    await creditPlatformUsdtRevenue(quote.processing_fee_usd, {
      feeType: PLATFORM_FEE_TYPES.HUB_SERVICE,
      description: `Kripicard Hub processing fee — ${refCode} (${quote.category.title})`,
      referenceType: 'kripicard_hub_purchases',
      referenceId: purchaseId,
      relatedUserId: userId,
      metadata: {
        category_id: quote.category.id,
        product_id: quote.product.product_id,
        product_price_usd: quote.product_price_usd,
        processing_fee_usd: quote.processing_fee_usd,
        ref_code: refCode,
      },
    });
  } catch (feeErr) {
    console.warn('[kripicardHub] platform fee credit skipped:', feeErr.message);
  }

  await db.run(
    `UPDATE kripicard_hub_purchases
     SET status = 'completed', updated_at = datetime('now')
     WHERE id = ?`,
    purchaseId
  );

  const row = await db.get('SELECT * FROM kripicard_hub_purchases WHERE id = ?', purchaseId);
  return {
    purchase: mapPurchase(row),
    quote,
    message: `Purchased ${quote.product.name}. Charged ${formatUsdt(quote.total_charge_usdt)} `
      + `(includes flat $${KRIPICARD_HUB_PROCESSING_FEE_USD.toFixed(2)} processing fee).`,
  };
}

function mapPurchase(row) {
  if (!row) return null;
  let metadata = {};
  try {
    metadata = row.metadata ? JSON.parse(row.metadata) : {};
  } catch {
    metadata = {};
  }
  return {
    id: row.id,
    ref_code: row.ref_code,
    category_id: row.category_id,
    product_id: row.product_id,
    product_name: row.product_name,
    product_price_usd: roundUsd(row.product_price_usd),
    processing_fee_usd: roundUsd(row.processing_fee_usd),
    total_charge_usd: roundUsd(row.total_charge_usd),
    status: row.status,
    recipient_email: row.recipient_email || null,
    metadata,
    created_at: row.created_at,
  };
}

async function listPurchasesForUser(userId, { limit = 50 } = {}) {
  const db = getDb();
  const rows = await db.all(
    `SELECT * FROM kripicard_hub_purchases
     WHERE user_id = ?
     ORDER BY datetime(created_at) DESC, id DESC
     LIMIT ?`,
    userId,
    Math.min(Math.max(Number(limit) || 50, 1), 100)
  );
  return rows.map(mapPurchase);
}

module.exports = {
  listCategories,
  catalogForCategory,
  catalogForCategoryAsync,
  quotePurchase,
  purchaseHubProduct,
  listPurchasesForUser,
  KRIPICARD_HUB_PROCESSING_FEE_USD,
  ALL_KEY,
};
