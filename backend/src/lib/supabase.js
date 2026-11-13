require('./loadEnv');
const { createClient } = require('@supabase/supabase-js');

let client = null;
let sanitizedLogged = false;

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

/**
 * Cursor/Vercel secrets are sometimes pasted as full assignment lines, e.g.
 *   NEXT_PUBLIC_SUPABASE_URL = https://….supabase.co
 * or markdown links:
 *   NEXT_PUBLIC_SUPABASE_URL = [https://….supabase.co](https://….supabase.co)
 * and occasionally rotated into the wrong secret slot. Normalize those forms.
 */
function stripAssignmentPrefix(raw) {
  const text = String(raw || '').trim();
  const match = text.match(/^[A-Z][A-Z0-9_]*\s*=\s*(.+)$/s);
  return match ? match[1].trim() : text;
}

function extractHttpsUrl(raw) {
  const text = stripAssignmentPrefix(raw).replace(/^['"]|['"]$/g, '').trim();
  if (!text) return '';
  const markdown = text.match(/\((https?:\/\/[^)\s]+)\)/i);
  if (markdown) return markdown[1].trim().replace(/\/$/, '');
  const bare = text.match(/(https?:\/\/[^\s\]"'<>]+)/i);
  if (bare) return bare[1].trim().replace(/\/$/, '');
  return '';
}

function extractSecretValue(raw) {
  let text = stripAssignmentPrefix(raw).replace(/^['"]|['"]$/g, '').trim();
  if (!text) return '';
  // If a URL somehow landed in a key slot, reject it.
  if (/^https?:\/\//i.test(text) || /supabase\.co/i.test(text)) return '';
  return text;
}

function assignmentKey(raw) {
  const match = String(raw || '').trim().match(/^([A-Z][A-Z0-9_]*)\s*=/);
  return match ? match[1] : '';
}

/** Decode a Supabase JWT payload without verifying the signature (shape check only). */
function decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function jwtRole(token) {
  const payload = decodeJwtPayload(token);
  return payload && typeof payload.role === 'string' ? payload.role : '';
}

function looksLikePublishableOrAnonKey(value) {
  const key = String(value || '').trim();
  if (!key || key.includes('...')) return false;
  if (/^sb_publishable_/i.test(key)) return true;
  // Never treat a service_role JWT as a browser/anon key (prevents public leaks).
  if (/service_role/i.test(key) || jwtRole(key) === 'service_role') return false;
  if (/^eyJ/.test(key) && key.length >= 80) {
    const role = jwtRole(key);
    // Accept classic anon JWTs; reject unknown/empty roles that might be secrets.
    return !role || role === 'anon' || role === 'authenticated';
  }
  // Legacy JWT anon keys are long; short placeholders are unusable.
  return key.length >= 40 && !/^sb_secret_/i.test(key);
}

/**
 * More permissive check for explicitly labeled anon/publishable env slots.
 * Some projects ship JWTs without a readable role claim; those should still
 * work for browser Google OAuth when the operator set NEXT_PUBLIC_SUPABASE_ANON_KEY.
 */
function acceptExplicitAnonKey(value) {
  const key = String(value || '').trim();
  if (!key || key.includes('...')) return false;
  if (/^sb_publishable_/i.test(key)) return true;
  if (/^sb_secret_/i.test(key) || /service_role/i.test(key) || jwtRole(key) === 'service_role') {
    return false;
  }
  if (/^eyJ/.test(key) && key.length >= 80) return true;
  return looksLikePublishableOrAnonKey(key);
}

function looksLikeServiceRoleKey(value) {
  const key = String(value || '').trim();
  if (!key || key.includes('...')) return false;
  if (/^sb_secret_/i.test(key)) return true;
  if (/service_role/i.test(key) || jwtRole(key) === 'service_role') return true;
  if (/^eyJ/.test(key) && key.length >= 80) {
    const role = jwtRole(key);
    // Prefer explicit role claim; do not assume every long JWT is service_role.
    return role === 'service_role';
  }
  return false;
}

function isUsableSecret(value) {
  const key = String(value || '').trim();
  return Boolean(key) && !key.includes('...');
}

function collectRawCandidates() {
  return [
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_URL,
    process.env.PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_PROJECT_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.SUPABASE_ANON_KEY,
    process.env.PUBLIC_SUPABASE_ANON_KEY,
    process.env.SUPABASE_KEY,
    process.env.SUPABASE_PUBLIC_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SERVICE_KEY,
    process.env.SUPABASE_SECRET_KEY,
  ].filter((value) => String(value || '').trim());
}

/**
 * Recover URL / anon / service-role values even when secrets were pasted into
 * the wrong env var slots (common misconfig in Cursor Cloud + Vercel).
 */
function resolveSupabaseCredentials() {
  const candidates = collectRawCandidates();

  let url = '';
  let anonKey = '';
  let serviceKey = '';

  // Pass 1: honor explicit assignment labels inside scrambled values.
  for (const raw of candidates) {
    const label = assignmentKey(raw);
    if (/URL/i.test(label)) {
      const found = extractHttpsUrl(raw);
      if (found) url = found;
    } else if (/SERVICE|SECRET/i.test(label)) {
      const found = extractSecretValue(raw);
      // Explicit service/secret labels: accept any non-placeholder secret (test fixtures
      // and older keys may be shorter than modern sb_secret_ / JWT shapes).
      if (found && isUsableSecret(found)) serviceKey = found;
    } else if (/ANON|PUBLISHABLE|PUBLIC_KEY/i.test(label)) {
      const found = extractSecretValue(raw);
      if (found && acceptExplicitAnonKey(found)) anonKey = found;
    }
  }

  // Pass 2: shape-detect any remaining slots.
  for (const raw of candidates) {
    if (!url) {
      const found = extractHttpsUrl(raw);
      if (found && /supabase\.co/i.test(found)) url = found;
    }
    const secret = extractSecretValue(raw);
    if (!secret) continue;
    if (!serviceKey && looksLikeServiceRoleKey(secret) && /^sb_secret_/i.test(secret)) {
      serviceKey = secret;
      continue;
    }
    if (!anonKey && looksLikePublishableOrAnonKey(secret) && /^sb_publishable_/i.test(secret)) {
      anonKey = secret;
      continue;
    }
  }

  // Pass 3: JWT-style leftovers (service vs anon are both eyJ… — prefer labeled first).
  for (const raw of candidates) {
    const secret = extractSecretValue(raw);
    if (!secret || !/^eyJ/.test(secret)) continue;
    const label = assignmentKey(raw);
    if (!serviceKey && (/SERVICE|SECRET/i.test(label) || /service_role/i.test(secret))) {
      serviceKey = secret;
    } else if (!anonKey && (/ANON|PUBLISHABLE|PUBLIC/i.test(label) || !/service_role/i.test(secret))) {
      anonKey = secret;
    } else if (!serviceKey && looksLikeServiceRoleKey(secret)) {
      serviceKey = secret;
    } else if (!anonKey && looksLikePublishableOrAnonKey(secret)) {
      anonKey = secret;
    }
  }

  // Pass 4: clean direct env reads when values were not scrambled.
  if (!url) {
    url = extractHttpsUrl(firstNonEmpty(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_URL,
      process.env.PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_PROJECT_URL
    ));
  }
  if (!anonKey) {
    const direct = extractSecretValue(firstNonEmpty(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      process.env.SUPABASE_ANON_KEY,
      process.env.PUBLIC_SUPABASE_ANON_KEY,
      process.env.SUPABASE_KEY,
      process.env.SUPABASE_PUBLIC_KEY
    ));
    // Explicitly configured anon slots: accept browser-safe keys even when the
    // JWT role claim is missing/unusual (common with some Supabase projects).
    if (acceptExplicitAnonKey(direct)) anonKey = direct;
  }
  if (!serviceKey) {
    const direct = extractSecretValue(firstNonEmpty(
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      process.env.SUPABASE_SERVICE_KEY,
      process.env.SUPABASE_SECRET_KEY
    ));
    // Direct service-role slots: do not require sb_secret_/JWT shape so local and
    // unit-test credentials (e.g. `service-role-secret-key`) still enable the client.
    if (direct && isUsableSecret(direct)) serviceKey = direct;
  }

  return {
    url: url || '',
    anonKey: anonKey || '',
    serviceKey: serviceKey || '',
  };
}

function getSupabaseConfig() {
  const resolved = resolveSupabaseCredentials();
  if (!sanitizedLogged) {
    sanitizedLogged = true;
    const rawUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
    const scrambled = rawUrl && !/^https?:\/\//i.test(rawUrl);
    if (scrambled && resolved.url) {
      console.warn(
        '[supabase] Recovered project URL/keys from scrambled env values '
        + '(secrets appear to contain KEY=value assignment text or were swapped). '
        + 'Re-save Cursor/Vercel secrets as bare values for NEXT_PUBLIC_SUPABASE_URL, '
        + 'NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.'
      );
    }
  }
  return resolved;
}

/**
 * Server-side client is enabled when a project URL plus either the
 * service-role key or a full anon key is present. Truncated placeholder
 * keys (containing "...") are treated as unset.
 */
function isSupabaseEnabled() {
  const { url, anonKey, serviceKey } = getSupabaseConfig();
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (isUsableSecret(serviceKey) || isUsableSecret(anonKey)) return true;
  return false;
}

function isPublicSupabaseEnabled() {
  const { url, anonKey } = getSupabaseConfig();
  return Boolean(url && /^https?:\/\//i.test(url) && acceptExplicitAnonKey(anonKey));
}

function getSupabase() {
  if (!isSupabaseEnabled()) return null;
  if (!client) {
    const { url, anonKey, serviceKey } = getSupabaseConfig();
    const hasService = isUsableSecret(serviceKey);
    if (!hasService) {
      const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
      if (nodeEnv === 'production' || process.env.VERCEL === '1') {
        console.error(
          '[supabase] CRITICAL: SUPABASE_SERVICE_ROLE_KEY missing in production. '
          + 'Refusing to use the anon key for server writes (would be blocked by RLS anyway).'
        );
        return null;
      }
      console.warn('[supabase] Using anon key for server client (dev only) — set SUPABASE_SERVICE_ROLE_KEY');
    }
    const key = hasService ? serviceKey : anonKey;
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    console.log('[supabase] Client initialized');
  }
  return client;
}

/**
 * Public path mount for the same-origin Supabase reverse proxy
 * (Vercel rewrite + Express /supabase → *.supabase.co).
 */
function supabaseBrowserProxyPath() {
  const raw = String(process.env.SUPABASE_BROWSER_PROXY_PATH || '/supabase').trim() || '/supabase';
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withSlash.replace(/\/+$/, '') || '/supabase';
}

function isSupabaseBrowserProxyEnabled() {
  const flag = String(process.env.SUPABASE_BROWSER_PROXY || 'true').trim().toLowerCase();
  return flag !== '0' && flag !== 'false' && flag !== 'off' && flag !== 'no';
}

/** Site origin for browser-facing Supabase proxy URLs (no trailing slash). */
function resolvePublicSiteOrigin(req) {
  const fromEnv = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (fromEnv && /^https?:\/\//i.test(fromEnv)) return fromEnv;
  if (req && typeof req === 'object') {
    const proto = String(
      req.headers?.['x-forwarded-proto'] || req.protocol || 'https'
    ).split(',')[0].trim() || 'https';
    const host = String(
      req.headers?.['x-forwarded-host'] || req.headers?.host || ''
    ).split(',')[0].trim();
    if (host) return `${proto}://${host}`.replace(/\/+$/, '');
  }
  const vercel = String(
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || ''
  ).trim();
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    if (host) return `https://${host}`;
  }
  return '';
}

/**
 * URL the browser / Supabase JS client should use.
 * Prefers https://eisymyanmar.com/supabase (proxied) over *.supabase.co.
 */
function getBrowserSupabaseUrl(upstreamUrl, req) {
  const upstream = String(upstreamUrl || '').trim().replace(/\/+$/, '');
  if (!upstream || !isSupabaseBrowserProxyEnabled()) return upstream;
  const siteOrigin = resolvePublicSiteOrigin(req);
  if (!siteOrigin) return upstream;
  return `${siteOrigin}${supabaseBrowserProxyPath()}`;
}

/**
 * Rewrite Location hosts that point at upstream Supabase onto the site proxy.
 *
 * CRITICAL: never rewrite Google OAuth `redirect_uri`. GoTrue must exchange the
 * Google auth code with redirect_uri = https://PROJECT.supabase.co/auth/v1/callback.
 * Rewriting it to /supabase/auth/v1/callback causes:
 *   "Unable to exchange external code: 4/0A…"
 */
function rewriteSupabaseProxyLocation(location, {
  upstreamOrigin,
  publicOrigin,
  proxyPath,
} = {}) {
  const raw = String(location || '').trim();
  if (!raw || !publicOrigin || !proxyPath) return raw;
  const upstream = String(upstreamOrigin || '').replace(/\/+$/, '');
  let url;
  try {
    url = new URL(raw, upstream || publicOrigin);
  } catch {
    return raw;
  }

  // Leave IdP authorize URLs untouched (including redirect_uri query).
  if (/google\.com$/i.test(url.hostname) || /accounts\.google\./i.test(url.hostname)) {
    return url.toString();
  }
  if (url.searchParams.has('redirect_uri')) {
    // Any other IdP Location: still do not rewrite redirect_uri.
    return url.toString();
  }

  const hostIsUpstream = upstream && url.origin === new URL(upstream).origin;
  const hostIsSupabase = /\.supabase\.co$/i.test(url.hostname);
  // Keep GoTrue's own /auth/v1/callback on *.supabase.co so Google→Supabase
  // round-trips match the registered OAuth client redirect URI.
  if ((hostIsUpstream || hostIsSupabase) && /^\/auth\/v1\/callback\/?/i.test(url.pathname)) {
    return url.toString();
  }
  if (hostIsUpstream || hostIsSupabase) {
    return `${publicOrigin}${proxyPath}${url.pathname}${url.search}${url.hash}`;
  }
  return url.toString();
}

/**
 * Browser-facing Supabase config (Google OAuth + supabase-js).
 * Pass the Express `req` when available so preview Host headers resolve.
 */
function getPublicSupabaseConfig(req) {
  const { url, anonKey } = getSupabaseConfig();
  const hasUrl = Boolean(url && /^https?:\/\//i.test(url));
  const hasAnon = Boolean(anonKey && acceptExplicitAnonKey(anonKey));
  if (hasUrl && hasAnon) {
    const browserUrl = getBrowserSupabaseUrl(url, req);
    const proxied = Boolean(
      isSupabaseBrowserProxyEnabled()
      && resolvePublicSiteOrigin(req)
      && browserUrl !== String(url).replace(/\/+$/, '')
    );
    return {
      enabled: true,
      url: browserUrl,
      anonKey,
      reason: 'ok',
      proxied,
    };
  }
  let reason = 'missing_credentials';
  if (!hasUrl && !hasAnon) reason = 'missing_url_and_anon_key';
  else if (!hasUrl) reason = 'missing_url';
  else if (!hasAnon) reason = 'missing_anon_key';
  // Never partially leak credentials when disabled.
  return { enabled: false, url: null, anonKey: null, reason, proxied: false };
}

function resetSupabaseClientForTests() {
  client = null;
  sanitizedLogged = false;
}

/** Inject a fake Supabase client for unit tests (avoids network). */
function setSupabaseClientForTests(fakeClient) {
  client = fakeClient;
}

module.exports = {
  getSupabase,
  isSupabaseEnabled,
  isPublicSupabaseEnabled,
  getSupabaseConfig,
  getPublicSupabaseConfig,
  getBrowserSupabaseUrl,
  supabaseBrowserProxyPath,
  isSupabaseBrowserProxyEnabled,
  resolvePublicSiteOrigin,
  rewriteSupabaseProxyLocation,
  resolveSupabaseCredentials,
  resetSupabaseClientForTests,
  setSupabaseClientForTests,
  // exposed for unit tests
  extractHttpsUrl,
  extractSecretValue,
  looksLikePublishableOrAnonKey,
  looksLikeServiceRoleKey,
  acceptExplicitAnonKey,
  decodeJwtPayload,
  jwtRole,
};
