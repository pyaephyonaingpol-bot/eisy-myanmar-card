const { createClient } = require('@supabase/supabase-js');

let client = null;

function getSupabaseConfig() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  };
}

function isSupabaseEnabled() {
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) return false;
  if (anonKey.includes('...')) {
    console.warn('[supabase] Anon key appears truncated — set the full NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');
    return false;
  }
  return true;
}

function getSupabase() {
  if (!isSupabaseEnabled()) return null;
  if (!client) {
    const { url, anonKey, serviceKey } = getSupabaseConfig();
    const key = serviceKey || anonKey;
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    console.log('[supabase] Client initialized');
  }
  return client;
}

function getPublicSupabaseConfig() {
  const { url, anonKey } = getSupabaseConfig();
  if (!isSupabaseEnabled()) {
    return { enabled: false, url: null, anonKey: null };
  }
  return { enabled: true, url, anonKey };
}

module.exports = {
  getSupabase,
  isSupabaseEnabled,
  getSupabaseConfig,
  getPublicSupabaseConfig,
};
