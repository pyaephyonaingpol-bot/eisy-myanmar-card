/**
 * Resolve a process.env value from the first non-empty alias.
 * Strips accidental "KEY = value" assignment prefixes (common Cursor/Vercel paste mistakes).
 *
 * Alias groups mirror Vercel / backend/.env.example naming (preferred name listed first).
 */
function stripAssignmentPrefix(raw) {
  const text = String(raw || '').trim();
  const match = text.match(/^[A-Z][A-Z0-9_]*\s*=\s*(.+)$/s);
  return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : text.replace(/^['"]|['"]$/g, '');
}

/**
 * HTTP header values must be ByteStrings (Latin-1). Strip BOM, whitespace, control
 * chars, and non-ASCII so TronWeb/axios/fetch do not throw on TRON-PRO-API-KEY.
 */
function sanitizeAsciiHeaderValue(raw) {
  if (raw == null) return '';
  let s = stripAssignmentPrefix(raw);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  s = s.trim();
  s = s.replace(/[\u0000-\u001f\u007f-\u009f\uFEFF]/g, '');
  s = s.replace(/[^\x20-\x7E]/g, '');
  return s.trim();
}

function sanitizeHttpHeaderMap(extra = {}) {
  const out = {};
  if (!extra || typeof extra !== 'object') return out;
  for (const [key, value] of Object.entries(extra)) {
    if (value == null) continue;
    const name = sanitizeAsciiHeaderValue(key);
    if (!name) continue;
    const cleaned = sanitizeAsciiHeaderValue(value);
    if (cleaned) out[name] = cleaned;
  }
  return out;
}

function firstEnv(...names) {
  for (const name of names) {
    const raw = process.env[name];
    if (raw == null) continue;
    const value = stripAssignmentPrefix(raw);
    if (value) return value;
  }
  return '';
}

function envIsSet(...names) {
  return Boolean(firstEnv(...names));
}

/** Vercel-first alias groups — any one name in a group satisfies runtime checks. */
const ENV_ALIAS_GROUPS = [
  ['TRON_PRO_API_KEY', 'TRONGRID_API_KEY', 'TRON_API_KEY'],
  ['TRON_FULL_HOST', 'TRONGRID_FULL_HOST'],
  ['DATABASE_URL', 'TURSO_DATABASE_URL', 'LIBSQL_URL'],
  ['DATABASE_AUTH_TOKEN', 'TURSO_AUTH_TOKEN', 'LIBSQL_AUTH_TOKEN'],
  ['MASTER_PRIVATE_KEY', 'MASTER_WALLET_PRIVATE_KEY', 'TRON_MASTER_PRIVATE_KEY'],
  ['MASTER_WALLET_ADDRESS', 'TRON_MASTER_WALLET', 'MASTER_TRON_ADDRESS', 'TRON_MASTER_ADDRESS'],
  ['CENTRAL_WALLET_ADDRESS', 'SWEEP_DESTINATION_ADDRESS', 'TRON_CENTRAL_WALLET'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET_KEY'],
  ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'],
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY'],
  ['SENSITIVE_DATA_ENCRYPTION_KEY', 'FIELD_ENCRYPTION_KEY'],
  ['AUTH_SECRET', 'JWT_SECRET'],
  ['BINANCE_API_KEY', 'BINANCE_PAY_API_KEY'],
  ['BINANCE_SECRET_KEY', 'BINANCE_PAY_API_SECRET'],
  ['BINANCE_MERCHANT_ID', 'BINANCE_PAY_MERCHANT_ID'],
];

/**
 * After .env files load, copy each resolved alias onto empty sibling keys so
 * code paths that read TRONGRID_* or DATABASE_* still work when Vercel only sets TRON_API_KEY / TURSO_*.
 */
function normalizePlatformEnvAliases() {
  for (const group of ENV_ALIAS_GROUPS) {
    let value = firstEnv(...group);
    if (!value) continue;
    if (group[0] === 'TRON_PRO_API_KEY' || group.includes('TRONGRID_API_KEY')) {
      value = sanitizeAsciiHeaderValue(value);
      if (!value) continue;
    }
    if (group[0] === 'TRON_FULL_HOST' || group.includes('TRONGRID_FULL_HOST')) {
      value = sanitizeAsciiHeaderValue(value) || value;
    }
    for (const name of group) {
      if (!String(process.env[name] ?? '').trim()) {
        process.env[name] = value;
      }
    }
  }
}

function tronApiKey() {
  return sanitizeAsciiHeaderValue(
    firstEnv('TRON_PRO_API_KEY', 'TRONGRID_API_KEY', 'TRON_API_KEY')
  );
}

function tronFullHost() {
  const host = sanitizeAsciiHeaderValue(
    firstEnv('TRON_FULL_HOST', 'TRONGRID_FULL_HOST')
  );
  return host || 'https://api.trongrid.io';
}

/** TronWeb / TronGrid REST — sends TRON-PRO-API-KEY when any TRON_* API key alias is set. */
function tronGridApiKeyHeaders() {
  const headers = {};
  const apiKey = tronApiKey();
  if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;
  return headers;
}

function tronGridRequestHeaders(extra = {}) {
  return {
    Accept: 'application/json',
    ...tronGridApiKeyHeaders(),
    ...sanitizeHttpHeaderMap(extra),
  };
}

function databaseUrl() {
  return firstEnv('DATABASE_URL', 'TURSO_DATABASE_URL', 'LIBSQL_URL');
}

function databaseAuthToken() {
  return firstEnv('DATABASE_AUTH_TOKEN', 'TURSO_AUTH_TOKEN', 'LIBSQL_AUTH_TOKEN');
}

module.exports = {
  stripAssignmentPrefix,
  sanitizeAsciiHeaderValue,
  sanitizeHttpHeaderMap,
  firstEnv,
  envIsSet,
  ENV_ALIAS_GROUPS,
  normalizePlatformEnvAliases,
  tronApiKey,
  tronFullHost,
  tronGridApiKeyHeaders,
  tronGridRequestHeaders,
  databaseUrl,
  databaseAuthToken,
};
