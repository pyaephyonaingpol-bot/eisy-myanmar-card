require('./loadEnv');
const { createClient } = require('@supabase/supabase-js');

let client = null;

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function isUsableSecret(value) {
  const key = String(value || '').trim();
  return Boolean(key) && !key.includes('...');
}

function getSupabaseConfig() {
  return {
    url: firstNonEmpty(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_URL,
      process.env.PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_PROJECT_URL,
      process.env.VITE_SUPABASE_URL
    ),
    anonKey: firstNonEmpty(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      process.env.SUPABASE_ANON_KEY,
      process.env.PUBLIC_SUPABASE_ANON_KEY,
      process.env.SUPABASE_KEY,
      process.env.SUPABASE_PUBLIC_KEY,
      process.env.VITE_SUPABASE_ANON_KEY
    ),
    serviceKey: firstNonEmpty(
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      process.env.SUPABASE_SERVICE_KEY,
      process.env.SUPABASE_SECRET_KEY
    ),
  };
}

/**
 * Server-side client is enabled when a project URL plus either the
 * service-role key or a full anon key is present. Truncated placeholder
 * keys (containing "...") are treated as unset.
 */
function isSupabaseEnabled() {
  const { url, anonKey, serviceKey } = getSupabaseConfig();
  if (!url) return false;
  if (isUsableSecret(serviceKey) || isUsableSecret(anonKey)) return true;
  if ((anonKey && anonKey.includes('...')) || (serviceKey && serviceKey.includes('...'))) {
    console.warn('[supabase] Key appears truncated — set the full key in .env.local');
  }
  return false;
}

function isPublicSupabaseEnabled() {
  const { url, anonKey } = getSupabaseConfig();
  return Boolean(url && isUsableSecret(anonKey));
}

function getSupabase() {
  if (!isSupabaseEnabled()) return null;
  if (!client) {
    const { url, anonKey, serviceKey } = getSupabaseConfig();
    const key = isUsableSecret(serviceKey) ? serviceKey : anonKey;
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    console.log('[supabase] Client initialized');
  }
  return client;
}

function getSupabaseStatus() {
  const { url, anonKey, serviceKey } = getSupabaseConfig();
  let host = null;
  if (url) {
    try { host = new URL(url).host; } catch { host = 'invalid-url'; }
  }
  return {
    enabled: isSupabaseEnabled(),
    public_enabled: isPublicSupabaseEnabled(),
    project_host: host,
    has_service_role_key: isUsableSecret(serviceKey),
    has_anon_key: isUsableSecret(anonKey),
  };
}

function getPublicSupabaseConfig() {
  const { url, anonKey } = getSupabaseConfig();
  if (!isPublicSupabaseEnabled()) {
    return {
      enabled: false,
      url: null,
      anonKey: null,
      status: getSupabaseStatus(),
      message: 'Supabase sync is disabled — set NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY (and SUPABASE_SERVICE_ROLE_KEY for server dual-write)',
    };
  }
  return { enabled: true, url, anonKey, status: getSupabaseStatus() };
}

function resetSupabaseClientForTests() {
  client = null;
}

module.exports = {
  getSupabase,
  isSupabaseEnabled,
  isPublicSupabaseEnabled,
  getSupabaseConfig,
  getPublicSupabaseConfig,
  getSupabaseStatus,
  resetSupabaseClientForTests,
};
