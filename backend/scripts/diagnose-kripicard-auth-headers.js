#!/usr/bin/env node
/**
 * Live Kripicard auth diagnostic.
 *
 * Tries header, query, and body placements of KRIPICARD_API_KEY against
 * https://appapi.kripicard.com and classifies each response:
 *   api_key_missing | api_key_invalid | api_access_disabled | accepted | …
 *
 * Read-only. Does not create cards, deposits, or purchases.
 * Never prints the key. Run:
 *   node backend/scripts/diagnose-kripicard-auth-headers.js
 *
 * Optional:
 *   KRIPICARD_AUTH_DIAG_HOST=https://appapi.kripicard.com
 *   KRIPICARD_AUTH_DIAG_TIMEOUT_MS=12000
 */
'use strict';

const crypto = require('crypto');

const DEFAULT_HOST = 'https://appapi.kripicard.com';
let activeHost = String(process.env.KRIPICARD_AUTH_DIAG_HOST || DEFAULT_HOST).replace(/\/$/, '');
const TIMEOUT_MS = Number(process.env.KRIPICARD_AUTH_DIAG_TIMEOUT_MS) || 12000;

const ENDPOINTS = Object.freeze([
  {
    id: 'account_balance',
    path: '/api/external/account/balance',
    product: 'merchant_external',
  },
  {
    id: 'cards_bins',
    path: '/api/external/cards/bins',
    product: 'merchant_external',
  },
  {
    id: 'smm_services',
    path: '/api/external/smm/services',
    product: 'hub_smm',
    extraBody: { page: 1, limit: 1 },
  },
]);

function fingerprint(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function describeKey(key) {
  const raw = String(key || '');
  const prefixes = ['sk_', 'pk_', 'rk_', 'live_', 'test_', 'kp_', 'pub_', 'sec_'];
  const typedPrefix = prefixes.find((prefix) => raw.startsWith(prefix)) || null;
  let charset = 'other';
  if (/^[0-9a-f]+$/i.test(raw)) charset = 'hex';
  else if (/^[A-Za-z0-9._-]+$/.test(raw)) charset = 'token';
  return {
    configured: raw.length > 0 && !raw.includes('...'),
    length: raw.length,
    fingerprint16: raw ? fingerprint(raw) : null,
    charset,
    typed_prefix: typedPrefix,
    looks_like_publishable: typedPrefix === 'pk_' || typedPrefix === 'pub_',
    looks_like_secret_prefix: typedPrefix === 'sk_' || typedPrefix === 'sec_',
    has_whitespace: /\s/.test(raw),
    wrapped_in_quotes: raw.startsWith('"') || raw.startsWith("'"),
  };
}

/**
 * Auth placements to compare. Header names follow HTTP case-insensitivity;
 * distinct names (Api-Key vs X-API-Key) are separate.
 */
function authProfiles(apiKey) {
  const json = { Accept: 'application/json', 'Content-Type': 'application/json' };
  return [
    { id: 'none', headers: { ...json } },
    { id: 'authorization_bearer', headers: { ...json, Authorization: `Bearer ${apiKey}` } },
    { id: 'authorization_raw', headers: { ...json, Authorization: apiKey } },
    { id: 'authorization_token', headers: { ...json, Authorization: `Token ${apiKey}` } },
    { id: 'authorization_api_key_scheme', headers: { ...json, Authorization: `Api-Key ${apiKey}` } },
    { id: 'x_api_key', headers: { ...json, 'X-API-Key': apiKey } },
    { id: 'api_key_header', headers: { ...json, 'Api-Key': apiKey } },
    { id: 'apikey_header', headers: { ...json, apikey: apiKey } },
    { id: 'x_auth_token', headers: { ...json, 'X-Auth-Token': apiKey } },
    { id: 'x_kripicard_api_key', headers: { ...json, 'X-Kripicard-Api-Key': apiKey } },
    { id: 'x_merchant_key', headers: { ...json, 'X-Merchant-Key': apiKey } },
    {
      id: 'bearer_and_x_api_key',
      headers: { ...json, Authorization: `Bearer ${apiKey}`, 'X-API-Key': apiKey },
    },
    {
      id: 'query_api_key',
      headers: { ...json },
      query: { api_key: apiKey },
      method: 'GET',
    },
    {
      id: 'query_api_key_plus_bearer_x_api_key',
      headers: { ...json, Authorization: `Bearer ${apiKey}`, 'X-API-Key': apiKey },
      query: { api_key: apiKey },
      method: 'GET',
    },
    {
      id: 'body_api_key',
      headers: { ...json },
      body: { api_key: apiKey },
      method: 'POST',
    },
    {
      id: 'body_apiKey_camel',
      headers: { ...json },
      body: { apiKey },
      method: 'POST',
    },
    {
      id: 'body_token',
      headers: { ...json },
      body: { token: apiKey },
      method: 'POST',
    },
    {
      id: 'body_api_key_plus_bearer_x_api_key',
      headers: { ...json, Authorization: `Bearer ${apiKey}`, 'X-API-Key': apiKey },
      body: { api_key: apiKey },
      method: 'POST',
      note: 'current client style for createcard / balance fallback',
    },
  ];
}

function classify(status, json, text) {
  const message = String(json?.message || json?.error || text || '').replace(/\s+/g, ' ').slice(0, 220);
  const providerCode = json?.code || json?.error_code || null;
  const lower = message.toLowerCase();
  const success = json?.success === true || (status >= 200 && status < 300 && json?.success !== false);

  let kind = 'other';
  if (success) kind = 'accepted';
  else if (status === 401 && /missing/.test(lower)) kind = 'api_key_missing';
  else if (status === 401 && /invalid/.test(lower)) kind = 'api_key_invalid';
  else if (status === 401) kind = 'unauthorized';
  else if (
    status === 403
    && (String(providerCode).toUpperCase() === 'API_ACCESS_DISABLED' || /api access is disabled/.test(lower))
  ) kind = 'api_access_disabled';
  else if (status === 403) kind = 'forbidden';
  else if (status === 404) kind = 'route_not_found';
  else if (status === 429) kind = 'rate_limited';
  else if (status >= 500) kind = 'server_error';
  else if (status === 400 || status === 422) kind = 'rejected_after_auth';

  return {
    http_status: status,
    kind,
    provider_code: providerCode,
    success: Boolean(success),
    message,
  };
}

function redact(value, apiKey) {
  if (!apiKey) return value;
  return String(value || '').split(apiKey).join('[redacted]');
}

async function requestOnce({ method, url, headers, body, apiKey }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    const classified = classify(response.status, json, text);
    classified.message = redact(classified.message, apiKey);
    return classified;
  } catch (err) {
    return {
      http_status: null,
      kind: err.name === 'AbortError' ? 'timeout' : 'network_error',
      provider_code: null,
      success: false,
      message: redact(err.message, apiKey).slice(0, 220),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runProfile(endpoint, profile, apiKey) {
  const method = profile.method || (profile.body ? 'POST' : 'GET');
  const url = new URL(activeHost + endpoint.path);
  if (profile.query) {
    for (const [key, value] of Object.entries(profile.query)) {
      url.searchParams.set(key, value);
    }
  }
  const body = profile.body
    ? { ...profile.body, ...(endpoint.extraBody || {}) }
    : (method === 'POST' && endpoint.extraBody ? { ...endpoint.extraBody } : undefined);

  const result = await requestOnce({
    method,
    url: url.toString(),
    headers: profile.headers,
    body,
    apiKey,
  });
  return {
    endpoint: endpoint.id,
    product: endpoint.product,
    path: endpoint.path,
    profile: profile.id,
    method,
    note: profile.note || null,
    ...result,
  };
}

function summarize(keyInfo, rows) {
  const recognized = rows.filter((row) => (
    row.kind === 'api_key_invalid'
    || row.kind === 'api_access_disabled'
    || row.kind === 'accepted'
    || row.kind === 'forbidden'
    || row.kind === 'rejected_after_auth'
  ));
  const accepted = rows.filter((row) => row.kind === 'accepted');
  const disabled = rows.filter((row) => row.kind === 'api_access_disabled');
  const invalid = rows.filter((row) => row.kind === 'api_key_invalid');
  const missing = rows.filter((row) => row.kind === 'api_key_missing');

  let conclusion = 'inconclusive';
  let detail = 'No stable auth classification.';

  if (accepted.length) {
    conclusion = 'key_accepted';
    detail = `At least one placement was accepted (${accepted.map((row) => `${row.endpoint}:${row.profile}`).join(', ')}).`;
  } else if (disabled.length && !invalid.length) {
    conclusion = 'key_recognized_access_disabled';
    detail = 'The server recognizes this credential (403 API_ACCESS_DISABLED). It is not an invalid-key or header-format failure. API access is restricted on the Kripicard account.';
  } else if (invalid.length && accepted.length === 0) {
    const presented = new Set(invalid.map((row) => row.profile));
    const headerOnlyInvalid = [...presented].some((id) => !id.startsWith('body_') && !id.startsWith('query_'));
    const bodyOrQueryInvalid = [...presented].some((id) => id.startsWith('body_') || id.startsWith('query_'));
    if (bodyOrQueryInvalid && !keyInfo.typed_prefix) {
      conclusion = 'key_rejected_not_a_header_mismatch';
      detail = 'Placements the gateway actually reads (body api_key and/or query api_key) return 401 Invalid API Key, not "API Key is missing". Header variations are not the cause. This value is not an active external API key for this host'
        + (headerOnlyInvalid ? ', and header-only placements are also rejected as invalid.' : '. Header-only calls are ignored (missing) unless the key is also in the body or query.')
        + (keyInfo.looks_like_publishable ? ' The value looks publishable, not a secret merchant key.' : ' The value has no sk_/pk_ type prefix; it is a raw token the gateway does not accept.');
    } else if (keyInfo.looks_like_publishable) {
      conclusion = 'publishable_key_rejected';
      detail = 'The configured value uses a publishable prefix and is rejected as an API key.';
    } else {
      conclusion = 'key_invalid';
      detail = 'The gateway returns Invalid API Key for recognized placements. This is a credential mismatch, not a maintenance outage.';
    }
  } else if (missing.length === rows.length) {
    conclusion = 'key_never_presented';
    detail = 'Every variation was treated as a missing API key. The gateway did not see the credential in the placements we tried.';
  }

  const byEndpoint = {};
  for (const row of rows) {
    byEndpoint[row.endpoint] = byEndpoint[row.endpoint] || {};
    byEndpoint[row.endpoint][row.kind] = (byEndpoint[row.endpoint][row.kind] || 0) + 1;
  }

  return {
    conclusion,
    detail,
    counts: {
      accepted: accepted.length,
      api_key_invalid: invalid.length,
      api_access_disabled: disabled.length,
      api_key_missing: missing.length,
      recognized: recognized.length,
      total: rows.length,
    },
    kinds_by_endpoint: byEndpoint,
    current_client_style: rows.filter((row) => row.profile === 'body_api_key_plus_bearer_x_api_key'),
  };
}

async function main() {
  require('../src/lib/loadEnv').loadEnv({ force: true });
  const { resolveKripicardApiKey, resolveKripicardOrigin } = require('../../lib/kripicard');
  const apiKey = resolveKripicardApiKey();
  const configuredHost = resolveKripicardOrigin();
  if (!String(process.env.KRIPICARD_AUTH_DIAG_HOST || '').trim()) {
    activeHost = configuredHost;
  }
  const keyInfo = describeKey(apiKey);
  if (!keyInfo.configured) {
    console.error(JSON.stringify({
      ok: false,
      error: 'KRIPICARD_API_KEY is not configured',
    }, null, 2));
    process.exit(1);
  }

  const profiles = authProfiles(apiKey);
  const rows = [];
  for (const endpoint of ENDPOINTS) {
    for (const profile of profiles) {
      // Avoid sending a JSON body on a forced GET.
      if (profile.method === 'GET' && profile.body) continue;
      rows.push(await runProfile(endpoint, profile, apiKey));
      const last = rows[rows.length - 1];
      console.error(
        `${last.endpoint} ${last.method} ${last.profile} -> ${last.http_status || last.kind} ${last.kind}`
      );
    }
  }

  const report = {
    checked_at: new Date().toISOString(),
    host: activeHost,
    key: keyInfo,
    endpoints: ENDPOINTS.map((endpoint) => ({
      id: endpoint.id,
      product: endpoint.product,
      url: activeHost + endpoint.path,
    })),
    results: rows.map((row) => ({
      endpoint: row.endpoint,
      product: row.product,
      method: row.method,
      profile: row.profile,
      http_status: row.http_status,
      kind: row.kind,
      provider_code: row.provider_code,
      success: row.success,
      message: row.message,
    })),
    summary: summarize(keyInfo, rows),
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.summary.conclusion !== 'key_accepted') process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
