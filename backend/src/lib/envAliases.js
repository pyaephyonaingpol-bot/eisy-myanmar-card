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
  ['TRON_API_KEY', 'TRONGRID_API_KEY', 'TRON_PRO_API_KEY'],
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
    const value = firstEnv(...group);
    if (!value) continue;
    for (const name of group) {
      if (!String(process.env[name] ?? '').trim()) {
        process.env[name] = value;
      }
    }
  }
}

function tronApiKey() {
  return firstEnv('TRON_API_KEY', 'TRONGRID_API_KEY', 'TRON_PRO_API_KEY');
}

function tronFullHost() {
  return firstEnv('TRON_FULL_HOST', 'TRONGRID_FULL_HOST') || 'https://api.trongrid.io';
}

function databaseUrl() {
  return firstEnv('DATABASE_URL', 'TURSO_DATABASE_URL', 'LIBSQL_URL');
}

function databaseAuthToken() {
  return firstEnv('DATABASE_AUTH_TOKEN', 'TURSO_AUTH_TOKEN', 'LIBSQL_AUTH_TOKEN');
}

module.exports = {
  stripAssignmentPrefix,
  firstEnv,
  envIsSet,
  ENV_ALIAS_GROUPS,
  normalizePlatformEnvAliases,
  tronApiKey,
  tronFullHost,
  databaseUrl,
  databaseAuthToken,
};
