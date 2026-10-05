/**
 * Local verification for Supabase Auth access tokens.
 * Current projects sign with ES256 (JWKS). Older projects used HS256.
 * A configured HS256 secret must not reject ES256 Google tokens.
 */
const crypto = require('crypto');

const JWKS_TTL_MS = 10 * 60 * 1000;
const JWKS_FETCH_MS = 2000;

let jwksCache = { url: '', keys: [], fetchedAt: 0 };
/** @type {Array<object> | null} */
let testKeys = null;

function decodePart(part) {
  try {
    return JSON.parse(Buffer.from(String(part || ''), 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function mapUser(payload) {
  return {
    id: payload.sub,
    email: payload.email || payload.user_metadata?.email || null,
    user_metadata: payload.user_metadata || {},
    app_metadata: payload.app_metadata || {},
  };
}

function assertUsablePayload(payload, jwksUrl) {
  if (!payload?.sub) {
    const err = new Error('Supabase token missing subject');
    err.code = 'GOOGLE_TOKEN_INVALID';
    throw err;
  }
  const exp = Number(payload.exp);
  if (Number.isFinite(exp) && Date.now() / 1000 > exp + 30) {
    const err = new Error('Supabase access token expired');
    err.code = 'GOOGLE_TOKEN_EXPIRED';
    throw err;
  }
  if (jwksUrl && payload.iss) {
    try {
      const origin = new URL(jwksUrl).origin;
      if (!String(payload.iss).startsWith(origin)) {
        const err = new Error('Supabase token issuer mismatch');
        err.code = 'GOOGLE_TOKEN_INVALID';
        throw err;
      }
    } catch (err) {
      if (err.code === 'GOOGLE_TOKEN_INVALID') throw err;
    }
  }
}

function hmacMatches(parts, secret) {
  const [headerB64, payloadB64, sigB64] = parts;
  let sigBuf;
  try {
    sigBuf = Buffer.from(sigB64, 'base64url');
  } catch {
    return false;
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  if (sigBuf.length !== expected.length) return false;
  return crypto.timingSafeEqual(sigBuf, expected);
}

function es256Matches(parts, jwk) {
  if (!jwk || (jwk.kty && jwk.kty !== 'EC')) return false;
  const [headerB64, payloadB64, sigB64] = parts;
  let sigBuf;
  try {
    sigBuf = Buffer.from(sigB64, 'base64url');
  } catch {
    return false;
  }
  if (sigBuf.length !== 64) return false;
  try {
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    return crypto.verify(
      'sha256',
      Buffer.from(`${headerB64}.${payloadB64}`),
      { key, dsaEncoding: 'ieee-p1363' },
      sigBuf
    );
  } catch {
    return false;
  }
}

function candidateKeys(keys, kid) {
  const list = Array.isArray(keys) ? keys : [];
  const ec = list.filter((key) => key && (key.kty === 'EC' || key.alg === 'ES256'));
  if (!kid) return ec;
  const matched = ec.filter((key) => key.kid === kid);
  return matched.length ? matched : [];
}

async function loadJwks(jwksUrl) {
  if (Array.isArray(testKeys)) return testKeys;
  if (!jwksUrl) return [];
  const now = Date.now();
  if (jwksCache.url === jwksUrl && jwksCache.keys.length && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JWKS_FETCH_MS);
  try {
    const res = await fetch(jwksUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return jwksCache.url === jwksUrl ? jwksCache.keys : [];
    const body = await res.json().catch(() => ({}));
    const keys = Array.isArray(body.keys) ? body.keys : [];
    jwksCache = { url: jwksUrl, keys, fetchedAt: Date.now() };
    return keys;
  } catch {
    return jwksCache.url === jwksUrl ? jwksCache.keys : [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify a Supabase JWT locally.
 * Returns the auth user, or null when the token should be checked with auth.getUser.
 * Throws GOOGLE_TOKEN_EXPIRED / GOOGLE_TOKEN_INVALID only after a signature matches.
 */
async function verifySupabaseJwtLocally(token, { jwtSecret = '', jwksUrl = '' } = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  if (!header || !payload) return null;

  const alg = String(header.alg || '');
  let signed = false;
  if (alg === 'HS256') {
    if (!jwtSecret) return null;
    signed = hmacMatches(parts, jwtSecret);
  } else if (alg === 'ES256') {
    const keys = candidateKeys(await loadJwks(jwksUrl), header.kid);
    signed = keys.some((jwk) => es256Matches(parts, jwk));
  } else {
    return null;
  }
  if (!signed) return null;

  assertUsablePayload(payload, jwksUrl);
  return mapUser(payload);
}

function setSupabaseJwksForTests(keys) {
  testKeys = Array.isArray(keys) ? keys : [];
  jwksCache = { url: '', keys: [], fetchedAt: 0 };
}

function resetSupabaseJwtForTests() {
  testKeys = null;
  jwksCache = { url: '', keys: [], fetchedAt: 0 };
}

module.exports = {
  verifySupabaseJwtLocally,
  setSupabaseJwksForTests,
  resetSupabaseJwtForTests,
};
