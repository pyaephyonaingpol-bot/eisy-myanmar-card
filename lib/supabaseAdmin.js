/**
 * Shared Supabase admin (service-role) client for server-side pool operations.
 * Works from Next.js route handlers and Express services.
 *
 * Credential resolution (including recovery of scrambled KEY=value secret pastes)
 * is delegated to backend/src/lib/supabase.js so Next + Express stay in sync.
 */
const { createClient } = require('@supabase/supabase-js');

let client = null;

function readResolvedConfig() {
  // Prefer the shared sanitizing resolver used by the Express backend + browser config API.
  const {
    getSupabaseConfig,
  } = require('../backend/src/lib/supabase');
  const cfg = getSupabaseConfig();
  return {
    url: cfg.url || '',
    serviceKey: cfg.serviceKey || '',
  };
}

function isSupabaseAdminEnabled() {
  const { url, serviceKey } = readResolvedConfig();
  return Boolean(url && /^https?:\/\//i.test(url) && serviceKey && !serviceKey.includes('...'));
}

function getSupabaseAdminConfig() {
  return readResolvedConfig();
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
    const { url, serviceKey } = readResolvedConfig();
    client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  return client;
}

function resetSupabaseAdminForTests() {
  client = null;
  try {
    const { resetSupabaseClientForTests } = require('../backend/src/lib/supabase');
    resetSupabaseClientForTests();
  } catch (_) {
    /* ignore */
  }
}

module.exports = {
  getSupabaseAdmin,
  isSupabaseAdminEnabled,
  getSupabaseAdminConfig,
  resetSupabaseAdminForTests,
};
