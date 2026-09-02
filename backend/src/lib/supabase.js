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
      process.env.SUPABASE_PROJECT_URL
    ),
    anonKey: firstNonEmpty(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      process.env.SUPABASE_ANON_KEY,
      process.env.PUBLIC_SUPABASE_ANON_KEY,
      process.env.SUPABASE_KEY,
      process.env.SUPABASE_PUBLIC_KEY
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
  if (!url || !/^https?:\/\//i.test(url)) return false;
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

function getPublicSupabaseConfig() {
  const { url, anonKey } = getSupabaseConfig();
  if (!isPublicSupabaseEnabled()) {
    return { enabled: false, url: null, anonKey: null };
  }
  return { enabled: true, url, anonKey };
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
  resetSupabaseClientForTests,
};
