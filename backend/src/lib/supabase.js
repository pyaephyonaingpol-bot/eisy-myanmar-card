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

function looksLikePublishableOrAnonKey(value) {
  const key = String(value || '').trim();
  if (!key || key.includes('...')) return false;
  if (/^sb_publishable_/i.test(key)) return true;
  if (/^eyJ/.test(key) && key.length >= 80) return true;
  // Legacy JWT anon keys are long; short placeholders are unusable.
  return key.length >= 40 && !/^sb_secret_/i.test(key) && !/service_role/i.test(key);
}

function looksLikeServiceRoleKey(value) {
  const key = String(value || '').trim();
  if (!key || key.includes('...')) return false;
  if (/^sb_secret_/i.test(key)) return true;
  if (/service_role/i.test(key)) return true;
  if (/^eyJ/.test(key) && key.length >= 80) return true;
  return key.length >= 40;
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
      if (found && looksLikePublishableOrAnonKey(found)) anonKey = found;
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
    if (looksLikePublishableOrAnonKey(direct)) anonKey = direct;
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
  return Boolean(url && /^https?:\/\//i.test(url) && looksLikePublishableOrAnonKey(anonKey));
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
  sanitizedLogged = false;
}

module.exports = {
  getSupabase,
  isSupabaseEnabled,
  isPublicSupabaseEnabled,
  getSupabaseConfig,
  getPublicSupabaseConfig,
  resolveSupabaseCredentials,
  resetSupabaseClientForTests,
  // exposed for unit tests
  extractHttpsUrl,
  extractSecretValue,
  looksLikePublishableOrAnonKey,
  looksLikeServiceRoleKey,
};
