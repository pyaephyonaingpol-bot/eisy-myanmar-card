'use strict';

/**
 * Unit tests for Kripicard auth header building + failure classification.
 * Does not require a live API key (optional live probe when KRIPICARD_API_KEY is set).
 */

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const {
  buildAuthHeaders,
  classifyKripicardAuthFailure,
  probeKripicardApiAuth,
} = require(path.join(ROOT, 'lib/kripicard.js'));

function section(title) {
  console.log(`\n== ${title} ==`);
}

section('buildAuthHeaders defaults');
{
  const headers = buildAuthHeaders('abc123');
  assert.strictEqual(headers.Authorization, 'Bearer abc123');
  assert.strictEqual(headers['X-API-Key'], 'abc123');
  assert.strictEqual(headers['Content-Type'], 'application/json');
  assert.strictEqual(headers.Accept, 'application/json');
}

section('buildAuthHeaders can omit Content-Type for GET');
{
  const headers = buildAuthHeaders('abc123', { includeContentType: false });
  assert.strictEqual(headers['Content-Type'], undefined);
  assert.strictEqual(headers.Authorization, 'Bearer abc123');
}

section('buildAuthHeaders KRIPICARD_AUTH_HEADERS=0 → body-only style');
{
  const prev = process.env.KRIPICARD_AUTH_HEADERS;
  process.env.KRIPICARD_AUTH_HEADERS = '0';
  const headers = buildAuthHeaders('abc123');
  assert.strictEqual(headers.Authorization, undefined);
  assert.strictEqual(headers['X-API-Key'], undefined);
  assert.strictEqual(headers['Content-Type'], 'application/json');
  if (prev === undefined) delete process.env.KRIPICARD_AUTH_HEADERS;
  else process.env.KRIPICARD_AUTH_HEADERS = prev;
}

section('classifyKripicardAuthFailure');
{
  const missing = classifyKripicardAuthFailure(401, { success: false, message: 'Unauthorized. API Key is missing.' });
  assert.strictEqual(missing.kind, 'api_key_missing');
  assert.strictEqual(missing.authRecognized, false);

  const invalid = classifyKripicardAuthFailure(401, { success: false, message: 'Unauthorized. Invalid API Key.' });
  assert.strictEqual(invalid.kind, 'api_key_invalid');
  assert.strictEqual(invalid.authRecognized, false);

  const disabled = classifyKripicardAuthFailure(403, {
    success: false,
    code: 'API_ACCESS_DISABLED',
    message: 'API access is disabled for this account. Please contact support.',
  });
  assert.strictEqual(disabled.kind, 'api_access_disabled');
  assert.strictEqual(disabled.authRecognized, true);
  assert.strictEqual(disabled.providerCode, 'API_ACCESS_DISABLED');
}

section('hubRequest always places api_key last in payload (source check)');
{
  const api = require('fs').readFileSync(path.join(ROOT, 'lib/kripicardHubApi.js'), 'utf8');
  assert.ok(api.includes('api_key: apiKey'), 'hubRequest includes api_key');
  assert.ok(
    api.includes('const payload = { ...(query || {}), ...(body || {}), api_key: apiKey }'),
    'api_key must override caller-supplied fields'
  );
}

async function maybeLiveProbe() {
  const key = String(process.env.KRIPICARD_API_KEY || '').trim();
  if (!key || key.includes('...')) {
    console.log('\n(skip live probe — KRIPICARD_API_KEY not set)');
    return;
  }
  section('live probeKripicardApiAuth');
  const probe = await probeKripicardApiAuth({ timeoutMs: 15000 });
  console.log(JSON.stringify({
    ok: probe.ok,
    diagnosis: probe.diagnosis,
    attempts: probe.attempts.map((a) => ({
      label: a.label,
      status: a.status,
      kind: a.kind,
      authRecognized: a.authRecognized,
    })),
  }, null, 2));
  assert.ok(probe.diagnosis, 'diagnosis present');
  assert.ok(probe.attempts.length >= 1, 'at least one attempt');
  // A recognized-but-disabled key is still a valid auth-format outcome.
  if (probe.diagnosis.kind === 'api_access_disabled') {
    assert.strictEqual(probe.diagnosis.authRecognized, true);
  }
}

maybeLiveProbe()
  .then(() => {
    console.log('\nok\n\nKripicard auth headers + classification — ok');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
