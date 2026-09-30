/**
 * Kripicard Hub catalog client — live fetch from appapi external endpoints.
 *
 * Base: https://appapi.kripicard.com/api/external
 * Auth: api_key query (preferred) + Bearer / X-API-Key headers; POST body fallback.
 *
 * Category endpoint map (matches Kripicard dashboard + partner docs):
 *   social_media → GET /smm/services  (platforms → groups → services)
 *   sms          → GET /sms/services + /sms/prices?service_id=
 *   esim         → GET /esim/packages|list  (country filter)
 *   gift_cards   → GET /gifts/packages|/gift-cards/list
 *   sim_topup    → GET /sim/packages|/topup/detect
 *   proxies      → GET /proxies/types + /proxies/gates + static catalog
 */
'use strict';

const {
  getKripicardConfig,
  kripicardRequest,
} = require('./kripicard');

const DEFAULT_EXTERNAL_BASE = 'https://appapi.kripicard.com/api/external';
const ALL_KEY = '__all__';

function getHubApiBase() {
  return String(
    process.env.KRIPICARD_HUB_API_BASE
      || process.env.KRIPICARD_EXTERNAL_API_BASE
      || DEFAULT_EXTERNAL_BASE
  ).trim().replace(/\/$/, '');
}

function isApiConfigured() {
  const key = String(process.env.KRIPICARD_API_KEY || '').trim();
  return Boolean(key) && !key.includes('...');
}

function pick(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    return value;
  }
  return null;
}

function unwrapData(raw) {
  if (!raw || typeof raw !== 'object') return {};
  if (raw.data != null && typeof raw.data === 'object') return raw.data;
  return raw;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return [];
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
 * GET with api_key query, then POST { api_key, ...body } on auth/route failure.
 */
async function hubRequest(path, {
  method = 'GET',
  query = {},
  body = null,
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

  const url = new URL(`${base}${cleanPath}`);
  url.searchParams.set('api_key', apiKey);
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }

  try {
    if (method === 'GET') {
      return await kripicardRequest(url.toString(), { method: 'GET', timeoutMs: timeout });
    }
    return await kripicardRequest(url.toString(), {
      method,
      body: { api_key: apiKey, ...(body || {}) },
      timeoutMs: timeout,
    });
  } catch (err) {
    const status = Number(err.status) || 0;
    const retryable = method === 'GET' && [401, 403, 404, 405].includes(status);
    if (!retryable) throw err;
    try {
      return await kripicardRequest(`${base}${cleanPath}`, {
        method: 'POST',
        body: { api_key: apiKey, ...(query || {}), ...(body || {}) },
        timeoutMs: timeout,
      });
    } catch (postErr) {
      throw postErr.status ? postErr : err;
    }
  }
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
    raw.service,
    raw.service_id,
    raw.serviceId,
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
    raw.rate_usd,
    raw.rateUsd,
    raw.unit_usd,
    raw.unitUsd,
    raw.retailPriceUsd,
    raw.min_price_usd,
    raw.minPriceUsd,
    raw.cost,
    raw.price
  ));

  // eSIM retail prices sometimes arrive as micro-units (÷10000).
  if (priceUsd == null && raw.retailPrice != null) {
    const retail = Number(raw.retailPrice);
    if (Number.isFinite(retail) && retail > 0) {
      priceUsd = retail > 1000 ? money(retail / 10000) : money(retail);
    }
  }

  if (priceUsd == null || priceUsd <= 0) return null;

  const name = String(pick(
    raw.name,
    raw.productName,
    raw.product_name,
    raw.title,
    raw.service_name,
    raw.serviceName,
    `Service ${productId}`
  ));

  const platformKey = String(pick(
    platform,
    raw.platform,
    raw.platform_key,
    raw.platformKey,
    raw.brand?.brandName,
    raw.country?.isoName,
    raw.country_iso,
    raw.countryIso,
    raw.country,
    raw.type,
    'general'
  ) || 'general');

  const subKey = String(pick(
    subcategory,
    raw.group,
    raw.category,
    raw.category_name,
    raw.subcategory,
    raw.operatorName,
    raw.operator_name,
    raw.duration,
    raw.data,
    ALL_KEY
  ) || ALL_KEY);

  const description = String(pick(
    raw.description,
    raw.desc,
    raw.features && Array.isArray(raw.features) ? raw.features.slice(0, 4).join(' · ') : null,
    [raw.platform || platformKey, raw.group || (subKey !== ALL_KEY ? subKey : null)]
      .filter(Boolean)
      .join(' · '),
    ''
  ) || '');

  return {
    product_id: String(productId),
    name,
    description,
    price_usd: priceUsd,
    platform: platformKey,
    platform_key: slugKey(platformKey),
    subcategory: subKey === ALL_KEY ? null : subKey,
    subcategory_key: subKey === ALL_KEY ? ALL_KEY : slugKey(subKey),
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

function buildFilterMeta(products, { platform = null, subcategory = null } = {}) {
  const platformMap = new Map();
  const subMap = new Map();

  for (const p of products) {
    const pKey = p.platform_key || slugKey(p.platform);
    if (!platformMap.has(pKey)) {
      platformMap.set(pKey, {
        key: pKey,
        name: p.platform || pKey,
        count: 0,
      });
    }
    platformMap.get(pKey).count += 1;

    const sKey = p.subcategory_key || ALL_KEY;
    const sName = p.subcategory || 'All';
    const compound = `${pKey}::${sKey}`;
    if (!subMap.has(compound)) {
      subMap.set(compound, {
        key: sKey,
        name: sName,
        platform_key: pKey,
        count: 0,
      });
    }
    subMap.get(compound).count += 1;
  }

  const platforms = [
    { key: ALL_KEY, name: 'All platforms', count: products.length },
    ...[...platformMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
  ];

  const selectedPlatform = platform && platform !== ALL_KEY ? slugKey(platform) : ALL_KEY;
  let subcategories = [...subMap.values()];
  if (selectedPlatform !== ALL_KEY) {
    subcategories = subcategories.filter((s) => s.platform_key === selectedPlatform);
  }
  const uniqueSubs = new Map();
  for (const s of subcategories) {
    if (!uniqueSubs.has(s.key)) uniqueSubs.set(s.key, { ...s, count: 0 });
    uniqueSubs.get(s.key).count += s.count;
  }
  subcategories = [
    { key: ALL_KEY, name: 'All types', platform_key: selectedPlatform, count: 0 },
    ...[...uniqueSubs.values()]
      .filter((s) => s.key !== ALL_KEY)
      .sort((a, b) => a.name.localeCompare(b.name)),
  ];
  const selectedSub = subcategory && subcategory !== ALL_KEY ? slugKey(subcategory) : ALL_KEY;

  let filtered = products;
  if (selectedPlatform !== ALL_KEY) {
    filtered = filtered.filter((p) => (p.platform_key || slugKey(p.platform)) === selectedPlatform);
  }
  if (selectedSub !== ALL_KEY) {
    filtered = filtered.filter((p) => (p.subcategory_key || ALL_KEY) === selectedSub);
  }
  subcategories[0].count = filtered.length
    + (selectedSub !== ALL_KEY
      ? products.filter((p) => {
        const okPlat = selectedPlatform === ALL_KEY
          || (p.platform_key || slugKey(p.platform)) === selectedPlatform;
        return okPlat;
      }).length - filtered.length
      : 0);
  // Fix All types count to match platform-filtered total
  const platformFiltered = selectedPlatform === ALL_KEY
    ? products
    : products.filter((p) => (p.platform_key || slugKey(p.platform)) === selectedPlatform);
  subcategories[0].count = platformFiltered.length;

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

/** Normalize nested dashboard-style SMM payload OR flat partner list. */
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
            { ...svc, platform: platformName, group: groupName },
            { platform: platformName, subcategory: groupName, categoryId: 'social_media' }
          );
          if (normalized) products.push(normalized);
        }
      }
    }
  } else {
    const list = asArray(
      data.services
        || data.items
        || data.results
        || data.rows
        || (Array.isArray(data) ? data : null)
    );
    for (const svc of list) {
      const normalized = normalizeServiceProduct(svc, { categoryId: 'social_media' });
      if (normalized) products.push(normalized);
    }
    // Prefer explicit platforms list for filter labels when present as strings
    const platformNames = asArray(data.platforms).filter((p) => typeof p === 'string');
    if (platformNames.length && products.length) {
      // ensure platform keys exist even if empty after filter
      for (const name of platformNames) {
        if (!products.some((p) => slugKey(p.platform) === slugKey(name))) {
          // no-op; filter meta derives from products
        }
      }
    }
  }

  const meta = buildFilterMeta(products, filters);
  return {
    enabled: data.enabled !== false,
    count: Number(data.count) || products.length,
    ...meta,
  };
}

async function fetchSmmCatalog(filters = {}) {
  const query = {};
  if (filters.platform && filters.platform !== ALL_KEY) query.platform = filters.platform;
  if (filters.search) query.search = filters.search;
  if (filters.page) query.page = filters.page;
  if (filters.per_page) query.per_page = filters.per_page;
  const raw = await hubRequest('/smm/services', { method: 'GET', query });
  return { ...normalizeSmmCatalog(raw, filters), raw, source: 'live' };
}

async function fetchSmsCatalog(filters = {}) {
  const servicesRaw = await hubRequest('/sms/services', { method: 'GET' });
  const servicesData = unwrapData(servicesRaw);
  const services = asArray(
    servicesData.services
      || servicesData.items
      || servicesData.results
      || (Array.isArray(servicesData) ? servicesData : null)
  );

  const platformFilter = filters.platform && filters.platform !== ALL_KEY
    ? String(filters.platform)
    : null;

  let selectedServices = services;
  if (platformFilter) {
    selectedServices = services.filter((s) => {
      const id = String(pick(s.id, s.service_id, s.serviceId, ''));
      const key = slugKey(pick(s.name, s.title, id));
      return id === platformFilter
        || key === slugKey(platformFilter)
        || String(pick(s.name, '')).toLowerCase() === platformFilter.toLowerCase();
    });
    if (!selectedServices.length) selectedServices = services;
  }

  // Load country prices for selected service(s) — prefer one service for sub-filter UX.
  const focus = selectedServices[0] || services[0];
  const products = [];
  const platforms = services.map((s) => ({
    key: String(pick(s.id, s.service_id, slugKey(s.name))),
    name: String(pick(s.name, s.title, s.id, 'Service')),
    count: 0,
  }));

  if (focus) {
    const serviceId = pick(focus.id, focus.service_id, focus.serviceId);
    let pricesRaw = null;
    try {
      pricesRaw = await hubRequest('/sms/prices', {
        method: 'GET',
        query: { service_id: serviceId },
      });
    } catch {
      try {
        pricesRaw = await hubRequest('/sms/details', {
          method: 'GET',
          query: { service_id: serviceId },
        });
      } catch {
        pricesRaw = null;
      }
    }
    const pricesData = unwrapData(pricesRaw);
    const countries = asArray(
      pricesData.countries
        || pricesData.prices
        || pricesData.items
        || pricesData.results
        || (Array.isArray(pricesData) ? pricesData : null)
    );
    const serviceName = String(pick(focus.name, focus.title, serviceId));
    for (const row of countries) {
      const countryName = pick(row.country, row.country_name, row.name, row.iso, row.country_id, 'Country');
      const countryId = pick(row.country_id, row.countryId, row.id, row.iso, countryName);
      const price = money(pick(row.price_usd, row.priceUsd, row.cost, row.price, row.rate));
      if (price == null || price <= 0) continue;
      const normalized = normalizeServiceProduct({
        product_id: `sms-${serviceId}-${countryId}`,
        name: `${serviceName} · ${countryName}`,
        description: `SMS verification number · ${countryName}`,
        price_usd: price,
        platform: serviceName,
        group: String(countryName),
        service_id: serviceId,
        country_id: countryId,
      }, { categoryId: 'sms', platform: serviceName, subcategory: String(countryName) });
      if (normalized) {
        normalized.raw = { service: focus, country: row };
        products.push(normalized);
      }
    }
    const plat = platforms.find((p) => String(p.key) === String(serviceId));
    if (plat) plat.count = products.length;
  }

  // If no prices yet, expose services themselves as browseable products with placeholder skip
  if (!products.length) {
    for (const s of selectedServices.slice(0, 50)) {
      const price = money(pick(s.price_usd, s.priceUsd, s.min_price, s.cost));
      if (price == null) continue;
      const normalized = normalizeServiceProduct({
        ...s,
        product_id: `sms-svc-${pick(s.id, s.service_id)}`,
        platform: pick(s.name, s.title),
        group: 'Service',
      }, { categoryId: 'sms' });
      if (normalized) products.push(normalized);
    }
  }

  const meta = buildFilterMeta(products, {
    platform: platformFilter ? slugKey(pick(
      (selectedServices[0] && selectedServices[0].name),
      platformFilter
    )) : filters.platform,
    subcategory: filters.subcategory,
  });

  // Prefer SMS service list as platform chips when available
  if (platforms.length) {
    meta.platforms = [
      { key: ALL_KEY, name: 'All services', count: products.length },
      ...platforms.map((p) => ({
        ...p,
        key: slugKey(p.name),
        count: products.filter((x) => slugKey(x.platform) === slugKey(p.name)).length,
      })),
    ];
  }

  return { ...meta, raw: { services: servicesRaw }, source: 'live' };
}

async function fetchEsimCatalog(filters = {}) {
  const query = {};
  if (filters.platform && filters.platform !== ALL_KEY) {
    query.country = String(filters.platform).toUpperCase().slice(0, 2);
  } else if (filters.country) {
    query.country = String(filters.country).toUpperCase().slice(0, 2);
  }
  if (filters.search) query.search = filters.search;
  if (filters.page) query.page = filters.page;

  let raw;
  try {
    raw = await hubRequest('/esim/packages', { method: 'GET', query });
  } catch (err) {
    if (Number(err.status) === 404) {
      raw = await hubRequest('/esim/list', { method: 'GET', query });
    } else {
      throw err;
    }
  }

  const data = unwrapData(raw);
  const packages = asArray(
    data.packages
      || data.items
      || data.results
      || data.products
      || (Array.isArray(data) ? data : null)
  );
  const products = [];
  for (const pkg of packages) {
    const country = pick(
      pkg.locationCode,
      pkg.country,
      pkg.country_iso,
      pkg.iso,
      query.country,
      'Global'
    );
    const dataLabel = pick(pkg.dataAmount, pkg.data, pkg.volume, pkg.name);
    const normalized = normalizeServiceProduct({
      ...pkg,
      product_id: pick(pkg.packageCode, pkg.package_code, pkg.product_id, pkg.id),
      name: pick(pkg.packageName, pkg.name, pkg.productName, `eSIM ${country}`),
      platform: String(country).toUpperCase(),
      group: String(dataLabel || 'Data'),
    }, { categoryId: 'esim', platform: String(country).toUpperCase(), subcategory: String(dataLabel || 'Data') });
    if (normalized) products.push(normalized);
  }

  return { ...buildFilterMeta(products, filters), raw, source: 'live' };
}

async function fetchGiftCardsCatalog(filters = {}) {
  const query = {};
  if (filters.platform && filters.platform !== ALL_KEY) {
    query.country = String(filters.platform).toUpperCase().slice(0, 8);
  } else if (filters.country) {
    query.country = filters.country;
  }
  if (filters.subcategory && filters.subcategory !== ALL_KEY) {
    query.category = filters.subcategory;
  }
  if (filters.search) query.search = filters.search;
  if (filters.page) query.page = filters.page;

  let raw;
  try {
    raw = await hubRequest('/gifts/packages', { method: 'GET', query });
  } catch (err) {
    if (Number(err.status) === 404) {
      raw = await hubRequest('/gift-cards/list', { method: 'GET', query });
    } else {
      throw err;
    }
  }

  const data = unwrapData(raw);
  const list = asArray(
    data.giftcards
      || data.packages
      || data.products
      || data.items
      || data.results
      || (Array.isArray(data) ? data : null)
  );
  const products = [];
  for (const item of list) {
    const country = pick(item.country?.isoName, item.country_iso, item.country, 'Global');
    const brand = pick(item.brand?.brandName, item.brand_name, item.brand, item.category, 'Gift Card');
    const price = money(pick(
      item.price_usd,
      item.priceUsd,
      item.min_price_usd,
      item.price,
      item.senderFee,
      item.totalPrice
    ));
    const normalized = normalizeServiceProduct({
      ...item,
      product_id: pick(item.productId, item.product_id, item.id, item.sku),
      name: pick(item.productName, item.name, item.title, `${brand} gift card`),
      price_usd: price,
      platform: String(country).toUpperCase(),
      group: String(brand),
    }, {
      categoryId: 'gift_cards',
      platform: String(country).toUpperCase(),
      subcategory: String(brand),
    });
    if (normalized) products.push(normalized);
  }

  return { ...buildFilterMeta(products, filters), raw, source: 'live' };
}

async function fetchSimTopupCatalog(filters = {}) {
  const query = {};
  if (filters.number) query.number = String(filters.number).replace(/\D/g, '');
  if (filters.country || filters.platform) {
    const country = String(filters.country || filters.platform);
    query.countryCode = country.includes('|') ? country : country;
    query.countryIso = country.includes('|') ? country.split('|')[1] : country;
  }

  let raw = null;
  if (query.number && (query.countryCode || query.countryIso)) {
    try {
      raw = await hubRequest('/sim/packages', { method: 'GET', query });
    } catch {
      raw = await hubRequest('/topup/detect', {
        method: 'GET',
        query: {
          number: query.number,
          countryIso: query.countryIso || query.countryCode,
        },
      });
    }
  } else {
    // Without a number, try a generic packages listing if the API supports it.
    try {
      raw = await hubRequest('/sim/packages', { method: 'GET', query });
    } catch (err) {
      const empty = buildFilterMeta([], filters);
      return {
        ...empty,
        source: 'live',
        requires_input: ['country', 'number'],
        message: 'Enter a country and phone number to load SIM top-up packages from Kripicard.',
        raw: null,
        error: err.message,
      };
    }
  }

  const data = unwrapData(raw);
  const operatorName = pick(data.operatorName, data.operator_name, data.operator?.name, 'Operator');
  const operatorId = pick(data.operatorId, data.operator_id, data.operator?.id);
  const packages = asArray(data.packages || data.items || data.results);
  const country = pick(data.countryIso, data.country, query.countryIso, filters.platform, 'INTL');
  const products = [];
  for (const pkg of packages) {
    const idx = pick(pkg.index, pkg.package_index, pkg.packageIndex, pkg.id);
    const price = money(pick(pkg.price_usd, pkg.priceUsd, pkg.price, pkg.amount, pkg.retailPrice));
    const normalized = normalizeServiceProduct({
      ...pkg,
      product_id: `sim-${operatorId || 'op'}-${idx}`,
      name: pick(pkg.name, pkg.title, `${operatorName} top-up`),
      description: pick(pkg.description, `${operatorName} · ${country}`),
      price_usd: price,
      platform: String(country).toUpperCase(),
      group: String(operatorName),
      operator_id: operatorId,
      package_index: idx,
    }, {
      categoryId: 'sim_topup',
      platform: String(country).toUpperCase(),
      subcategory: String(operatorName),
    });
    if (normalized) products.push(normalized);
  }

  return { ...buildFilterMeta(products, filters), raw, source: 'live' };
}

async function fetchProxiesCatalog(filters = {}) {
  const typesRaw = await hubRequest('/proxies/types', { method: 'GET' }).catch(async () => (
    hubRequest('/proxies/meta', { method: 'GET' })
  ));
  const typesData = unwrapData(typesRaw);
  const types = asArray(
    typesData.types
      || typesData.static
      || typesData.items
      || (Array.isArray(typesData) ? typesData : null)
  );

  // Flatten common meta shape: { static: [...], pool: [...] }
  let typeList = types;
  if (!typeList.length) {
    typeList = [
      ...asArray(typesData.static).map((t) => (typeof t === 'string' ? { type: t, family: 'static' } : { ...t, family: 'static' })),
      ...asArray(typesData.pool).map((t) => (typeof t === 'string' ? { type: t, family: 'pool' } : { ...t, family: 'pool' })),
    ];
  }

  const platformFilter = filters.platform && filters.platform !== ALL_KEY
    ? String(filters.platform)
    : null;
  const focus = typeList.find((t) => {
    const key = String(pick(t.type, t.id, t.key, t.name));
    return platformFilter && (key === platformFilter || slugKey(key) === slugKey(platformFilter));
  }) || typeList[0];

  const products = [];
  if (focus) {
    const type = String(pick(focus.type, focus.id, focus.key, focus.name));
    const family = String(pick(focus.family, focus.group, 'static')).toLowerCase();
    let gates = [];
    try {
      const gatesRaw = await hubRequest('/proxies/gates', { method: 'GET', query: { type } });
      gates = asArray(unwrapData(gatesRaw)?.gates || unwrapData(gatesRaw) || gatesRaw);
      if (gates.length && !Array.isArray(gates)) gates = asArray(gates.items);
    } catch {
      gates = [];
    }

    const gateFilter = filters.subcategory && filters.subcategory !== ALL_KEY
      ? String(filters.subcategory)
      : null;
    const gate = gates.find((g) => String(pick(g.id, g.gate_id)) === gateFilter
      || slugKey(pick(g.name, g.id)) === slugKey(gateFilter))
      || gates[0];

    if (gate && family.includes('pool')) {
      const gateId = pick(gate.id, gate.gate_id);
      const tiersRaw = await hubRequest('/proxies/pool/tiers', {
        method: 'GET',
        query: { type, gate_id: gateId },
      }).catch(() => null);
      const tiers = asArray(unwrapData(tiersRaw)?.tiers || unwrapData(tiersRaw));
      for (const tier of tiers) {
        const normalized = normalizeServiceProduct({
          ...tier,
          product_id: `proxy-pool-${type}-${gateId}-${pick(tier.gb, tier.traffic_mb, tier.id)}`,
          name: pick(tier.name, `${type} pool · ${tier.gb || ''}GB`),
          price_usd: pick(tier.price_usd, tier.priceUsd, tier.price),
          platform: type,
          group: pick(gate.name, `Gate ${gateId}`),
        }, {
          categoryId: 'proxies',
          platform: type,
          subcategory: String(pick(gate.name, gateId)),
        });
        if (normalized) products.push(normalized);
      }
    } else if (gate) {
      const gateId = pick(gate.id, gate.gate_id);
      const catalogRaw = await hubRequest('/proxies/static/catalog', {
        method: 'GET',
        query: { type, gate_id: gateId },
      }).catch(() => null);
      const rows = asArray(unwrapData(catalogRaw)?.rows || unwrapData(catalogRaw)?.items || unwrapData(catalogRaw));
      for (const row of rows.slice(0, 100)) {
        const country = pick(row.country, row.name, row.country_name, row.country_id, 'Country');
        const duration = pick(row.duration_minutes, row.duration, row.minutes, 'rental');
        const normalized = normalizeServiceProduct({
          ...row,
          product_id: `proxy-static-${type}-${gateId}-${pick(row.country_id, row.id)}-${duration}`,
          name: `${country} · ${duration}m`,
          description: `${type} static proxy via ${pick(gate.name, gateId)}`,
          price_usd: pick(row.unit_usd, row.price_usd, row.price, row.min_price_usd),
          platform: type,
          group: pick(gate.name, `Gate ${gateId}`),
        }, {
          categoryId: 'proxies',
          platform: type,
          subcategory: String(pick(gate.name, gateId)),
        });
        if (normalized) products.push(normalized);
      }
    }

    // If still empty, expose type/gate shells with min prices
    if (!products.length) {
      for (const g of gates.slice(0, 20)) {
        const price = money(pick(g.min_price_usd, g.minPriceUsd, g.price_usd));
        if (price == null) continue;
        const normalized = normalizeServiceProduct({
          product_id: `proxy-${type}-${pick(g.id, g.gate_id)}`,
          name: `${type} · ${pick(g.name, g.id)}`,
          price_usd: price,
          platform: type,
          group: pick(g.name, g.id),
        }, { categoryId: 'proxies', platform: type, subcategory: String(pick(g.name, g.id)) });
        if (normalized) products.push(normalized);
      }
    }
  }

  const meta = buildFilterMeta(products, filters);
  if (typeList.length) {
    meta.platforms = [
      { key: ALL_KEY, name: 'All proxy types', count: products.length },
      ...typeList.map((t) => {
        const name = String(pick(t.type, t.name, t.id));
        return {
          key: slugKey(name),
          name,
          count: products.filter((p) => slugKey(p.platform) === slugKey(name)).length,
        };
      }),
    ];
  }

  return { ...meta, raw: { types: typesRaw }, source: 'live' };
}

/**
 * Fetch live catalog for a Hub category id.
 * @returns {Promise<object>}
 */
async function fetchLiveHubCatalog(categoryId, filters = {}) {
  if (!isApiConfigured()) {
    const err = new Error('KRIPICARD_API_KEY is not configured');
    err.code = 'KRIPICARD_NOT_CONFIGURED';
    throw err;
  }

  switch (String(categoryId)) {
    case 'social_media':
      return fetchSmmCatalog(filters);
    case 'sms':
      return fetchSmsCatalog(filters);
    case 'esim':
      return fetchEsimCatalog(filters);
    case 'gift_cards':
      return fetchGiftCardsCatalog(filters);
    case 'sim_topup':
      return fetchSimTopupCatalog(filters);
    case 'proxies':
      return fetchProxiesCatalog(filters);
    default: {
      const err = new Error(`No live Kripicard catalog mapper for ${categoryId}`);
      err.code = 'HUB_LIVE_CATEGORY_UNSUPPORTED';
      throw err;
    }
  }
}

module.exports = {
  ALL_KEY,
  DEFAULT_EXTERNAL_BASE,
  getHubApiBase,
  isApiConfigured,
  hubRequest,
  fetchLiveHubCatalog,
  fetchSmmCatalog,
  fetchSmsCatalog,
  fetchEsimCatalog,
  fetchGiftCardsCatalog,
  fetchSimTopupCatalog,
  fetchProxiesCatalog,
  normalizeSmmCatalog,
  normalizeServiceProduct,
  buildFilterMeta,
  slugKey,
};
