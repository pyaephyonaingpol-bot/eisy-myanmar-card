/**
 * Kripicard Hub catalog client.
 *
 * Live catalogs are module-first (documented partner routes), then fall back to
 * the aggregate /services payload when a module returns empty:
 *   /sms/services (+ /sms/services/details|/sms/prices)
 *   /smm/services
 *   /esim/packages
 *   /gifts/packages
 *   /sim/packages
 *   /proxies/types|/proxies/packages
 *
 * Hub categories:
 *   sms | sim_topup | esim | gift_cards | social_media | proxies
 *
 * Auth matches Kripicard docs: api_key in JSON body (POST), with GET?api_key
 * fallback. Flat $1 processing fee is applied by kripicardHubService, not here.
 */
'use strict';

const {
  getKripicardConfig,
  kripicardRequest,
} = require('./kripicard');
const KRIPICARD_COUNTRIES = require('./kripicardCountries.json');

const DEFAULT_EXTERNAL_BASE = 'https://appapi.kripicard.com/api/external';
const DEFAULT_SERVICES_PATH = '/services';
const ALL_KEY = '__all__';

function pick(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    return value;
  }
  return null;
}

/** True when a value is only a bare numeric id (e.g. "14", 1004) — not a real label. */
function isNumericId(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  const s = String(value).trim();
  return /^\d+$/.test(s);
}

function looksLikeServicePlaceholder(value) {
  const s = String(value || '').trim();
  return /^service[\s_-]*\d+$/i.test(s) || /^country[\s_-]*\d+$/i.test(s);
}

/** Resolve Kripicard SMS/eSIM country id or ISO code → display name. */
function resolveCountryName(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'object') {
    const nested = pick(raw.name, raw.country_name, raw.countryName, raw.title, raw.isoName, raw.iso);
    if (nested && !isNumericId(nested)) return String(nested);
    const nestedId = pick(raw.id, raw.country_id, raw.countryId);
    if (nestedId != null) return resolveCountryName(nestedId);
    return null;
  }
  const key = String(raw).trim();
  const byId = KRIPICARD_COUNTRIES.by_id?.[key];
  if (byId?.name) return byId.name;
  const byCode = KRIPICARD_COUNTRIES.by_code?.[key]
    || KRIPICARD_COUNTRIES.by_code?.[key.toLowerCase()]
    || KRIPICARD_COUNTRIES.by_code?.[key.toUpperCase()];
  if (byCode?.name) return byCode.name;
  return null;
}

/**
 * Pick the first human-readable label. Skips bare numeric ids unless they
 * resolve through the Kripicard country map.
 */
function pickDisplayName(...values) {
  let numericFallback = null;
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') {
      const nested = pickDisplayName(
        value.name,
        value.title,
        value.label,
        value.brandName,
        value.country_name,
        value.countryName,
        value.isoName
      );
      if (nested) return nested;
      continue;
    }
    const s = String(value).trim();
    if (!s || s === ALL_KEY) continue;
    if (looksLikeServicePlaceholder(s)) continue;
    if (isNumericId(s)) {
      const country = resolveCountryName(s);
      if (country) return country;
      if (!numericFallback) numericFallback = s;
      continue;
    }
    return s;
  }
  return numericFallback ? resolveCountryName(numericFallback) || null : null;
}

/** Hub category id ← Kripicard module / type labels from the main /services payload. */
const KRIPICARD_MODULE_TO_HUB = Object.freeze({
  sms: 'sms',
  smm: 'social_media',
  social: 'social_media',
  social_media: 'social_media',
  'social-media': 'social_media',
  esim: 'esim',
  gift: 'gift_cards',
  gifts: 'gift_cards',
  giftcard: 'gift_cards',
  giftcards: 'gift_cards',
  gift_cards: 'gift_cards',
  'gift-cards': 'gift_cards',
  sim: 'sim_topup',
  topup: 'sim_topup',
  sim_topup: 'sim_topup',
  'sim-top-up': 'sim_topup',
  'sim-topup': 'sim_topup',
  airtime: 'sim_topup',
  proxy: 'proxies',
  proxies: 'proxies',
});

/** Hub category → preferred category filter sent to /services. */
const HUB_TO_KRIPICARD_CATEGORY = Object.freeze({
  sms: 'sms',
  social_media: 'smm',
  esim: 'esim',
  gift_cards: 'gifts',
  sim_topup: 'sim',
  proxies: 'proxies',
});

const MAIN_CATALOG_TTL_MS = Number(process.env.KRIPICARD_HUB_MAIN_CACHE_MS) || 60 * 1000;
let mainCatalogCache = null; // { expires, byCategory, raw }

function getHubApiBase() {
  return String(
    process.env.KRIPICARD_HUB_API_BASE
      || process.env.KRIPICARD_EXTERNAL_API_BASE
      || DEFAULT_EXTERNAL_BASE
  ).trim().replace(/\/$/, '');
}

function getMainServicesPath() {
  const full = String(process.env.KRIPICARD_HUB_SERVICES_URL || '').trim();
  if (full.startsWith('http')) {
    try {
      const u = new URL(full);
      // Prefer path under /api/external/… → relative segment for getHubApiBase().
      const marker = '/api/external';
      const idx = u.pathname.indexOf(marker);
      if (idx >= 0) {
        const rest = u.pathname.slice(idx + marker.length) || DEFAULT_SERVICES_PATH;
        return rest.startsWith('/') ? rest : `/${rest}`;
      }
      return u.pathname || DEFAULT_SERVICES_PATH;
    } catch {
      // fall through
    }
  }
  const path = String(process.env.KRIPICARD_HUB_SERVICES_PATH || DEFAULT_SERVICES_PATH).trim();
  return path.startsWith('/') ? path : `/${path || 'services'}`;
}

function isApiConfigured() {
  const key = String(process.env.KRIPICARD_API_KEY || '').trim();
  return Boolean(key) && !key.includes('...');
}

function unwrapData(raw) {
  if (!raw || typeof raw !== 'object') return {};
  if (raw.data != null && typeof raw.data === 'object') return raw.data;
  return raw;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function slugKey(value, fallback = 'item') {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function money(value, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n * 10000) / 10000;
}

/**
 * POST { api_key, … } to the main external API (Kripicard docs style).
 * Falls back to GET ?api_key=… when POST is rejected as method-not-allowed.
 */
async function hubRequest(path, {
  query = {},
  body = {},
  timeoutMs,
} = {}) {
  const { apiKey, timeoutMs: defaultTimeout } = getKripicardConfig();
  if (!apiKey || apiKey.includes('...')) {
    const err = new Error('KRIPICARD_API_KEY is not configured');
    err.code = 'KRIPICARD_NOT_CONFIGURED';
    throw err;
  }

  const base = getHubApiBase();
  const cleanPath = String(path || '').startsWith('/') ? path : `/${path}`;
  const timeout = timeoutMs || defaultTimeout;
  const payload = { api_key: apiKey, ...(query || {}), ...(body || {}) };

  try {
    return await kripicardRequest(`${base}${cleanPath}`, {
      method: 'POST',
      body: payload,
      timeoutMs: timeout,
    });
  } catch (err) {
    const status = Number(err.status) || 0;
    if (![404, 405].includes(status)) throw err;
    const url = new URL(`${base}${cleanPath}`);
    for (const [k, v] of Object.entries(payload)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
    return kripicardRequest(url.toString(), { method: 'GET', timeoutMs: timeout });
  }
}

function resolveHubCategory(rawCategory) {
  const key = String(rawCategory || '').trim().toLowerCase();
  if (!key) return null;
  if (KRIPICARD_MODULE_TO_HUB[key]) return KRIPICARD_MODULE_TO_HUB[key];
  const underscored = key.replace(/-/g, '_');
  if (KRIPICARD_MODULE_TO_HUB[underscored]) return KRIPICARD_MODULE_TO_HUB[underscored];
  return null;
}

function normalizeServiceProduct(raw, {
  platform = null,
  subcategory = null,
  categoryId = null,
} = {}) {
  if (!raw || typeof raw !== 'object') return null;

  const productId = pick(
    raw.product_id,
    raw.productId,
    raw.packageCode,
    raw.package_code,
    raw.service_id,
    raw.serviceId,
    raw.service,
    raw.id,
    raw.sku
  );
  if (productId == null) return null;

  const hasRateField = pick(
    raw.rate_usd,
    raw.rateUsd,
    raw.rate,
    raw.Rate,
    raw.service_rate,
    raw.serviceRate
  ) != null;

  let pricingModel = String(
    pick(raw.pricing_model, raw.pricingModel, null) || ''
  ).toLowerCase();
  if (!pricingModel) {
    // SMM rate rows are almost always priced per 1000 unless marked as a package.
    const typeHint = String(pick(raw.type, raw.Type, '') || '').toLowerCase();
    if (categoryId === 'social_media' && hasRateField && typeHint !== 'package') {
      pricingModel = 'per_1000';
    } else {
      pricingModel = 'package';
    }
  }

  let priceUsd = money(pick(
    raw.price_usd,
    raw.priceUsd,
    raw.usd_price,
    raw.usdPrice,
    raw.rate_usd,
    raw.rateUsd,
    raw.rate,
    raw.Rate,
    raw.service_rate,
    raw.serviceRate,
    raw.unit_usd,
    raw.unitUsd,
    raw.min_price_usd,
    raw.minPriceUsd,
    raw.charge_usd,
    raw.price,
    raw.cost
  ));

  // Gift cards: USD denominations, sender-USD dens, or explicit USD fields.
  const currency = String(pick(raw.currency, raw.recipient_currency, raw.recipientCurrency, '') || '').toUpperCase();
  const localDens = asArray(
    raw.denominations
      || raw.fixed_denominations
      || raw.fixedDenominations
      || raw.fixedRecipientDenominations
  );
  if ((priceUsd == null || priceUsd <= 0) && localDens.length && currency === 'USD') {
    const local = Number(pick(raw.local_amount, raw.localAmount, localDens[0]));
    if (Number.isFinite(local) && local > 0) priceUsd = money(local);
  }
  if ((priceUsd == null || priceUsd <= 0)) {
    priceUsd = money(pick(
      raw.min_sender_amount,
      raw.minSenderAmount,
      raw.minSenderDenomination,
      raw.sender_min,
      raw.usd_base,
      raw.usdBase
    ));
  }
  if ((priceUsd == null || priceUsd <= 0) && raw.min_amount != null && currency === 'USD') {
    priceUsd = money(raw.min_amount);
  }

  if (priceUsd == null && raw.retailPrice != null) {
    const retail = Number(raw.retailPrice);
    if (Number.isFinite(retail) && retail > 0) {
      priceUsd = retail > 1000 ? money(retail / 10000) : money(retail);
    }
  }

  if (priceUsd == null || priceUsd <= 0) return null;

  const countryName = resolveCountryName(pick(
    raw.country_name,
    raw.countryName,
    raw.country?.name,
    raw.country,
    raw.country_id,
    raw.countryId,
    raw.country_iso,
    raw.countryIso,
    raw.locationCode,
    raw.iso
  ));

  let platformLabel = pickDisplayName(
    platform,
    raw.platform_name,
    raw.platformName,
    raw.platform
  );
  // SMM rows sometimes omit `platform` and only encode it in the service title.
  if (categoryId === 'social_media') {
    platformLabel = platformLabel
      || inferSmmPlatformLabel(
        platform,
        raw.platform,
        raw.platform_name,
        raw.platformName,
        raw.name,
        raw.service_name,
        raw.serviceName,
        raw.category,
        raw.group,
        raw.type
      )
      || pickDisplayName(
        raw.service_name,
        raw.serviceName,
        raw.brand?.brandName,
        raw.brand
      )
      || 'General';
  } else {
    platformLabel = platformLabel
      || pickDisplayName(
        raw.service_name,
        raw.serviceName,
        raw.brand?.brandName,
        raw.brand,
        raw.operator_name,
        raw.operatorName,
        countryName,
        raw.country?.isoName,
        raw.country_iso,
        raw.countryIso,
        raw.type_label,
        raw.typeLabel,
        raw.label,
        raw.type,
        raw.code
      )
      || 'General';
  }

  const subcategoryLabel = pickDisplayName(
    subcategory,
    raw.category_name,
    raw.categoryName,
    raw.group_name,
    raw.groupName,
    raw.category,
    raw.group,
    raw.subcategory,
    raw.data,
    raw.validity != null && !isNumericId(raw.validity) ? `${raw.validity} days` : null,
    raw.family,
    // SMS rows often only carry country_id — surface the country as the type chip.
    countryName && platformLabel !== countryName ? countryName : null
  );

  const composedTitle = platformLabel && subcategoryLabel && slugKey(platformLabel) !== slugKey(subcategoryLabel)
    ? `${platformLabel} · ${subcategoryLabel}`
    : (platformLabel && countryName && slugKey(platformLabel) !== slugKey(countryName)
      ? `${platformLabel} · ${countryName}`
      : null);

  // Prefer a full "Service · Country/Type" title over a bare service_name that
  // duplicates the platform (common for SMS detail rows without a product name).
  const bareServiceName = pickDisplayName(
    raw.name,
    raw.productName,
    raw.product_name,
    raw.title,
    raw.service_name,
    raw.serviceName,
    raw.label,
    raw.packageName
  );
  const name = (
    composedTitle
    && (!bareServiceName
      || slugKey(bareServiceName) === slugKey(platformLabel)
      || isNumericId(bareServiceName)
      || looksLikeServicePlaceholder(bareServiceName))
  )
    ? composedTitle
    : (bareServiceName || composedTitle || countryName || platformLabel || `Service ${productId}`);

  const minQuantity = Number(pick(raw.min, raw.min_quantity, raw.minQuantity, 1)) || 1;
  const maxQuantity = raw.max != null || raw.max_quantity != null || raw.maxQuantity != null
    ? Number(pick(raw.max, raw.max_quantity, raw.maxQuantity))
    : null;
  const refill = Boolean(pick(raw.refill, raw.refillable, raw.has_refill, raw.hasRefill));
  const cancel = Boolean(pick(raw.cancel, raw.cancellable, raw.has_cancel, raw.hasCancel));
  const optionBits = [];
  if (Number.isFinite(minQuantity) && minQuantity > 1) optionBits.push(`Min ${minQuantity.toLocaleString()}`);
  if (Number.isFinite(maxQuantity) && maxQuantity > 0) optionBits.push(`Max ${maxQuantity.toLocaleString()}`);
  if (refill) optionBits.push('Refill');
  if (cancel) optionBits.push('Cancel');
  if (pricingModel === 'per_1000') optionBits.push('Per 1K');

  const featureList = asArray(raw.features).map(String).filter(Boolean);
  const description = String(pick(
    raw.description,
    raw.desc,
    [...featureList.slice(0, 4), ...optionBits].filter(Boolean).join(' · ') || null,
    [platformLabel !== 'General' ? platformLabel : null, subcategoryLabel]
      .filter(Boolean)
      .join(' · '),
    ''
  ) || '');

  const countryId = pick(raw.country_id, raw.countryId, isNumericId(raw.country) ? raw.country : null);

  return {
    product_id: String(productId),
    name,
    description,
    price_usd: priceUsd,
    platform: platformLabel,
    platform_key: slugKey(platformLabel),
    subcategory: subcategoryLabel || null,
    subcategory_key: subcategoryLabel ? slugKey(subcategoryLabel) : ALL_KEY,
    country_id: countryId != null ? String(countryId) : null,
    country_name: countryName || null,
    pricing_model: pricingModel === 'per_1000' ? 'per_1000' : 'package',
    min_quantity: minQuantity,
    max_quantity: Number.isFinite(maxQuantity) ? maxQuantity : null,
    refill,
    cancel,
    options: optionBits,
    category_id: categoryId || null,
    features: featureList,
    raw,
  };
}

/**
 * Ensure product/filter labels are human names, not bare API ids.
 * Mutates and returns the products array.
 */
function enrichDisplayLabels(products) {
  return asArray(products).map((p) => {
    if (!p || typeof p !== 'object') return p;
    const countryName = p.country_name
      || resolveCountryName(p.country_id)
      || resolveCountryName(p.raw?.country_id)
      || resolveCountryName(p.raw?.country)
      || null;

    let platform = pickDisplayName(p.platform, p.raw?.service_name, p.raw?.platform_name, p.raw?.platform)
      || p.platform
      || 'General';
    if (isNumericId(platform)) {
      platform = resolveCountryName(platform)
        || pickDisplayName(p.raw?.service_name, p.raw?.name)
        || platform;
    }

    let subcategory = pickDisplayName(
      p.subcategory,
      p.raw?.category_name,
      p.raw?.category,
      countryName
    );
    if (subcategory && isNumericId(subcategory)) {
      subcategory = resolveCountryName(subcategory) || subcategory;
    }
    if (!subcategory && countryName && slugKey(countryName) !== slugKey(platform)) {
      subcategory = countryName;
    }

    let name = pickDisplayName(p.name, p.raw?.name, p.raw?.productName, p.raw?.title);
    if (!name || isNumericId(name) || looksLikeServicePlaceholder(name)) {
      name = platform && subcategory
        ? `${platform} · ${subcategory}`
        : (countryName || platform || `Service ${p.product_id}`);
    } else if (/·\s*country\s+\d+/i.test(name) && countryName) {
      name = name.replace(/country\s+\d+/ig, countryName);
    } else if (/\b\d{1,5}\b/.test(name) && countryName) {
      // Replace trailing bare ids in composed titles when we know the country.
      name = name.replace(/(·\s*)(\d{1,5})\s*$/g, `$1${countryName}`);
    }

    return {
      ...p,
      name,
      platform,
      platform_key: slugKey(platform),
      subcategory: subcategory || null,
      subcategory_key: subcategory ? slugKey(subcategory) : ALL_KEY,
      country_name: countryName || p.country_name || null,
      description: pickDisplayName(p.description, [platform, subcategory].filter(Boolean).join(' · '))
        || p.description
        || '',
    };
  });
}

function buildFilterMeta(products, { platform = null, subcategory = null } = {}) {
  const platformMap = new Map();
  const subMap = new Map();
  const labeled = enrichDisplayLabels(products);

  for (const p of labeled) {
    const pKey = p.platform_key || slugKey(p.platform);
    const platformName = pickDisplayName(p.platform) || p.platform || pKey;
    if (!platformMap.has(pKey)) {
      platformMap.set(pKey, { key: pKey, name: platformName, count: 0 });
    } else if (isNumericId(platformMap.get(pKey).name) && !isNumericId(platformName)) {
      platformMap.get(pKey).name = platformName;
    }
    platformMap.get(pKey).count += 1;

    const sKey = p.subcategory_key || ALL_KEY;
    const sName = pickDisplayName(p.subcategory, p.country_name) || p.subcategory || 'All';
    const compound = `${pKey}::${sKey}`;
    if (!subMap.has(compound)) {
      subMap.set(compound, {
        key: sKey,
        name: sName,
        platform_key: pKey,
        count: 0,
      });
    } else if (isNumericId(subMap.get(compound).name) && !isNumericId(sName)) {
      subMap.get(compound).name = sName;
    }
    subMap.get(compound).count += 1;
  }

  const platforms = [
    { key: ALL_KEY, name: 'All platforms', count: labeled.length },
    ...[...platformMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
  ];

  // Accept filter by slug OR by display name OR by unresolved numeric id.
  const selectedPlatformRaw = platform && platform !== ALL_KEY ? String(platform) : ALL_KEY;
  const selectedPlatform = selectedPlatformRaw === ALL_KEY
    ? ALL_KEY
    : (slugKey(pickDisplayName(selectedPlatformRaw) || selectedPlatformRaw));
  let subcategories = [...subMap.values()];
  if (selectedPlatform !== ALL_KEY) {
    subcategories = subcategories.filter((s) => s.platform_key === selectedPlatform);
  }
  const uniqueSubs = new Map();
  for (const s of subcategories) {
    if (!uniqueSubs.has(s.key)) uniqueSubs.set(s.key, { ...s, count: 0 });
    uniqueSubs.get(s.key).count += s.count;
  }

  const platformFiltered = selectedPlatform === ALL_KEY
    ? labeled
    : labeled.filter((p) => (p.platform_key || slugKey(p.platform)) === selectedPlatform);

  subcategories = [
    {
      key: ALL_KEY,
      name: 'All types',
      platform_key: selectedPlatform,
      count: platformFiltered.length,
    },
    ...[...uniqueSubs.values()]
      .filter((s) => s.key !== ALL_KEY)
      .sort((a, b) => a.name.localeCompare(b.name)),
  ];

  const selectedSubRaw = subcategory && subcategory !== ALL_KEY ? String(subcategory) : ALL_KEY;
  const selectedSub = selectedSubRaw === ALL_KEY
    ? ALL_KEY
    : slugKey(pickDisplayName(selectedSubRaw) || selectedSubRaw);
  let filtered = platformFiltered;
  if (selectedSub !== ALL_KEY) {
    filtered = filtered.filter((p) => (p.subcategory_key || ALL_KEY) === selectedSub);
  }

  return {
    platforms,
    subcategories,
    filters: {
      platform: selectedPlatform,
      subcategory: selectedSub,
    },
    products: filtered,
  };
}

/**
 * Flatten one SIM top-up operator row (packages nested) into products.
 */
function expandSimOperatorRows(rows, categoryId = 'sim_topup') {
  const products = [];
  for (const row of asArray(rows)) {
    const operatorName = pick(row.operator_name, row.operatorName, row.name, 'Operator');
    const operatorId = pick(row.operator_id, row.operatorId, row.id);
    const country = pick(row.country_iso, row.countryIso, row.country, row.countryCode, 'INTL');
    const packages = asArray(row.packages);
    if (!packages.length) {
      const single = normalizeServiceProduct({
        ...row,
        product_id: pick(row.product_id, `sim-${operatorId || slugKey(operatorName)}`),
        name: pick(row.name, `${operatorName} top-up`),
        platform: String(country).toUpperCase(),
        category: operatorName,
        price_usd: pick(row.usd_price, row.price_usd, row.price),
      }, { categoryId, platform: String(country).toUpperCase(), subcategory: String(operatorName) });
      if (single) products.push(single);
      continue;
    }
    for (const pkg of packages) {
      const idx = pick(pkg.index, pkg.package_index, pkg.packageIndex, pkg.id);
      const normalized = normalizeServiceProduct({
        ...pkg,
        product_id: `sim-${operatorId || 'op'}-${idx}`,
        name: pick(pkg.name, pkg.title, `${operatorName} top-up`),
        description: `${operatorName} · ${country}`,
        price_usd: pick(pkg.usd_price, pkg.price_usd, pkg.price, pkg.amount),
        platform: String(country).toUpperCase(),
        category: String(operatorName),
        operator_id: operatorId,
        package_index: idx,
      }, {
        categoryId,
        platform: String(country).toUpperCase(),
        subcategory: String(operatorName),
      });
      if (normalized) products.push(normalized);
    }
  }
  return products;
}

/**
 * Expand proxy families { static:[], pool:[] } or flat plan lists into products.
 */
function expandProxyFamilies(data, categoryId = 'proxies') {
  const products = [];
  const families = data?.families && typeof data.families === 'object' ? data.families : null;

  const pushProxy = (item, familyHint = 'proxy') => {
    if (!item || typeof item !== 'object') return;
    if (item.families) {
      products.push(...expandProxyFamilies(item, categoryId));
      return;
    }
    const type = pick(item.type, item.id, item.key, item.name, item.code);
    const label = pickDisplayName(item.label, item.name, item.title, type) || 'Proxy';
    const family = pick(item.family, item.category, familyHint, 'proxy');
    const price = money(pick(
      item.min_price_usd,
      item.minPriceUsd,
      item.price_usd,
      item.priceUsd,
      item.rate_usd,
      item.rateUsd,
      item.starting_at,
      item.from_usd,
      item.price,
      item.cost
    ));
    if (price == null) return;
    const normalized = normalizeServiceProduct({
      ...item,
      product_id: pick(item.product_id, item.productId, item.plan_id, `proxy-${family}-${type}`),
      name: label,
      price_usd: price,
      platform: label,
      category: family,
    }, { categoryId, platform: label, subcategory: String(family) });
    if (normalized) products.push(normalized);
  };

  if (families) {
    for (const family of Object.keys(families)) {
      for (const item of asArray(families[family])) pushProxy(item, family);
    }
  }

  for (const item of asArray(
    data?.packages || data?.products || data?.plans || data?.types || data?.items || data?.results
  )) {
    pushProxy(item, pick(item.family, item.category, 'proxy'));
  }

  if (Array.isArray(data)) {
    for (const item of data) pushProxy(item, 'proxy');
  }

  return products;
}

/**
 * Expand Kripicard giftcard rows (denominations × brand) into priced Hub products.
 * USD dens use face value; non-USD dens prefer sender-USD dens / min sender amounts.
 */
function expandGiftCardProducts(items, categoryId = 'gift_cards') {
  const products = [];

  for (const item of asArray(items)) {
    if (!item || typeof item !== 'object') continue;
    const productId = pick(item.product_id, item.productId, item.id);
    if (productId == null) continue;

    const brand = pickDisplayName(
      item.brand?.brandName,
      item.brand,
      item.category,
      'Gift Card'
    ) || 'Gift Card';
    const baseName = pickDisplayName(
      item.product_name,
      item.productName,
      item.name,
      item.title,
      `${brand} gift card`
    ) || `${brand} gift card`;
    const countryIso = String(pick(item.country_iso, item.countryIso, item.country, 'XX')).toUpperCase();
    const countryName = pickDisplayName(
      item.country_name,
      item.countryName,
      resolveCountryName(countryIso),
      countryIso
    ) || countryIso;
    const currency = String(pick(
      item.currency,
      item.recipient_currency,
      item.recipientCurrency,
      'USD'
    ) || 'USD').toUpperCase();

    const localDens = asArray(
      item.denominations
        || item.fixed_denominations
        || item.fixedDenominations
        || item.fixedRecipientDenominations
    ).map(Number).filter((n) => Number.isFinite(n) && n > 0);

    const senderDens = asArray(
      item.fixed_sender_denominations
        || item.fixedSenderDenominations
        || item.sender_denominations
        || item.senderDenominations
    ).map(Number).filter((n) => Number.isFinite(n) && n > 0);

    const minSender = money(pick(
      item.min_sender_amount,
      item.minSenderAmount,
      item.minSenderDenomination,
      item.sender_min
    ));
    const maxSender = money(pick(
      item.max_sender_amount,
      item.maxSenderAmount,
      item.maxSenderDenomination,
      item.sender_max
    ));

    const pushGift = (localAmount, usdPrice) => {
      if (usdPrice == null || usdPrice <= 0) return;
      const suffix = localAmount != null ? String(localAmount) : 'base';
      const normalized = normalizeServiceProduct({
        ...item,
        product_id: `gift-${productId}-${suffix}`,
        name: localAmount != null
          ? `${baseName} · ${localAmount} ${currency}`
          : baseName,
        description: pick(
          item.description,
          `${brand} · ${countryName}${localAmount != null ? ` · ${localAmount} ${currency}` : ''}`
        ),
        price_usd: usdPrice,
        platform: countryName,
        category: brand,
        country_iso: countryIso,
        country_name: countryName,
        local_amount: localAmount,
        currency,
        brand,
        service_name: baseName,
      }, {
        categoryId,
        platform: countryName,
        subcategory: brand,
      });
      if (normalized) {
        products.push({
          ...normalized,
          local_amount: localAmount,
          currency,
          service_name: baseName,
          brand,
        });
      }
    };

    if (localDens.length) {
      const minLocal = localDens[0];
      const maxLocal = localDens[localDens.length - 1];
      for (let i = 0; i < localDens.length; i += 1) {
        const local = localDens[i];
        let usd = null;
        if (currency === 'USD') {
          usd = money(local);
        } else if (senderDens[i] != null) {
          usd = money(senderDens[i]);
        } else if (senderDens.length === 1) {
          usd = money(senderDens[0]);
        } else if (minSender != null && maxLocal > minLocal) {
          const t = (local - minLocal) / (maxLocal - minLocal);
          usd = money(minSender + t * ((maxSender != null ? maxSender : minSender) - minSender));
        } else if (minSender != null) {
          usd = minSender;
        } else {
          usd = money(pick(item.usd_price, item.price_usd, item.price, item.usd_base));
        }
        pushGift(local, usd);
      }
      continue;
    }

    const usd = money(pick(
      item.price_usd,
      item.usd_price,
      item.price,
      item.usd_base,
      minSender,
      item.min_amount
    ));
    if (usd != null && (currency === 'USD' || minSender != null || item.price_usd != null || item.usd_price != null)) {
      pushGift(money(pick(item.min_amount, item.minRecipientDenomination, item.amount)), usd);
    }
  }

  return products;
}

function listFromCatalogPayload(raw, extraKeys = []) {
  const data = unwrapData(raw);
  if (Array.isArray(data)) return data;
  if (Array.isArray(raw)) return raw;
  const keys = [
    'packages',
    'products',
    'giftcards',
    'services',
    'items',
    'results',
    'rows',
    'plans',
    'types',
    ...extraKeys,
  ];
  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key];
    if (Array.isArray(raw?.[key])) return raw[key];
  }
  return itemsFromBucket(data);
}

function itemsFromBucket(bucket) {
  if (!bucket) return [];
  if (Array.isArray(bucket)) return bucket;
  if (typeof bucket !== 'object') return [];
  return asArray(
    bucket.services
      || bucket.products
      || bucket.packages
      || bucket.items
      || bucket.results
      || bucket.rows
      || bucket.giftcards
      || bucket.data
  );
}

/**
 * Map a raw /services (or module) payload into Hub category → product lists.
 * Supports:
 *  - keyed modules: { sms:[], smm:{services:[]}, gifts:{products:[]}, … }
 *  - flat services: { services:[{ category|module|type, … }] }
 *  - categories: [{ id|name|slug, services|products|… }]
 *  - bare arrays (caller must pass defaultCategoryId)
 */
function mapMainServicesToHubCategories(raw, { defaultCategoryId = null } = {}) {
  const data = unwrapData(raw);
  const byCategory = {
    sms: [],
    sim_topup: [],
    esim: [],
    gift_cards: [],
    social_media: [],
    proxies: [],
  };

  const pushItem = (hubId, item, extras = {}) => {
    if (!hubId || !byCategory[hubId]) return;
    if (hubId === 'sim_topup' && asArray(item?.packages).length) {
      byCategory[hubId].push(...expandSimOperatorRows([item], hubId));
      return;
    }
    const platform = extras.platform || null;
    const subcategory = extras.subcategory || null;
    const normalized = normalizeServiceProduct(item, {
      categoryId: hubId,
      platform,
      subcategory,
    });
    if (normalized) byCategory[hubId].push(normalized);
  };

  // Shape: { categories: [ { id, services } ] }
  if (asArray(data.categories).length) {
    for (const cat of data.categories) {
      const hubId = resolveHubCategory(pick(cat.id, cat.slug, cat.key, cat.name, cat.module, cat.type))
        || defaultCategoryId;
      for (const item of itemsFromBucket(cat)) {
        pushItem(hubId, item, {
          platform: pick(item.platform, cat.platform),
          subcategory: pick(item.category, item.group, cat.group),
        });
      }
    }
  }

  // Shape: keyed modules on data (sms, smm, esim, gifts, sim, proxies, …)
  const moduleKeys = Object.keys(data || {}).filter((k) => resolveHubCategory(k));
  if (moduleKeys.length) {
    for (const key of moduleKeys) {
      const hubId = resolveHubCategory(key);
      const bucket = data[key];
      if (hubId === 'proxies' && (bucket?.families || bucket?.packages || bucket?.types)) {
        byCategory.proxies.push(...expandProxyFamilies(bucket, 'proxies'));
        continue;
      }
      if (hubId === 'sim_topup') {
        const rows = itemsFromBucket(bucket);
        if (rows.some((r) => asArray(r.packages).length)) {
          byCategory.sim_topup.push(...expandSimOperatorRows(rows, 'sim_topup'));
          continue;
        }
      }
      if (hubId === 'gift_cards') {
        const giftRows = asArray(
          bucket?.giftcards || bucket?.products || itemsFromBucket(bucket)
        );
        byCategory.gift_cards.push(...expandGiftCardProducts(giftRows, 'gift_cards'));
        continue;
      }
      if (hubId === 'esim') {
        const esimRows = asArray(bucket?.packages || itemsFromBucket(bucket));
        for (const item of esimRows) {
          pushItem(hubId, {
            ...item,
            product_id: pick(item.product_id, item.packageCode, item.package_code, item.id),
            platform: pick(item.countryCode, item.country_iso, item.country, item.locationCode),
            category: pick(item.data, item.volume, item.duration, item.validity),
            price_usd: pick(item.price_usd, item.price, item.usd_price),
          });
        }
        continue;
      }
      for (const item of itemsFromBucket(bucket)) {
        pushItem(hubId, {
          ...item,
          platform: pick(item.platform, item.brand, item.country_iso, item.country),
          category: pick(item.category, item.group, item.data, item.brand),
        });
      }
      // SMM-style platforms metadata ignored here; rebuilt from products later.
    }
  }

  // Shape: flat services / products list with per-item category
  const flat = asArray(
    data.services
      || data.products
      || data.items
      || data.results
      || (Array.isArray(data) ? data : null)
  );
  if (flat.length && !moduleKeys.length && !asArray(data.categories).length) {
    for (const item of flat) {
      const hubId = resolveHubCategory(pick(
        item.module,
        item.service_module,
        item.hub_category,
        item.category_type,
        item.resource_type,
        item.type,
        item.category
      )) || defaultCategoryId;

      // SMM uses category as subcategory (Followers), platform as platform.
      if (hubId === 'social_media' || (!hubId && defaultCategoryId === 'social_media')) {
        pushItem(hubId || 'social_media', item, {
          platform: item.platform,
          subcategory: pick(item.category, item.group, item.type),
        });
        continue;
      }
      if (hubId === 'proxies' || defaultCategoryId === 'proxies') {
        if (item.families) {
          byCategory.proxies.push(...expandProxyFamilies(item, 'proxies'));
        } else {
          pushItem(hubId || 'proxies', item, {
            platform: pick(item.type, item.platform, item.name),
            subcategory: pick(item.family, item.category, 'proxy'),
          });
        }
        continue;
      }
      pushItem(hubId, item);
    }
  }

  // Proxy families at top-level data
  if (data.families && typeof data.families === 'object') {
    byCategory.proxies.push(...expandProxyFamilies(data, 'proxies'));
  }

  return byCategory;
}

/** Default page size when walking Kripicard /smm/services (override via env). */
const SMM_PAGE_SIZE = Math.max(
  50,
  Number(process.env.KRIPICARD_HUB_SMM_PAGE_SIZE) || 500
);
const SMM_MAX_PAGES = Math.max(
  1,
  Number(process.env.KRIPICARD_HUB_SMM_MAX_PAGES) || 200
);
/** Max concurrent platform (or page) fetches against Kripicard. */
const SMM_CONCURRENCY = Math.max(
  1,
  Math.min(12, Number(process.env.KRIPICARD_HUB_SMM_CONCURRENCY) || 4)
);
const SMM_CACHE_TTL_MS = Math.max(
  0,
  Number(process.env.KRIPICARD_HUB_SMM_CACHE_MS) || 5 * 60 * 1000
);
const MODULE_CACHE_TTL_MS = Math.max(
  0,
  Number(process.env.KRIPICARD_HUB_MODULE_CACHE_MS) || 5 * 60 * 1000
);
/** Max concurrent SMS service-detail lookups (country/price expansions). */
const SMS_DETAIL_CONCURRENCY = Math.max(
  1,
  Math.min(16, Number(process.env.KRIPICARD_HUB_SMS_DETAIL_CONCURRENCY) || 6)
);

/** Eager SMM / module catalog caches + single-flight coalescing. */
const smmCatalogCache = new Map(); // key -> { expires, value }
const smmInflight = new Map(); // key -> Promise
const moduleCatalogCache = new Map();
const moduleInflight = new Map();

/**
 * Run `worker` over items with bounded concurrency (batch fetch helper).
 */
async function mapPool(items, concurrency, worker) {
  const list = asArray(items);
  if (!list.length) return [];
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, list.length));
  const results = new Array(list.length);
  let cursor = 0;
  async function runner() {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => runner()));
  return results;
}

function cacheGet(map, key) {
  const hit = map.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    map.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(map, key, value, ttlMs) {
  if (!ttlMs || ttlMs <= 0) return;
  map.set(key, { expires: Date.now() + ttlMs, value });
}

async function withSingleFlight(inflightMap, key, producer) {
  if (inflightMap.has(key)) return inflightMap.get(key);
  const pending = Promise.resolve()
    .then(producer)
    .finally(() => {
      inflightMap.delete(key);
    });
  inflightMap.set(key, pending);
  return pending;
}

function smmCacheKey(filters = {}) {
  const platform = filters.platform && filters.platform !== ALL_KEY
    ? slugKey(filters.platform)
    : ALL_KEY;
  const search = String(filters.search || '').trim().toLowerCase();
  return `smm|p=${platform}|q=${search}`;
}

function moduleCacheKey(categoryId, filters = {}) {
  return [
    String(categoryId || ''),
    `p=${filters.platform && filters.platform !== ALL_KEY ? slugKey(filters.platform) : ALL_KEY}`,
    `s=${filters.subcategory && filters.subcategory !== ALL_KEY ? slugKey(filters.subcategory) : ALL_KEY}`,
    `q=${String(filters.search || '').trim().toLowerCase()}`,
    `c=${String(filters.country || '').trim().toLowerCase()}`,
    `n=${String(filters.number || '').trim()}`,
  ].join('|');
}

/**
 * Infer a Social Media platform label from free-text service fields.
 * Used when Kripicard rows omit `platform` but encode it in the name/category.
 */
function inferSmmPlatformLabel(...texts) {
  const hay = texts.filter((t) => t != null && String(t).trim() !== '').join(' ').toLowerCase();
  if (!hay) return null;
  const rules = [
    [/instagram|\big\b/, 'Instagram'],
    [/tiktok|tik tok/, 'TikTok'],
    [/youtube|\byt\b/, 'YouTube'],
    [/facebook|\bfb\b/, 'Facebook'],
    [/twitter|twitter\s*\/\s*x|\bx\s*\(twitter\)/, 'Twitter / X'],
    [/telegram|\btg\b/, 'Telegram'],
    [/discord/, 'Discord'],
    [/linkedin/, 'LinkedIn'],
    [/snapchat|\bsnap\b/, 'Snapchat'],
    [/pinterest/, 'Pinterest'],
    [/spotify/, 'Spotify'],
    [/sound\s*cloud/, 'SoundCloud'],
    [/twitch/, 'Twitch'],
    [/reddit/, 'Reddit'],
    [/whatsapp/, 'WhatsApp'],
    [/threads/, 'Threads'],
    [/\bkick\b/, 'Kick'],
  ];
  for (const [re, label] of rules) {
    if (re.test(hay)) return label;
  }
  // Bare "X" platform token (avoid matching inside other words).
  if (/(^|[\s|/_\-])x([\s|/_\-]|$)/i.test(hay) && !/xbox|xlsx|xml/.test(hay)) {
    return 'Twitter / X';
  }
  return null;
}

/** Merge named `{ name, key?, count? }` platform directory rows across pages. */
function mergeNamedSmmPlatforms(existing, incoming) {
  const byKey = new Map();
  for (const p of [...asArray(existing), ...asArray(incoming)]) {
    if (!p || typeof p !== 'object') continue;
    const name = pick(p.name, p.title, p.label, p.key, p.id);
    if (!name) continue;
    const key = slugKey(pick(p.key, name));
    const count = Number(p.count);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, {
        key,
        name: String(name),
        count: Number.isFinite(count) ? count : 0,
      });
      continue;
    }
    if (!isNumericId(name)) prev.name = String(name);
    if (Number.isFinite(count) && count > (prev.count || 0)) prev.count = count;
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Ensure Hub platform chips include every platform from the API directory,
 * not only those present on the currently loaded product page.
 */
function applySmmPlatformDirectory(platforms, directory, products = []) {
  const byKey = new Map(
    asArray(platforms)
      .filter((p) => p && p.key !== ALL_KEY)
      .map((p) => [p.key, { ...p }])
  );
  for (const p of asArray(directory)) {
    const key = slugKey(pick(p.key, p.name));
    if (!key || key === ALL_KEY) continue;
    const fromProducts = asArray(products).filter((x) => (
      (x.platform_key || slugKey(x.platform)) === key
    )).length;
    const apiCount = Number(p.count);
    const count = fromProducts > 0
      ? fromProducts
      : (Number.isFinite(apiCount) ? apiCount : (byKey.get(key)?.count || 0));
    if (byKey.has(key)) {
      const row = byKey.get(key);
      if (!isNumericId(p.name)) row.name = String(p.name || row.name);
      row.count = Math.max(Number(row.count) || 0, count);
    } else {
      byKey.set(key, {
        key,
        name: String(p.name || key),
        count,
      });
    }
  }
  const labeled = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  const allCount = asArray(products).length
    || labeled.reduce((sum, p) => sum + (Number(p.count) || 0), 0);
  return [
    { key: ALL_KEY, name: 'All platforms', count: allCount },
    ...labeled,
  ];
}

function smmServiceDedupeKey(svc) {
  if (!svc || typeof svc !== 'object') return '';
  const id = pick(
    svc.service_id,
    svc.serviceId,
    svc.service,
    svc.product_id,
    svc.productId,
    svc.id,
    svc.sku
  );
  if (id != null && String(id).trim() !== '') return `id:${id}`;
  return [
    'row',
    slugKey(svc.platform || ''),
    slugKey(svc.category || svc.group || svc.type || ''),
    slugKey(svc.name || svc.title || ''),
    String(pick(svc.rate_usd, svc.price_usd, svc.price, '')),
  ].join(':');
}

function countNestedSmmServices(platforms) {
  let n = 0;
  for (const plat of asArray(platforms)) {
    for (const group of asArray(plat?.groups)) {
      n += asArray(group?.services).length;
    }
  }
  return n;
}

/**
 * Merge nested SMM platform → group → service trees across paginated responses.
 */
function mergeSmmNestedPlatforms(existing, incoming) {
  const out = asArray(existing).map((p) => ({
    ...p,
    groups: asArray(p.groups).map((g) => ({
      ...g,
      services: [...asArray(g.services)],
    })),
  }));

  for (const plat of asArray(incoming)) {
    if (!plat || typeof plat !== 'object') continue;
    const pKey = slugKey(pick(plat.key, plat.name, plat.id, 'platform'));
    let target = out.find((p) => slugKey(pick(p.key, p.name, p.id, 'platform')) === pKey);
    if (!target) {
      target = {
        ...plat,
        groups: asArray(plat.groups).map((g) => ({
          ...g,
          services: [...asArray(g.services)],
        })),
      };
      out.push(target);
      continue;
    }
    if (!target.name && plat.name) target.name = plat.name;
    for (const group of asArray(plat.groups)) {
      const gKey = slugKey(pick(group.key, group.name, group.title, 'general'));
      let gTarget = asArray(target.groups).find((g) => (
        slugKey(pick(g.key, g.name, g.title, 'general')) === gKey
      ));
      if (!gTarget) {
        gTarget = { ...group, services: [...asArray(group.services)] };
        target.groups = [...asArray(target.groups), gTarget];
        continue;
      }
      const seen = new Set(asArray(gTarget.services).map(smmServiceDedupeKey).filter(Boolean));
      for (const svc of asArray(group.services)) {
        const key = smmServiceDedupeKey(svc);
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        gTarget.services.push(svc);
      }
    }
  }
  return out;
}

/** Parse one /smm/services response page into a common shape. */
function extractSmmPage(raw) {
  const data = unwrapData(raw);
  const envelope = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const pagination = (
    (data && typeof data === 'object' && !Array.isArray(data) ? data.pagination : null)
    || envelope.pagination
    || (data && typeof data === 'object' ? data.meta : null)
    || {}
  );

  const nestedPlatforms = asArray(data.platforms).filter((p) => (
    p && typeof p === 'object' && asArray(p.groups).length
  ));
  const namedPlatforms = asArray(data.platforms).filter((p) => (
    p && typeof p === 'object' && p.name && !asArray(p.groups).length
  ));
  const services = asArray(
    data.services
      || data.items
      || data.results
      || data.rows
      || envelope.services
      || (Array.isArray(data) ? data : null)
  );
  const nestedCount = countNestedSmmServices(nestedPlatforms);
  const pageCount = services.length || nestedCount;
  const total = Number(
    pagination.total
      || pagination.totalItems
      || pagination.total_items
      || data.totalItems
      || data.total_items
      || data.total
      || envelope.totalItems
      || envelope.total
  );
  const perPage = Number(
    pagination.per_page
      || pagination.perPage
      || pagination.limit
      || data.per_page
      || data.perPage
  );
  const currentPage = Number(
    pagination.page
      || pagination.current_page
      || pagination.currentPage
      || data.page
      || 1
  ) || 1;
  let totalPages = Number(
    pagination.total_pages
      || pagination.totalPages
      || pagination.pages
      || data.total_pages
      || data.totalPages
  );
  if ((!Number.isFinite(totalPages) || totalPages <= 0)
    && Number.isFinite(total) && total > 0
    && Number.isFinite(perPage) && perPage > 0) {
    totalPages = Math.ceil(total / perPage);
  }

  return {
    data,
    nestedPlatforms,
    namedPlatforms,
    services,
    pageCount,
    nestedCount,
    total: Number.isFinite(total) && total > 0 ? total : null,
    perPage: Number.isFinite(perPage) && perPage > 0 ? perPage : null,
    currentPage,
    totalPages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : null,
  };
}

/**
 * Combine one or more SMM page payloads into a single normalizer-ready object.
 * Pure helper — used by fetchCompleteSmmCatalog and unit tests.
 */
function combineSmmPages(pages, { reportedTotal = null, namedPlatforms = [] } = {}) {
  const list = asArray(pages);
  let nested = [];
  const services = [];
  const seen = new Set();
  let named = asArray(namedPlatforms);

  for (const page of list) {
    const extracted = page?.services || page?.nestedPlatforms
      ? page
      : extractSmmPage(page);
    if (asArray(extracted.namedPlatforms).length) {
      const byName = new Map(named.map((p) => [slugKey(p.name), p]));
      for (const p of extracted.namedPlatforms) {
        byName.set(slugKey(p.name), p);
      }
      named = [...byName.values()];
    }
    if (asArray(extracted.nestedPlatforms).length) {
      nested = mergeSmmNestedPlatforms(nested, extracted.nestedPlatforms);
    }
    for (const svc of asArray(extracted.services)) {
      const key = smmServiceDedupeKey(svc);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      services.push(svc);
    }
  }

  const totalItems = reportedTotal
    || (nested.length ? countNestedSmmServices(nested) + services.length : services.length);

  // Keep named platform directory even when a nested tree is present so chips
  // still list Facebook/Telegram/etc. that only appear as metadata on some pages.
  const nestedKeys = new Set(
    nested.map((p) => slugKey(pick(p.key, p.name, p.id)))
  );
  const platforms = nested.length
    ? [
      ...nested,
      ...named.filter((p) => !nestedKeys.has(slugKey(pick(p.key, p.name, p.id)))),
    ]
    : named;

  return {
    success: true,
    data: {
      enabled: true,
      services,
      platforms,
      totalItems,
      count: totalItems,
    },
  };
}

/** Normalize documented SMM flat/nested list (also used when /services returns smm-only). */
function normalizeSmmCatalog(raw, filters = {}) {
  const data = unwrapData(raw);
  const products = [];
  const seen = new Set();

  const pushProduct = (normalized) => {
    if (!normalized?.product_id) return;
    if (seen.has(normalized.product_id)) return;
    seen.add(normalized.product_id);
    products.push(normalized);
  };

  const nestedPlatforms = asArray(data.platforms).filter((p) => (
    p && typeof p === 'object' && asArray(p.groups).length
  ));
  if (nestedPlatforms.length) {
    for (const plat of nestedPlatforms) {
      const platformName = pick(plat.name, plat.key, plat.id, 'Platform');
      for (const group of asArray(plat.groups)) {
        const groupName = pick(group.name, group.title, group.key, 'General');
        for (const svc of asArray(group.services)) {
          pushProduct(normalizeServiceProduct(
            { ...svc, platform: platformName, category: groupName },
            { platform: platformName, subcategory: groupName, categoryId: 'social_media' }
          ));
        }
      }
    }
  }

  // Flat services may accompany nested trees on some gateways — include both.
  for (const svc of asArray(
    data.services || data.items || data.results || data.rows || (Array.isArray(data) ? data : null)
  )) {
    pushProduct(normalizeServiceProduct(svc, {
      categoryId: 'social_media',
      platform: svc.platform,
      subcategory: pick(svc.category, svc.group, svc.type),
    }));
  }

  // Prefer product-derived chips; always merge the API platform directory so
  // Facebook / Telegram / etc. remain visible even before their page of services loads.
  const meta = buildFilterMeta(products, filters);
  const namedPlatforms = mergeNamedSmmPlatforms(
    asArray(data.platforms).filter((p) => (
      p && typeof p === 'object' && !asArray(p.groups).length && (p.name || p.key)
    )),
    asArray(data.platforms)
      .filter((p) => p && typeof p === 'object' && asArray(p.groups).length)
      .map((p) => ({
        name: pick(p.name, p.key, p.id),
        key: slugKey(pick(p.key, p.name, p.id)),
        count: countNestedSmmServices([p]),
      }))
  );
  if (namedPlatforms.length) {
    meta.platforms = applySmmPlatformDirectory(meta.platforms, namedPlatforms, products);
  }
  return {
    enabled: data.enabled !== false,
    // After a complete fetch, product length is authoritative.
    count: products.length || Number(data.totalItems || data.count) || 0,
    ...meta,
  };
}

/** Sum directory `count` hints so we know when pagination is still incomplete. */
function directoryServiceTarget(directory, platformFilter = null) {
  let rows = asArray(directory);
  if (!rows.length) return null;
  if (platformFilter && platformFilter !== ALL_KEY) {
    const key = slugKey(platformFilter);
    rows = rows.filter((p) => slugKey(pick(p.name, p.key, p.id)) === key);
  }
  const sum = rows.reduce((acc, p) => acc + (Number(p.count) || 0), 0);
  return sum > 0 ? sum : null;
}

function nestedCountForPlatformKey(nestedPlatforms, key) {
  const plat = asArray(nestedPlatforms).find((p) => (
    slugKey(pick(p.key, p.name, p.id)) === key
  ));
  return plat ? countNestedSmmServices([plat]) : 0;
}

/**
 * Paginate /smm/services for one optional platform filter.
 * Never stops solely because the first page is shorter than Hub's requested
 * page size — Kripicard often returns silent short pages without total meta.
 * `seedPage` (already extracted) can be supplied as page 1 to avoid a duplicate request.
 */
async function paginateSmmServices({
  platform = null,
  search = null,
  seedPage = null,
  seedRaw = null,
  expectedTotal = null,
} = {}) {
  const baseBody = {};
  if (platform && platform !== ALL_KEY) baseBody.platform = platform;
  if (search) baseBody.search = search;

  const pageSize = SMM_PAGE_SIZE;
  const pages = [];
  let reportedTotal = Number.isFinite(expectedTotal) && expectedTotal > 0 ? expectedTotal : null;
  let namedPlatforms = [];
  let nestedAcc = [];
  let flatCount = 0;
  let lastRaw = seedRaw;
  let pagesFetched = 0;
  let startPage = 1;

  const collectedCount = () => flatCount + countNestedSmmServices(nestedAcc);

  const fetchPage = async (page) => {
    const body = {
      ...baseBody,
      page,
      per_page: pageSize,
      perPage: pageSize,
      limit: pageSize,
    };
    const raw = await hubRequest('/smm/services', { body });
    return { raw, extracted: extractSmmPage(raw), page };
  };

  const absorb = (extracted, raw, page) => {
    lastRaw = raw;
    pagesFetched = Math.max(pagesFetched, page);
    pages.push(extracted);
    if (extracted.total != null) {
      reportedTotal = extracted.total;
    } else if (reportedTotal == null) {
      const fromDir = directoryServiceTarget(extracted.namedPlatforms, platform);
      if (fromDir != null) reportedTotal = fromDir;
    }
    namedPlatforms = mergeNamedSmmPlatforms(namedPlatforms, extracted.namedPlatforms);
    if (extracted.nestedPlatforms.length) {
      nestedAcc = mergeSmmNestedPlatforms(nestedAcc, extracted.nestedPlatforms);
    }
    flatCount += asArray(extracted.services).length;
  };

  if (seedPage) {
    absorb(seedPage, seedRaw, 1);
    // Nested-only dump: only stop early when an authoritative target says we
    // already have every service. Without a target, keep walking — short nested
    // trees are often truncated samples (one service / variation per platform).
    if (
      seedPage.nestedPlatforms.length
      && !seedPage.services.length
      && !seedPage.totalPages
      && seedPage.total == null
    ) {
      const target = directoryServiceTarget(namedPlatforms, platform) || expectedTotal;
      if (target != null && collectedCount() >= target) {
        return {
          pages,
          reportedTotal: target || reportedTotal,
          namedPlatforms,
          nestedAcc,
          lastRaw,
          pagesFetched,
          pageSize,
        };
      }
    }

    if (
      (seedPage.totalPages && 1 >= seedPage.totalPages)
      || (reportedTotal != null && collectedCount() >= reportedTotal)
      || seedPage.pageCount === 0
    ) {
      return {
        pages,
        reportedTotal,
        namedPlatforms,
        nestedAcc,
        lastRaw,
        pagesFetched,
        pageSize,
      };
    }
    // Intentionally do NOT stop on a short first page without pagination meta —
    // that was truncating catalogs to a handful of services.
    startPage = 2;
  }

  // Ensure we have page 1 before batching the rest.
  if (startPage === 1) {
    const first = await fetchPage(1);
    absorb(first.extracted, first.raw, 1);

    if (first.extracted.pageCount === 0) {
      return {
        pages,
        reportedTotal,
        namedPlatforms,
        nestedAcc,
        lastRaw,
        pagesFetched,
        pageSize,
      };
    }

    if (
      first.extracted.nestedPlatforms.length
      && !first.extracted.services.length
      && !first.extracted.totalPages
      && first.extracted.total == null
    ) {
      const target = directoryServiceTarget(namedPlatforms, platform) || expectedTotal;
      if (target != null && collectedCount() >= target) {
        return {
          pages,
          reportedTotal: target || reportedTotal,
          namedPlatforms,
          nestedAcc,
          lastRaw,
          pagesFetched,
          pageSize,
        };
      }
    }

    if (
      (first.extracted.totalPages && 1 >= first.extracted.totalPages)
      || (reportedTotal != null && collectedCount() >= reportedTotal)
    ) {
      return {
        pages,
        reportedTotal,
        namedPlatforms,
        nestedAcc,
        lastRaw,
        pagesFetched,
        pageSize,
      };
    }

    startPage = 2;
  }

  // When totalPages is known, batch-fetch remaining pages in parallel.
  let knownTotalPages = pages[0]?.totalPages || null;
  if (knownTotalPages && knownTotalPages > 1 && startPage <= knownTotalPages) {
    const remaining = [];
    for (let page = startPage; page <= Math.min(knownTotalPages, SMM_MAX_PAGES); page += 1) {
      remaining.push(page);
    }
    const batch = await mapPool(remaining, SMM_CONCURRENCY, async (page) => fetchPage(page));
    batch.sort((a, b) => a.page - b.page);
    for (const item of batch) {
      absorb(item.extracted, item.raw, item.page);
    }
    return {
      pages,
      reportedTotal,
      namedPlatforms,
      nestedAcc,
      lastRaw,
      pagesFetched,
      pageSize,
    };
  }

  // Unknown total pages — keep walking until an empty page or known totals say done.
  // Do not treat "short page" as the end; providers often ignore Hub's large per_page.
  for (let page = startPage; page <= SMM_MAX_PAGES; page += 1) {
    const item = await fetchPage(page);
    if (item.extracted.pageCount === 0) break;
    absorb(item.extracted, item.raw, page);

    const collected = collectedCount();
    knownTotalPages = item.extracted.totalPages || knownTotalPages;

    if (knownTotalPages && page < knownTotalPages) {
      const remaining = [];
      for (let p = page + 1; p <= Math.min(knownTotalPages, SMM_MAX_PAGES); p += 1) {
        remaining.push(p);
      }
      if (remaining.length) {
        const batch = await mapPool(remaining, SMM_CONCURRENCY, async (p) => fetchPage(p));
        batch.sort((a, b) => a.page - b.page);
        for (const b of batch) absorb(b.extracted, b.raw, b.page);
      }
      break;
    }

    if (knownTotalPages && page >= knownTotalPages) break;
    if (reportedTotal != null && collected >= reportedTotal) break;

    // Nested-only response mid-walk: only stop when an authoritative target is met.
    // Without counts, keep requesting the next page until the API returns empty.
    if (
      item.extracted.nestedPlatforms.length
      && !item.extracted.services.length
      && !item.extracted.totalPages
      && item.extracted.total == null
    ) {
      const target = directoryServiceTarget(namedPlatforms, platform) || expectedTotal;
      if (target != null && collected >= target) break;
    }
  }

  return {
    pages,
    reportedTotal,
    namedPlatforms,
    nestedAcc,
    lastRaw,
    pagesFetched,
    pageSize,
  };
}

function packSmmCatalogResult(normalized, {
  lastRaw = null,
  pagesFetched = 0,
  reportedTotal = null,
  directory = [],
} = {}) {
  const platforms = applySmmPlatformDirectory(
    normalized.platforms,
    directory,
    normalized.products
  );
  return {
    ...normalized,
    platforms,
    source: 'live',
    endpoint: '/smm/services',
    raw: lastRaw,
    pages_fetched: pagesFetched,
    page_size: SMM_PAGE_SIZE,
    reported_total: reportedTotal,
    platform_directory: directory,
  };
}

/**
 * Fetch every Social Media service from Kripicard /smm/services.
 *
 * Optimizations:
 * - Eager cache + single-flight for identical filter keys
 * - Batch platform fetches with bounded concurrency
 * - Batch remaining pages once totalPages is known
 */
async function fetchCompleteSmmCatalog(filters = {}) {
  const cacheKey = smmCacheKey(filters);
  const cached = cacheGet(smmCatalogCache, cacheKey);
  if (cached) {
    return { ...cached, cache: 'hit' };
  }

  return withSingleFlight(smmInflight, cacheKey, async () => {
    const value = await fetchCompleteSmmCatalogUncached(filters);
    // Never cache empty / truncated-looking catalogs — keeps Hub from sticking on
    // a handful of starter rows after a partial upstream response.
    if (asArray(value?.products).length > 0) {
      cacheSet(smmCatalogCache, cacheKey, value, SMM_CACHE_TTL_MS);
    }
    return { ...value, cache: 'miss' };
  });
}

/**
 * Platforms that still need a full /smm/services walk because the nested probe
 * is missing them or reports fewer services than the API directory count.
 */
function smmPlatformsNeedingRefetch(directory, nestedPlatforms, {
  hasAuthoritativeCounts = false,
} = {}) {
  const nested = asArray(nestedPlatforms);
  const nestedKeys = new Set(
    nested.map((p) => slugKey(pick(p.key, p.name, p.id)))
  );
  const names = [];
  const seen = new Set();
  const push = (name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const key = slugKey(trimmed);
    if (seen.has(key)) return;
    seen.add(key);
    names.push(trimmed);
  };

  for (const entry of asArray(directory)) {
    const name = pick(entry.name, entry.key, entry.id);
    const key = slugKey(name);
    if (!key) continue;
    const nestedCount = nestedCountForPlatformKey(nested, key);
    const dirCount = Number(entry.count) || 0;
    if (!nestedKeys.has(key)) {
      push(name);
      continue;
    }
    if (hasAuthoritativeCounts && dirCount > nestedCount) {
      push(name);
    }
  }

  // No trustworthy directory totals: nested probes are often a truncated sample
  // (one Max/Refill variant per platform). Re-fetch every platform completely.
  if (!hasAuthoritativeCounts) {
    for (const p of nested) push(pick(p.name, p.key, p.id));
    for (const entry of asArray(directory)) push(pick(entry.name, entry.key, entry.id));
  }

  // Sparse nested trees (≈1–2 services/platform across many platforms) almost
  // always mean the probe omitted Max/Refill/quantity variations.
  const nestedTotal = countNestedSmmServices(nested);
  if (nested.length >= 3 && nestedTotal > 0 && nestedTotal <= nested.length * 2) {
    for (const p of nested) push(pick(p.name, p.key, p.id));
  }

  return names;
}

async function fetchCompleteSmmCatalogUncached(filters = {}) {
  const search = filters.search || null;
  const platformFilter = filters.platform && filters.platform !== ALL_KEY
    ? String(filters.platform)
    : null;

  const probeBody = {};
  if (platformFilter) probeBody.platform = platformFilter;
  if (search) probeBody.search = search;

  // Probe without page params first — matches Kripicard's own catalog bootstrap
  // and often returns the full nested platform → groups → services tree.
  const probeRaw = await hubRequest('/smm/services', { body: probeBody });
  const probe = extractSmmPage(probeRaw);

  // Prefer API-reported platform counts (named directory or nested `count` fields)
  // over counts derived from whatever services happened to be in the probe tree.
  const nestedDirectoryHints = probe.nestedPlatforms.map((p) => {
    const nestedCount = countNestedSmmServices([p]);
    const apiCount = Number(p.count) || 0;
    return {
      name: pick(p.name, p.key, p.id),
      key: slugKey(pick(p.key, p.name, p.id)),
      count: Math.max(apiCount, nestedCount),
      apiCount,
      nestedCount,
    };
  });
  const hasAuthoritativeCounts = (
    asArray(probe.namedPlatforms).some((p) => Number(p.count) > 0)
    || nestedDirectoryHints.some((p) => p.apiCount > p.nestedCount)
  );

  let directory = mergeNamedSmmPlatforms(
    probe.namedPlatforms,
    nestedDirectoryHints.map((p) => ({
      name: p.name,
      key: p.key,
      count: p.count,
    }))
  );

  const absorbPlatformResults = (extras, {
    pages,
    pagesFetched,
    lastRaw,
    reportedTotal,
  }) => {
    let nextPages = pages;
    let nextFetched = pagesFetched;
    let nextRaw = lastRaw;
    let nextTotal = reportedTotal;
    let nextDirectory = directory;
    for (const extra of extras) {
      if (!extra) continue;
      nextPages = nextPages.concat(extra.pages);
      nextFetched += extra.pagesFetched;
      nextRaw = extra.lastRaw || nextRaw;
      nextDirectory = mergeNamedSmmPlatforms(nextDirectory, extra.namedPlatforms);
      if (extra.reportedTotal != null) {
        nextTotal = (nextTotal || 0) + extra.reportedTotal;
      }
    }
    directory = nextDirectory;
    return {
      pages: nextPages,
      pagesFetched: nextFetched,
      lastRaw: nextRaw,
      reportedTotal: nextTotal,
    };
  };

  // Nested tree present: keep it as a seed, then batch-refetch any incomplete
  // or missing platforms so Max/Refill/quantity variants are not dropped.
  if (probe.nestedPlatforms.length && countNestedSmmServices(probe.nestedPlatforms) > 0) {
    const refetchNames = platformFilter
      ? smmPlatformsNeedingRefetch(
        directory.filter((p) => slugKey(p.name) === slugKey(platformFilter)
          || slugKey(p.key) === slugKey(platformFilter)),
        probe.nestedPlatforms,
        { hasAuthoritativeCounts }
      )
      : smmPlatformsNeedingRefetch(directory, probe.nestedPlatforms, {
        hasAuthoritativeCounts,
      });

    // Single-platform filter with a complete nested dump — no refetch needed.
    if (!refetchNames.length) {
      const combined = combineSmmPages([probe], {
        reportedTotal: probe.total,
        namedPlatforms: directory,
      });
      return packSmmCatalogResult(normalizeSmmCatalog(combined, filters), {
        lastRaw: probeRaw,
        pagesFetched: 1,
        reportedTotal: probe.total,
        directory,
      });
    }

    const extras = await mapPool(refetchNames, SMM_CONCURRENCY, (platName) => (
      paginateSmmServices({
        platform: platName,
        search,
        expectedTotal: directoryServiceTarget(directory, platName),
      })
    ));
    const merged = absorbPlatformResults(extras, {
      pages: [probe],
      pagesFetched: 1,
      lastRaw: probeRaw,
      reportedTotal: probe.total,
    });
    const combined = combineSmmPages(merged.pages, {
      reportedTotal: merged.reportedTotal,
      namedPlatforms: directory,
    });
    return packSmmCatalogResult(normalizeSmmCatalog(combined, filters), {
      lastRaw: merged.lastRaw,
      pagesFetched: merged.pagesFetched,
      reportedTotal: merged.reportedTotal,
      directory,
    });
  }

  // Named platform directory on a flat catalog: batch-fetch every platform.
  if (!platformFilter && directory.length > 1) {
    const platNames = directory
      .map((p) => String(p.name || p.key || '').trim())
      .filter(Boolean);
    const extras = await mapPool(platNames, SMM_CONCURRENCY, (platName) => (
      paginateSmmServices({ platform: platName, search })
    ));
    const merged = absorbPlatformResults(extras, {
      pages: [],
      pagesFetched: 0,
      lastRaw: probeRaw,
      reportedTotal: 0,
    });
    const combined = combineSmmPages(merged.pages, {
      reportedTotal: merged.reportedTotal || null,
      namedPlatforms: directory,
    });
    return packSmmCatalogResult(normalizeSmmCatalog(combined, filters), {
      lastRaw: merged.lastRaw,
      pagesFetched: merged.pagesFetched,
      reportedTotal: merged.reportedTotal || null,
      directory,
    });
  }

  // Single-platform filter or unknown directory — walk pages (reuse probe as page 1).
  const walked = await paginateSmmServices({
    platform: platformFilter,
    search,
    seedPage: probe,
    seedRaw: probeRaw,
  });
  directory = mergeNamedSmmPlatforms(directory, walked.namedPlatforms);
  const combined = combineSmmPages(walked.pages, {
    reportedTotal: walked.reportedTotal,
    namedPlatforms: directory,
  });
  return packSmmCatalogResult(normalizeSmmCatalog(combined, filters), {
    lastRaw: walked.lastRaw,
    pagesFetched: walked.pagesFetched,
    reportedTotal: walked.reportedTotal,
    directory,
  });
}

function emptyCategoryBucket() {
  return {
    sms: [],
    sim_topup: [],
    esim: [],
    gift_cards: [],
    social_media: [],
    proxies: [],
  };
}

/**
 * Fetch Kripicard's single main /services catalog and map into Hub categories.
 */
async function fetchMainServicesCatalog({
  categoryId = null,
  platform = null,
  search = null,
  page = null,
  perPage = null,
  number = null,
  country = null,
  force = false,
} = {}) {
  if (!isApiConfigured()) {
    const err = new Error('KRIPICARD_API_KEY is not configured');
    err.code = 'KRIPICARD_NOT_CONFIGURED';
    throw err;
  }

  const cacheable = !platform && !search && !number && !country && !categoryId;
  if (!force && cacheable && mainCatalogCache && mainCatalogCache.expires > Date.now()) {
    return {
      byCategory: mainCatalogCache.byCategory,
      raw: mainCatalogCache.raw,
      source: 'live',
      cached: true,
    };
  }

  const body = {};
  if (categoryId && HUB_TO_KRIPICARD_CATEGORY[categoryId]) {
    body.category = HUB_TO_KRIPICARD_CATEGORY[categoryId];
    body.module = body.category;
    body.type = body.category;
  }
  if (platform && platform !== ALL_KEY) body.platform = platform;
  if (search) body.search = search;
  if (page) body.page = page;
  if (perPage) body.per_page = perPage;
  if (number) body.number = String(number).replace(/\D/g, '');
  if (country) {
    body.country = country;
    body.countryCode = country;
    body.countryIso = String(country).includes('|') ? String(country).split('|')[1] : country;
  }

  const path = getMainServicesPath();
  let raw;
  try {
    raw = await hubRequest(path, { body });
  } catch (err) {
    // Some gateways expose the catalog only as /services/list
    if (Number(err.status) === 404 && path === DEFAULT_SERVICES_PATH) {
      raw = await hubRequest('/services/list', { body });
    } else {
      throw err;
    }
  }

  let byCategory = mapMainServicesToHubCategories(raw, {
    defaultCategoryId: categoryId || null,
  });

  // If filtered request returned a module-shaped list without category tags, map with default.
  const totalMapped = Object.values(byCategory).reduce((n, arr) => n + arr.length, 0);
  if (totalMapped === 0 && categoryId) {
    byCategory = mapMainServicesToHubCategories(raw, { defaultCategoryId: categoryId });
  }

  if (cacheable) {
    mainCatalogCache = {
      expires: Date.now() + MAIN_CATALOG_TTL_MS,
      byCategory,
      raw,
    };
  }

  return {
    byCategory,
    raw,
    source: 'live',
    cached: false,
  };
}

/** Resolve a UI platform/country chip or ISO string into a 2-letter country code. */
function resolveCountryIsoFilter(value) {
  if (value == null || value === '' || value === ALL_KEY) return null;
  const raw = String(value).trim();
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  const byCode = KRIPICARD_COUNTRIES.by_code?.[raw]
    || KRIPICARD_COUNTRIES.by_code?.[raw.toUpperCase()]
    || KRIPICARD_COUNTRIES.by_code?.[raw.toLowerCase()];
  if (byCode?.code) return String(byCode.code).toUpperCase();
  const byName = Object.values(KRIPICARD_COUNTRIES.by_id || {}).find((c) => (
    slugKey(c.name) === slugKey(raw)
  ));
  if (byName?.code) return String(byName.code).toUpperCase();
  // "United States" style labels / "US|…" compounds
  if (raw.includes('|')) {
    const part = raw.split('|').pop();
    if (part && /^[A-Za-z]{2}$/.test(part.trim())) return part.trim().toUpperCase();
  }
  return raw.slice(0, 2).toUpperCase();
}

function smsDetailRows(detailsRaw) {
  const data = unwrapData(detailsRaw);
  if (Array.isArray(data)) return data;
  if (Array.isArray(detailsRaw)) return detailsRaw;
  return asArray(
    data?.countries
      || data?.prices
      || data?.services
      || data?.items
      || data?.results
      || data?.rows
      || detailsRaw?.countries
      || detailsRaw?.prices
  );
}

/**
 * Documented per-module catalogs — primary live source for each Hub category.
 * Eager module cache + single-flight avoid duplicate upstream work.
 */
async function fetchModuleCatalog(categoryId, filters = {}) {
  const cacheKey = moduleCacheKey(categoryId, filters);
  const cached = cacheGet(moduleCatalogCache, cacheKey);
  if (cached) {
    return { ...cached, cache: 'hit' };
  }
  return withSingleFlight(moduleInflight, cacheKey, async () => {
    const value = await fetchModuleCatalogUncached(categoryId, filters);
    if (asArray(value?.products).length > 0) {
      cacheSet(moduleCatalogCache, cacheKey, value, MODULE_CACHE_TTL_MS);
    }
    return { ...value, cache: 'miss' };
  });
}

async function fetchModuleCatalogUncached(categoryId, filters = {}) {
  const kc = HUB_TO_KRIPICARD_CATEGORY[categoryId];
  if (!kc) {
    const err = new Error(`No Kripicard module for ${categoryId}`);
    err.code = 'HUB_LIVE_CATEGORY_UNSUPPORTED';
    throw err;
  }

  if (categoryId === 'social_media') {
    // Always walk every /smm/services page — Hub must show the full platform/package list.
    // Client page/per_page filters are ignored so a default API page size cannot truncate the catalog.
    return fetchCompleteSmmCatalog(filters);
  }

  if (categoryId === 'sms') {
    const servicesRaw = await hubRequest('/sms/services', { body: {} });
    const services = listFromCatalogPayload(servicesRaw, ['sms']);
    const serviceById = new Map();
    for (const s of services) {
      const sid = String(pick(s.id, s.service_id, s.serviceId, ''));
      if (sid) serviceById.set(sid, s);
      if (s.code) serviceById.set(String(s.code).toLowerCase(), s);
      if (s.name) serviceById.set(slugKey(s.name), s);
    }
    const platformFilter = filters.platform && filters.platform !== ALL_KEY
      ? String(filters.platform)
      : null;
    let focusList = services;
    if (platformFilter) {
      const matched = services.filter((s) => (
        String(pick(s.id, s.code, s.name)) === platformFilter
        || slugKey(s.name) === slugKey(platformFilter)
        || slugKey(pickDisplayName(s.name)) === slugKey(platformFilter)
        || String(s.name || '').toLowerCase() === platformFilter.toLowerCase()
      ));
      if (matched.length) focusList = matched;
    }

    const products = [];
    // Prefer priced service rows directly when the list already includes rates.
    for (const focus of services) {
      const directPrice = money(pick(focus.price_usd, focus.priceUsd, focus.price, focus.rate_usd));
      if (directPrice == null) continue;
      const serviceId = pick(focus.id, focus.service_id, focus.serviceId, focus.code);
      const platformName = pickDisplayName(focus.name, focus.title, focus.code) || 'SMS';
      const countryName = pickDisplayName(
        focus.country_name,
        resolveCountryName(focus.country_id || focus.country),
        focus.country,
        'Global'
      ) || 'Global';
      const normalized = normalizeServiceProduct({
        ...focus,
        product_id: pick(focus.product_id, `sms-${serviceId}-${slugKey(countryName)}`),
        name: `${platformName} · ${countryName}`,
        price_usd: directPrice,
        platform: platformName,
        category: countryName,
        country_name: countryName,
      }, {
        categoryId: 'sms',
        platform: platformName,
        subcategory: countryName,
      });
      if (normalized) products.push(normalized);
    }

    // Expand every SMS service into country/price rows — no hard cap (the old
    // slice(12) truncated the catalog to a handful of platforms).
    const detailProducts = await mapPool(focusList, SMS_DETAIL_CONCURRENCY, async (focus) => {
      const serviceId = pick(focus.id, focus.service_id, focus.serviceId);
      if (serviceId == null) return [];
      const serviceName = pickDisplayName(focus.name, focus.title, focus.code) || 'SMS';
      let detailsRaw = null;
      try {
        detailsRaw = await hubRequest('/sms/services/details', {
          body: { service_id: serviceId },
        });
      } catch {
        detailsRaw = await hubRequest('/sms/prices', { body: { service_id: serviceId } }).catch(() => null);
      }
      if (!detailsRaw) return [];
      const rows = [];
      for (const row of smsDetailRows(detailsRaw)) {
        const countryId = pick(row.country_id, row.countryId, row.country, row.id, '0');
        const countryName = pickDisplayName(
          row.country_name,
          row.countryName,
          row.country,
          row.name,
          resolveCountryName(countryId)
        ) || resolveCountryName(countryId) || `Country ${countryId}`;
        const linkedService = serviceById.get(String(pick(row.service_id, row.serviceId, serviceId))) || focus;
        const platformName = pickDisplayName(linkedService.name, linkedService.title, serviceName) || serviceName;
        const normalized = normalizeServiceProduct({
          ...row,
          product_id: `sms-${serviceId}-${countryId}`,
          name: `${platformName} · ${countryName}`,
          description: `${platformName} SMS verification · ${countryName}`,
          price_usd: pick(row.price_usd, row.priceUsd, row.price, row.rate_usd, row.cost),
          platform: platformName,
          category: countryName,
          service_id: serviceId,
          service_name: platformName,
          country_id: countryId,
          country_name: countryName,
        }, {
          categoryId: 'sms',
          platform: platformName,
          subcategory: countryName,
        });
        if (normalized) rows.push(normalized);
      }
      return rows;
    });
    for (const batch of detailProducts) {
      for (const row of asArray(batch)) products.push(row);
    }

    // Deduplicate by product_id (direct rows + detail rows may overlap).
    const deduped = [];
    const seen = new Set();
    for (const p of products) {
      if (!p?.product_id || seen.has(p.product_id)) continue;
      seen.add(p.product_id);
      deduped.push(p);
    }

    return {
      ...buildFilterMeta(deduped, filters),
      source: 'live',
      endpoint: '/sms/services',
      raw: servicesRaw,
      count: deduped.length,
      enabled: true,
    };
  }

  if (categoryId === 'esim') {
    const body = {};
    const countryIso = resolveCountryIsoFilter(filters.country)
      || resolveCountryIsoFilter(filters.platform);
    if (countryIso) body.country = countryIso;
    if (filters.search) body.search = filters.search;
    if (filters.page) body.page = filters.page;
    if (filters.per_page) body.per_page = filters.per_page;
    const raw = await hubRequest('/esim/packages', { body });
    const packages = listFromCatalogPayload(raw);
    const products = packages.map((pkg) => {
      const iso = String(pick(
        pkg.countryCode,
        pkg.country_iso,
        pkg.countryIso,
        pkg.locationCode,
        typeof pkg.country === 'string' && pkg.country.length === 2 ? pkg.country : null,
        body.country,
        'GL'
      )).toUpperCase();
      const countryLabel = pickDisplayName(
        pkg.country_name,
        pkg.countryName,
        typeof pkg.country === 'string' && pkg.country.length > 2 ? pkg.country : null,
        resolveCountryName(iso),
        iso
      ) || iso;
      const dataLabel = pickDisplayName(
        pkg.data,
        pkg.volume,
        pkg.duration,
        pkg.validity != null && !String(pkg.validity).includes('day')
          ? `${pkg.validity} days`
          : pkg.validity,
        'Data'
      ) || 'Data';
      return normalizeServiceProduct({
        ...pkg,
        product_id: pick(pkg.product_id, pkg.packageCode, pkg.package_code, pkg.id),
        name: pickDisplayName(
          pkg.name,
          pkg.packageName,
          pkg.package_name,
          `${countryLabel} · ${dataLabel}`
        ),
        price_usd: pick(pkg.price_usd, pkg.priceUsd, pkg.price, pkg.usd_price, pkg.usdPrice),
        platform: countryLabel,
        category: dataLabel,
        country_iso: iso,
        country_name: countryLabel,
      }, {
        categoryId: 'esim',
        platform: countryLabel,
        subcategory: dataLabel,
      });
    }).filter(Boolean);
    const needsCountry = !products.length && !countryIso;
    return {
      ...buildFilterMeta(products, filters),
      source: 'live',
      endpoint: '/esim/packages',
      raw,
      count: products.length,
      enabled: true,
      requires_input: needsCountry ? ['country'] : null,
      message: products.length
        ? null
        : (needsCountry
          ? 'Enter a country ISO (e.g. US) to load eSIM packages from Kripicard.'
          : 'No eSIM packages returned for this country.'),
    };
  }

  if (categoryId === 'gift_cards') {
    const body = {};
    const countryIso = resolveCountryIsoFilter(filters.country)
      || resolveCountryIsoFilter(filters.platform);
    if (countryIso) body.country = countryIso;
    if (filters.search) body.search = filters.search;
    if (filters.page) body.page = filters.page;
    if (filters.per_page) body.per_page = filters.per_page;
    const raw = await hubRequest('/gifts/packages', { body });
    const giftRows = listFromCatalogPayload(raw, ['giftcards']);
    // Also accept top-level giftcards when unwrapData returns the envelope.
    const topLevel = asArray(raw?.giftcards);
    const products = expandGiftCardProducts(
      giftRows.length ? giftRows : topLevel,
      'gift_cards'
    );
    const countriesMap = unwrapData(raw)?.countries || raw?.countries || null;
    const meta = buildFilterMeta(products, filters);
    if (countriesMap && typeof countriesMap === 'object' && !Array.isArray(countriesMap)) {
      const fromMap = Object.entries(countriesMap).map(([code, name]) => ({
        key: slugKey(resolveCountryName(code) || name || code),
        name: String(name || resolveCountryName(code) || code),
        count: products.filter((p) => (
          slugKey(p.platform) === slugKey(name)
          || String(p.raw?.country_iso || '').toUpperCase() === String(code).toUpperCase()
        )).length,
      })).filter((c) => c.count > 0 || !products.length);
      if (fromMap.length) {
        meta.platforms = [
          { key: ALL_KEY, name: 'All platforms', count: products.length },
          ...fromMap.sort((a, b) => a.name.localeCompare(b.name)),
        ];
      }
    }
    const needsCountry = !products.length && !countryIso && !filters.search;
    return {
      ...meta,
      source: 'live',
      endpoint: '/gifts/packages',
      raw,
      count: products.length,
      enabled: true,
      requires_input: needsCountry ? ['country'] : null,
      message: products.length
        ? null
        : (needsCountry
          ? 'Enter a country ISO or search to load gift cards from Kripicard.'
          : 'No gift cards returned for these filters.'),
    };
  }

  if (categoryId === 'sim_topup') {
    if (!filters.number || !(filters.country || (filters.platform && filters.platform !== ALL_KEY))) {
      return {
        ...buildFilterMeta([], filters),
        source: 'live',
        endpoint: '/sim/packages',
        requires_input: ['country', 'number'],
        message: 'Enter a country ISO and phone number to load SIM top-up packages from Kripicard.',
        count: 0,
        enabled: true,
        raw: null,
      };
    }
    const country = resolveCountryIsoFilter(filters.country)
      || resolveCountryIsoFilter(filters.platform)
      || String(filters.country || filters.platform);
    const raw = await hubRequest('/sim/packages', {
      body: {
        number: String(filters.number).replace(/\D/g, ''),
        countryCode: country,
        country,
      },
    });
    const rows = listFromCatalogPayload(raw, ['operators', 'sim']);
    const products = expandSimOperatorRows(
      rows.length ? rows : asArray(unwrapData(raw)),
      'sim_topup'
    );
    return {
      ...buildFilterMeta(products, filters),
      source: 'live',
      endpoint: '/sim/packages',
      raw,
      count: products.length,
      enabled: true,
    };
  }

  if (categoryId === 'proxies') {
    let raw = null;
    let endpoint = '/proxies/types';
    const paths = ['/proxies/types', '/proxies/packages', '/proxies/plans', '/proxies/pricing'];
    let lastErr = null;
    for (const path of paths) {
      try {
        raw = await hubRequest(path, { body: {} });
        endpoint = path;
        break;
      } catch (err) {
        lastErr = err;
        if (![404, 405].includes(Number(err.status))) throw err;
      }
    }
    if (!raw) {
      if (lastErr) throw lastErr;
      const err = new Error('No Kripicard proxies endpoint available');
      err.code = 'HUB_LIVE_CATEGORY_UNSUPPORTED';
      throw err;
    }
    const data = unwrapData(raw);
    let products = expandProxyFamilies(data, 'proxies');
    if (!products.length) {
      products = expandProxyFamilies(raw, 'proxies');
    }
    return {
      ...buildFilterMeta(products, filters),
      source: 'live',
      endpoint,
      raw,
      count: products.length,
      enabled: true,
      message: products.length
        ? null
        : 'Proxy types loaded but no priced plans were returned by Kripicard.',
    };
  }

  const err = new Error(`No module catalog for ${categoryId}`);
  err.code = 'HUB_LIVE_CATEGORY_UNSUPPORTED';
  throw err;
}

/** @deprecated alias — module catalogs are now primary */
async function fetchModuleFallback(categoryId, filters = {}) {
  return fetchModuleCatalog(categoryId, filters);
}

/**
 * Live catalog for one Hub category — module routes first (SMS/eSIM/gifts/…),
 * then aggregate /services when the module returns no priced rows.
 */
async function fetchLiveHubCatalog(categoryId, filters = {}) {
  if (!isApiConfigured()) {
    const err = new Error('KRIPICARD_API_KEY is not configured');
    err.code = 'KRIPICARD_NOT_CONFIGURED';
    throw err;
  }

  const id = String(categoryId || '');
  if (!HUB_TO_KRIPICARD_CATEGORY[id]) {
    const err = new Error(`No live Kripicard catalog mapper for ${categoryId}`);
    err.code = 'HUB_LIVE_CATEGORY_UNSUPPORTED';
    throw err;
  }

  let moduleError = null;
  try {
    const moduleCatalog = await fetchModuleCatalog(id, filters);
    const products = asArray(moduleCatalog.products);
    // Accept empty catalogs that intentionally need user input (SIM / gated eSIM).
    if (products.length || moduleCatalog.requires_input) {
      if (filters.search && products.length) {
        const q = String(filters.search).trim().toLowerCase();
        const filtered = products.filter((p) => (
          p.name.toLowerCase().includes(q)
          || (p.description || '').toLowerCase().includes(q)
          || (p.platform || '').toLowerCase().includes(q)
          || (p.subcategory || '').toLowerCase().includes(q)
        ));
        if (filtered.length !== products.length) {
          return {
            ...moduleCatalog,
            ...buildFilterMeta(filtered, {
              platform: filters.platform,
              subcategory: filters.subcategory,
            }),
            count: filtered.length,
          };
        }
      }
      return moduleCatalog;
    }
  } catch (err) {
    moduleError = err;
  }

  // Secondary: aggregate /services mapped into Hub categories.
  try {
    const main = await fetchMainServicesCatalog({
      categoryId: id,
      platform: filters.platform,
      search: filters.search,
      page: filters.page,
      perPage: filters.per_page,
      number: filters.number,
      country: filters.country,
    });
    let products = asArray(main.byCategory[id]);

    if (!products.length && mainCatalogCache?.byCategory?.[id]?.length) {
      products = mainCatalogCache.byCategory[id];
    }

    if (products.length) {
      if (filters.search) {
        const q = String(filters.search).trim().toLowerCase();
        products = products.filter((p) => (
          p.name.toLowerCase().includes(q)
          || (p.description || '').toLowerCase().includes(q)
          || (p.platform || '').toLowerCase().includes(q)
          || (p.subcategory || '').toLowerCase().includes(q)
        ));
      }
      const meta = buildFilterMeta(products, {
        platform: filters.platform,
        subcategory: filters.subcategory,
      });
      return {
        ...meta,
        source: 'live',
        endpoint: getMainServicesPath(),
        enabled: true,
        count: products.length,
        raw: main.raw,
        module_error: moduleError ? {
          code: moduleError.code || 'KRIPICARD_MODULE_FAILED',
          message: moduleError.message,
        } : null,
      };
    }
  } catch (mainError) {
    if (moduleError) throw moduleError;
    throw mainError;
  }

  if (moduleError) throw moduleError;

  return {
    ...buildFilterMeta([], filters),
    source: 'live',
    endpoint: HUB_TO_KRIPICARD_CATEGORY[id],
    enabled: true,
    count: 0,
    products: [],
    message: 'No services returned from Kripicard for this category.',
  };
}

/** Test helper — clear the short-lived main / SMM / module catalog caches. */
function clearMainCatalogCache() {
  mainCatalogCache = null;
  smmCatalogCache.clear();
  smmInflight.clear();
  moduleCatalogCache.clear();
  moduleInflight.clear();
}

module.exports = {
  ALL_KEY,
  DEFAULT_EXTERNAL_BASE,
  DEFAULT_SERVICES_PATH,
  KRIPICARD_MODULE_TO_HUB,
  HUB_TO_KRIPICARD_CATEGORY,
  getHubApiBase,
  getMainServicesPath,
  isApiConfigured,
  hubRequest,
  fetchMainServicesCatalog,
  fetchLiveHubCatalog,
  fetchModuleCatalog,
  fetchModuleFallback,
  fetchCompleteSmmCatalog,
  mapMainServicesToHubCategories,
  normalizeSmmCatalog,
  normalizeServiceProduct,
  buildFilterMeta,
  enrichDisplayLabels,
  expandSimOperatorRows,
  expandProxyFamilies,
  expandGiftCardProducts,
  listFromCatalogPayload,
  extractSmmPage,
  mergeSmmNestedPlatforms,
  mergeNamedSmmPlatforms,
  applySmmPlatformDirectory,
  inferSmmPlatformLabel,
  combineSmmPages,
  countNestedSmmServices,
  resolveHubCategory,
  resolveCountryName,
  resolveCountryIsoFilter,
  pickDisplayName,
  isNumericId,
  clearMainCatalogCache,
  slugKey,
  emptyCategoryBucket,
  mapPool,
  directoryServiceTarget,
  nestedCountForPlatformKey,
  smmPlatformsNeedingRefetch,
  SMM_PAGE_SIZE,
  SMM_MAX_PAGES,
  SMM_CONCURRENCY,
  SMM_CACHE_TTL_MS,
  MODULE_CACHE_TTL_MS,
  SMS_DETAIL_CONCURRENCY,
};
