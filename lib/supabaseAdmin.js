/**
 * Shared Supabase admin (service-role) client for server-side pool operations.
 * Works from Next.js route handlers and Express services.
 */
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

function getSupabaseAdminConfig() {
  return {
    url: firstNonEmpty(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_URL,
      process.env.PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_PROJECT_URL
    ),
    serviceKey: firstNonEmpty(
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      process.env.SUPABASE_SERVICE_KEY,
      process.env.SUPABASE_SECRET_KEY
    ),
  };
}

function isSupabaseAdminEnabled() {
  const { url, serviceKey } = getSupabaseAdminConfig();
  return Boolean(url && isUsableSecret(serviceKey));
}

function getSupabaseAdmin() {
  if (!isSupabaseAdminEnabled()) {
    const err = new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.'
    );
    err.code = 'SUPABASE_NOT_CONFIGURED';
    throw err;
  }

  if (!client) {
    const { url, serviceKey } = getSupabaseAdminConfig();
    client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  return client;
}

function resetSupabaseAdminForTests() {
  client = null;
}

module.exports = {
  getSupabaseAdmin,
  isSupabaseAdminEnabled,
  getSupabaseAdminConfig,
  resetSupabaseAdminForTests,
};
