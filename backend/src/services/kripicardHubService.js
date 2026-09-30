/**
 * Kripicard Hub catalog + purchase (flat $1 processing fee on every buy).
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

function catalogForCategory(categoryId) {
  const category = getCategory(categoryId);
  if (!category) {
    const err = new Error('Unknown Kripicard Hub category');
    err.code = 'UNKNOWN_HUB_CATEGORY';
    throw err;
  }
  const products = (KRIPICARD_HUB_CATALOG[category.id] || []).map((p) => {
    const totals = calculateHubPurchaseTotals(p.price_usd);
    return {
      ...p,
      category_id: category.id,
      category_title: category.title,
      processing_fee_usd: totals.processing_fee_usd,
      total_charge_usd: totals.total_charge_usd,
      fee_label: totals.fee_label,
      price_label: `$${Number(p.price_usd).toFixed(2)} + $${totals.processing_fee_usd.toFixed(2)} fee`,
    };
  });
  return {
    category,
    processing_fee_usd: KRIPICARD_HUB_PROCESSING_FEE_USD,
    products,
  };
}

function findProduct(categoryId, productId) {
  const category = getCategory(categoryId);
  if (!category) return null;
  const list = KRIPICARD_HUB_CATALOG[category.id] || [];
  const product = list.find((p) => String(p.product_id) === String(productId));
  if (!product) return null;
  return { category, product, totals: calculateHubPurchaseTotals(product.price_usd) };
}

function quotePurchase({ categoryId, productId, productPriceUsd = null }) {
  const found = findProduct(categoryId, productId);
  if (found) {
    return {
      category: found.category,
      product: found.product,
      ...found.totals,
    };
  }
  // Allow quote by explicit price when product is custom (admin/future live API).
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
} = {}) {
  const quote = quotePurchase({ categoryId, productId });
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
  quotePurchase,
  purchaseHubProduct,
  listPurchasesForUser,
  KRIPICARD_HUB_PROCESSING_FEE_USD,
};
