/* Generated at build/deploy time by backend/scripts/write-public-supabase-config.js.
   Bakes NEXT_PUBLIC_SUPABASE_* into a static file so Google Sign-In works even when
   the serverless /api/config/supabase route cannot read those env vars at runtime. */
window.__EISY_SUPABASE_PUBLIC__ = Object.freeze({
  enabled: false,
  url: null,
  anonKey: null,
  reason: "missing_url_and_anon_key",
  generatedAt: null,
});
