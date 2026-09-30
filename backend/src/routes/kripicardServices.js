/**
 * Kripicard Hub services — live catalog (platforms / subcategories / products)
 * with flat $1 processing fee on every purchase.
 * Mounted at /api/kripicard/services
 */
'use strict';

const express = require('express');
const { requireAuth, requireSensitive } = require('../middleware/auth');
const {
  listCategories,
  catalogForCategoryAsync,
  preloadAllCategoryCatalogs,
  quotePurchase,
  purchaseHubProduct,
  listPurchasesForUser,
  KRIPICARD_HUB_PROCESSING_FEE_USD,
} = require('../services/kripicardHubService');

const router = express.Router();
let hubWarmStarted = false;

function catalogFiltersFromQuery(query = {}) {
  return {
    platform: query.platform || query.platform_key || null,
    subcategory: query.subcategory || query.group || query.category || null,
    search: query.search || query.q || null,
    country: query.country || query.countryIso || null,
    number: query.number || query.phone || null,
    page: query.page || null,
    per_page: query.per_page || query.perPage || null,
  };
}

function serializeCatalog(catalog) {
  return {
    success: true,
    processing_fee_usd: catalog.processing_fee_usd,
    source: catalog.source,
    enabled: catalog.enabled,
    count: catalog.count,
    category: {
      id: catalog.category.id,
      slug: catalog.category.slug,
      title: catalog.category.title,
      description: catalog.category.description,
    },
    platforms: catalog.platforms,
    subcategories: catalog.subcategories,
    filters: catalog.filters,
    requires_input: catalog.requires_input,
    message: catalog.message,
    live_error: catalog.live_error,
    products: catalog.products,
  };
}

/** GET /api/kripicard/services/categories — public catalog metadata */
router.get('/categories', (_req, res) => {
  // Fire-and-forget eager warm of all Hub categories (batch/concurrency inside).
  if (!hubWarmStarted && process.env.KRIPICARD_HUB_FORCE_FALLBACK !== '1') {
    hubWarmStarted = true;
    preloadAllCategoryCatalogs({ concurrency: 3 }).catch((err) => {
      console.warn('[kripicard/services] eager catalog warm failed:', err.message);
      hubWarmStarted = false;
    });
  }
  res.json({
    success: true,
    processing_fee_usd: KRIPICARD_HUB_PROCESSING_FEE_USD,
    categories: listCategories(),
  });
});

/** POST /api/kripicard/services/preload — batch eager-load all category catalogs */
router.post('/preload', async (_req, res) => {
  try {
    const results = await preloadAllCategoryCatalogs({ concurrency: 3 });
    res.json({
      success: true,
      warmed: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      categories: results.map((r) => ({
        category_id: r.categoryId,
        ok: r.ok,
        source: r.catalog?.source || null,
        count: r.catalog?.count ?? null,
        platforms: r.catalog?.platforms?.length ?? null,
        error: r.error || null,
      })),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to preload Hub catalogs',
      code: 'HUB_PRELOAD_FAILED',
    });
  }
});

/** GET /api/kripicard/services/purchases/mine */
router.get('/purchases/mine', requireAuth, requireSensitive, async (req, res) => {
  try {
    const purchases = await listPurchasesForUser(req.user.id, {
      limit: parseInt(req.query.limit, 10) || 50,
    });
    res.json({ success: true, purchases });
  } catch (err) {
    console.error('[kripicard/services/purchases]', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to load purchases',
      code: 'HUB_PURCHASES_LIST_FAILED',
    });
  }
});

/**
 * GET /api/kripicard/services/:categoryId/platforms
 * Returns platform chips + subcategory chips for the selected platform.
 */
router.get('/:categoryId/platforms', async (req, res) => {
  try {
    const catalog = await catalogForCategoryAsync(
      req.params.categoryId,
      catalogFiltersFromQuery(req.query)
    );
    res.json({
      success: true,
      processing_fee_usd: catalog.processing_fee_usd,
      source: catalog.source,
      category: {
        id: catalog.category.id,
        slug: catalog.category.slug,
        title: catalog.category.title,
      },
      platforms: catalog.platforms,
      subcategories: catalog.subcategories,
      filters: catalog.filters,
      requires_input: catalog.requires_input,
      message: catalog.message,
    });
  } catch (err) {
    const status = err.code === 'UNKNOWN_HUB_CATEGORY' ? 404 : 400;
    res.status(status).json({
      success: false,
      error: err.message || 'Failed to load platforms',
      code: err.code || 'HUB_PLATFORMS_ERROR',
    });
  }
});

/** GET /api/kripicard/services/:categoryId/products */
router.get('/:categoryId/products', async (req, res) => {
  try {
    const catalog = await catalogForCategoryAsync(
      req.params.categoryId,
      catalogFiltersFromQuery(req.query)
    );
    res.json(serializeCatalog(catalog));
  } catch (err) {
    const status = err.code === 'UNKNOWN_HUB_CATEGORY' ? 404 : 400;
    res.status(status).json({
      success: false,
      error: err.message || 'Failed to load products',
      code: err.code || 'HUB_CATALOG_ERROR',
    });
  }
});

/** POST /api/kripicard/services/quote */
router.post('/quote', requireAuth, (req, res) => {
  try {
    const body = req.body || {};
    const quote = quotePurchase({
      categoryId: body.category_id || body.category,
      productId: body.product_id || body.productId,
      productPriceUsd: body.product_price_usd ?? body.price_usd ?? null,
      quantity: body.quantity ?? 1,
    });
    res.json({
      success: true,
      processing_fee_usd: quote.processing_fee_usd,
      quote: {
        category_id: quote.category.id,
        category_title: quote.category.title,
        product_id: quote.product.product_id,
        product_name: quote.product.name,
        product_price_usd: quote.product_price_usd,
        processing_fee_usd: quote.processing_fee_usd,
        total_charge_usd: quote.total_charge_usd,
        total_charge_usdt: quote.total_charge_usdt,
        quantity: quote.quantity,
        fee_label: quote.fee_label,
        summary: quote.summary,
      },
    });
  } catch (err) {
    const status = ['UNKNOWN_HUB_CATEGORY', 'HUB_PRODUCT_NOT_FOUND', 'INVALID_PRODUCT_PRICE'].includes(err.code)
      ? 400
      : 500;
    res.status(status).json({
      success: false,
      error: err.message || 'Quote failed',
      code: err.code || 'HUB_QUOTE_FAILED',
    });
  }
});

/** POST /api/kripicard/services/purchase */
router.post('/purchase', requireAuth, requireSensitive, async (req, res) => {
  try {
    const body = req.body || {};
    const result = await purchaseHubProduct(req.user.id, {
      categoryId: body.category_id || body.category,
      productId: body.product_id || body.productId,
      recipientEmail: body.recipient_email || body.email || null,
      note: body.note || null,
      productPriceUsd: body.product_price_usd ?? body.price_usd ?? null,
      quantity: body.quantity ?? 1,
      link: body.link || null,
    });
    res.status(201).json({
      success: true,
      message: result.message,
      processing_fee_usd: KRIPICARD_HUB_PROCESSING_FEE_USD,
      purchase: result.purchase,
      quote: {
        product_price_usd: result.quote.product_price_usd,
        processing_fee_usd: result.quote.processing_fee_usd,
        total_charge_usd: result.quote.total_charge_usd,
        summary: result.quote.summary,
      },
    });
  } catch (err) {
    const status = [
      'UNKNOWN_HUB_CATEGORY',
      'HUB_PRODUCT_NOT_FOUND',
      'INVALID_PRODUCT_PRICE',
      'INVALID_RECIPIENT_EMAIL',
      'INSUFFICIENT_USDT',
      'INSUFFICIENT_BALANCE',
      'INSUFFICIENT_FUNDS',
    ].includes(err.code) ? 400
      : err.code === 'SENSITIVE_AUTH_REQUIRED' ? 401
        : 500;
    console.error('[kripicard/services/purchase]', err.message, err.code || '');
    res.status(status).json({
      success: false,
      error: err.message || 'Purchase failed',
      code: err.code || 'HUB_PURCHASE_FAILED',
    });
  }
});

module.exports = router;
