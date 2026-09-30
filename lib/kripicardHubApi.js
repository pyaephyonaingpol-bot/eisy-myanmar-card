/**
 * Kripicard Hub catalog client.
 *
 * Single main endpoint (partner external API):
 *   POST https://appapi.kripicard.com/api/external/services
 *   Body: { api_key, category?, platform?, search?, page?, … }
 *
 * The response is parsed once and mapped into Hub categories:
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

  const pricingModel = String(
    pick(raw.pricing_model, raw.pricingModel, 'package') || 'package'
  ).toLowerCase();

  let priceUsd = money(pick(
    raw.price_usd,
    raw.priceUsd,
    raw.usd_price,
    raw.usdPrice,
    raw.rate_usd,
    raw.rateUsd,
    raw.unit_usd,
    raw.unitUsd,
    raw.min_price_usd,
    raw.minPriceUsd,
    raw.charge_usd,
    raw.price,
    raw.cost
  ));

  // Gift cards often expose local denominations only — use first fixed amount as display price when USD missing.
  if ((priceUsd == null || priceUsd <= 0) && Array.isArray(raw.fixed_denominations) && raw.fixed_denominations.length) {
    const local = Number(raw.fixed_denominations[0]);
    if (Number.isFinite(local) && local > 0 && String(raw.currency || '').toUpperCase() === 'USD') {
      priceUsd = money(local);
    }
  }
  if ((priceUsd == null || priceUsd <= 0) && raw.min_amount != null && String(raw.currency || '').toUpperCase() === 'USD') {
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

  const platformLabel = pickDisplayName(
    platform,
    raw.platform_name,
    raw.platformName,
    raw.platform,
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
  ) || 'General';

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

  const description = String(pick(
    raw.description,
    raw.desc,
    asArray(raw.features).slice(0, 4).join(' · ') || null,
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
    min_quantity: Number(pick(raw.min, raw.min_quantity, raw.minQuantity, 1)) || 1,
    max_quantity: raw.max != null || raw.max_quantity != null
      ? Number(pick(raw.max, raw.max_quantity, raw.maxQuantity))
      : null,
    category_id: categoryId || null,
    features: asArray(raw.features).map(String).filter(Boolean),
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
 * Expand proxy families { static:[], pool:[] } into browseable products.
 */
function expandProxyFamilies(data, categoryId = 'proxies') {
  const products = [];
  const families = data?.families && typeof data.families === 'object' ? data.families : data;
  for (const family of ['static', 'pool']) {
    for (const item of asArray(families?.[family])) {
      const type = pick(item.type, item.id, item.key, item.name);
      const label = pick(item.label, item.name, type);
      const price = money(pick(item.min_price_usd, item.price_usd, item.price));
      if (price == null) {
        // Type shells without price still help platform chips; skip product rows.
        continue;
      }
      const normalized = normalizeServiceProduct({
        ...item,
        product_id: `proxy-${family}-${type}`,
        name: label,
        price_usd: price,
        platform: type,
        category: family,
      }, { categoryId, platform: String(type), subcategory: family });
      if (normalized) products.push(normalized);
    }
  }
  return products;
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
      if (hubId === 'proxies' && bucket?.families) {
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

/** Normalize documented SMM flat list (also used when /services returns smm-only). */
function normalizeSmmCatalog(raw, filters = {}) {
  const data = unwrapData(raw);
  const products = [];

  const nestedPlatforms = asArray(data.platforms).filter((p) => p && typeof p === 'object' && p.groups);
  if (nestedPlatforms.length) {
    for (const plat of nestedPlatforms) {
      const platformName = pick(plat.name, plat.key, plat.id, 'Platform');
      for (const group of asArray(plat.groups)) {
        const groupName = pick(group.name, group.title, group.key, 'General');
        for (const svc of asArray(group.services)) {
          const normalized = normalizeServiceProduct(
            { ...svc, platform: platformName, category: groupName },
            { platform: platformName, subcategory: groupName, categoryId: 'social_media' }
          );
          if (normalized) products.push(normalized);
        }
      }
    }
  } else {
    for (const svc of asArray(data.services || data.items || data.results)) {
      const normalized = normalizeServiceProduct(svc, {
        categoryId: 'social_media',
        platform: svc.platform,
        subcategory: pick(svc.category, svc.group, svc.type),
      });
      if (normalized) products.push(normalized);
    }
  }

  // Prefer explicit platforms[{name,count}] labels when present
  const meta = buildFilterMeta(products, filters);
  const namedPlatforms = asArray(data.platforms).filter((p) => p && typeof p === 'object' && p.name && !p.groups);
  if (namedPlatforms.length) {
    meta.platforms = [
      { key: ALL_KEY, name: 'All platforms', count: products.length },
      ...namedPlatforms.map((p) => ({
        key: slugKey(p.name),
        name: String(p.name),
        count: Number(p.count) || products.filter((x) => slugKey(x.platform) === slugKey(p.name)).length,
      })),
    ];
  }
  return {
    enabled: data.enabled !== false,
    count: Number(data.totalItems || data.count) || products.length,
    ...meta,
  };
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

/**
 * Documented module fallbacks — used only when main /services yields no rows
 * for the requested Hub category (keeps Hub usable if the gateway is partial).
 */
async function fetchModuleFallback(categoryId, filters = {}) {
  const kc = HUB_TO_KRIPICARD_CATEGORY[categoryId];
  if (!kc) {
    const err = new Error(`No Kripicard module for ${categoryId}`);
    err.code = 'HUB_LIVE_CATEGORY_UNSUPPORTED';
    throw err;
  }

  if (categoryId === 'social_media') {
    const body = {};
    if (filters.platform && filters.platform !== ALL_KEY) body.platform = filters.platform;
    if (filters.search) body.search = filters.search;
    const raw = await hubRequest('/smm/services', { body });
    const normalized = normalizeSmmCatalog(raw, filters);
    return {
      ...normalized,
      source: 'live',
      endpoint: '/smm/services',
      raw,
    };
  }

  if (categoryId === 'sms') {
    const servicesRaw = await hubRequest('/sms/services', { body: {} });
    const services = asArray(unwrapData(servicesRaw));
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
        || String(s.name || '').toLowerCase() === platformFilter.toLowerCase()
      ));
      if (matched.length) focusList = matched;
    }
    const products = [];
    for (const focus of focusList.slice(0, platformFilter ? 1 : Math.min(services.length, 8))) {
      const serviceId = pick(focus.id, focus.service_id);
      const serviceName = pickDisplayName(focus.name, focus.title, focus.code) || 'SMS';
      let detailsRaw = null;
      try {
        detailsRaw = await hubRequest('/sms/services/details', {
          body: { service_id: serviceId },
        });
      } catch {
        detailsRaw = await hubRequest('/sms/prices', { body: { service_id: serviceId } }).catch(() => null);
      }
      for (const row of asArray(unwrapData(detailsRaw))) {
        const countryId = pick(row.country_id, row.countryId, row.id, '0');
        const countryName = pickDisplayName(
          row.country_name,
          row.countryName,
          row.country,
          row.name,
          resolveCountryName(countryId)
        ) || `Country ${countryId}`;
        const linkedService = serviceById.get(String(pick(row.service_id, row.serviceId, serviceId))) || focus;
        const platformName = pickDisplayName(linkedService.name, linkedService.title, serviceName) || serviceName;
        const normalized = normalizeServiceProduct({
          ...row,
          product_id: `sms-${serviceId}-${countryId}`,
          name: `${platformName} · ${countryName}`,
          description: `${platformName} SMS verification · ${countryName}`,
          price_usd: pick(row.price_usd, row.priceUsd, row.price),
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
        if (normalized) products.push(normalized);
      }
    }
    return {
      ...buildFilterMeta(products, filters),
      source: 'live',
      endpoint: '/sms/services',
      raw: servicesRaw,
      count: products.length,
      enabled: true,
    };
  }

  if (categoryId === 'esim') {
    const body = {};
    if (filters.platform && filters.platform !== ALL_KEY) {
      // Accept country name or ISO from the UI filter chip.
      const rawPlat = String(filters.platform);
      const byCode = KRIPICARD_COUNTRIES.by_code?.[rawPlat]
        || KRIPICARD_COUNTRIES.by_code?.[rawPlat.toUpperCase()]
        || KRIPICARD_COUNTRIES.by_code?.[rawPlat.toLowerCase()];
      const byName = Object.entries(KRIPICARD_COUNTRIES.by_id || {}).find(([, c]) => (
        slugKey(c.name) === slugKey(rawPlat)
      ));
      body.country = String(
        byCode ? rawPlat.slice(0, 2)
          : (byName ? byName[1].code : rawPlat)
      ).toUpperCase().slice(0, 2);
    } else if (filters.country) {
      body.country = String(filters.country).toUpperCase().slice(0, 2);
    }
    const raw = await hubRequest('/esim/packages', { body });
    const products = asArray(unwrapData(raw)).map((pkg) => {
      const iso = String(pick(pkg.country, pkg.locationCode, body.country, 'GL')).toUpperCase();
      const countryLabel = resolveCountryName(iso) || iso;
      const dataLabel = pickDisplayName(pkg.data, pkg.volume, pkg.validity != null ? `${pkg.validity} days` : null, 'Data');
      return normalizeServiceProduct({
        ...pkg,
        product_id: pick(pkg.product_id, pkg.packageCode, pkg.id),
        name: pickDisplayName(pkg.name, pkg.packageName, `${countryLabel} ${dataLabel}`),
        price_usd: pick(pkg.price_usd, pkg.price, pkg.usd_price),
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
    return {
      ...buildFilterMeta(products, filters),
      source: 'live',
      endpoint: '/esim/packages',
      raw,
      count: products.length,
      enabled: true,
    };
  }

  if (categoryId === 'gift_cards') {
    const body = {};
    if (filters.platform && filters.platform !== ALL_KEY) body.country = filters.platform;
    if (filters.country) body.country = filters.country;
    if (filters.search) body.search = filters.search;
    const raw = await hubRequest('/gifts/packages', { body });
    const data = unwrapData(raw);
    const products = asArray(data.products || data.giftcards || data).map((item) => {
      const country = pick(item.country_iso, item.country, 'US');
      const brand = pick(item.brand, item.brand?.brandName, item.category, 'Gift Card');
      // Prefer USD fields; else first USD denomination; else skip (no invented FX).
      return normalizeServiceProduct({
        ...item,
        product_id: pick(item.product_id, item.productId, item.id),
        name: pick(item.name, item.productName, `${brand} gift card`),
        platform: String(country).toUpperCase(),
        category: String(brand),
        price_usd: pick(item.price_usd, item.usd_price, item.price),
      }, {
        categoryId: 'gift_cards',
        platform: String(country).toUpperCase(),
        subcategory: String(brand),
      });
    }).filter(Boolean);
    return {
      ...buildFilterMeta(products, filters),
      source: 'live',
      endpoint: '/gifts/packages',
      raw,
      count: products.length,
      enabled: true,
    };
  }

  if (categoryId === 'sim_topup') {
    if (!filters.number || !(filters.country || filters.platform)) {
      return {
        ...buildFilterMeta([], filters),
        source: 'live',
        endpoint: '/sim/packages',
        requires_input: ['country', 'number'],
        message: 'Enter a country and phone number to load SIM top-up packages from Kripicard.',
        count: 0,
        enabled: true,
        raw: null,
      };
    }
    const country = String(filters.country || filters.platform);
    const raw = await hubRequest('/sim/packages', {
      body: {
        number: String(filters.number).replace(/\D/g, ''),
        countryCode: country,
      },
    });
    const products = expandSimOperatorRows(unwrapData(raw), 'sim_topup');
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
    const raw = await hubRequest('/proxies/types', { body: {} });
    const products = expandProxyFamilies(unwrapData(raw), 'proxies');
    return {
      ...buildFilterMeta(products, filters),
      source: 'live',
      endpoint: '/proxies/types',
      raw,
      count: products.length,
      enabled: true,
    };
  }

  const err = new Error(`No module fallback for ${categoryId}`);
  err.code = 'HUB_LIVE_CATEGORY_UNSUPPORTED';
  throw err;
}

/**
 * Live catalog for one Hub category — prefers the single main /services
 * endpoint, then maps into the category. Falls back to documented module
 * routes only when the main payload has no rows for that category.
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

  let mainError = null;
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

    // Full unfiltered cache may already hold this category.
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
      };
    }
  } catch (err) {
    mainError = err;
  }

  // Module fallback (documented per-resource routes).
  try {
    const fallback = await fetchModuleFallback(id, filters);
    if (mainError) {
      fallback.main_error = {
        code: mainError.code || 'KRIPICARD_MAIN_SERVICES_FAILED',
        message: mainError.message,
      };
    }
    return fallback;
  } catch (fallbackErr) {
    if (mainError) throw mainError;
    throw fallbackErr;
  }
}

/** Test helper — clear the short-lived main catalog cache. */
function clearMainCatalogCache() {
  mainCatalogCache = null;
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
  fetchModuleFallback,
  mapMainServicesToHubCategories,
  normalizeSmmCatalog,
  normalizeServiceProduct,
  buildFilterMeta,
  enrichDisplayLabels,
  expandSimOperatorRows,
  expandProxyFamilies,
  resolveHubCategory,
  resolveCountryName,
  pickDisplayName,
  isNumericId,
  clearMainCatalogCache,
  slugKey,
  emptyCategoryBucket,
};
