#!/usr/bin/env node
/**
 * Supabase env sanitization + public config exposure for the browser bridge.
 * Run: node backend/scripts/test-supabase-env-config.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const SUPABASE_ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
  'PUBLIC_SUPABASE_URL',
  'SUPABASE_PROJECT_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_ANON_KEY',
  'PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_KEY',
  'SUPABASE_PUBLIC_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_KEY',
  'SUPABASE_SECRET_KEY',
];

function snapshotEnv(keys) {
  const out = {};
  for (const key of keys) out[key] = process.env[key];
  return out;
}

function restoreEnv(snap) {
  for (const [key, value] of Object.entries(snap)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearSupabaseEnv() {
  for (const key of Object.keys(process.env)) {
    if (/supabase/i.test(key) || SUPABASE_ENV_KEYS.includes(key)) {
      delete process.env[key];
    }
  }
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

function main() {
  const snap = snapshotEnv(SUPABASE_ENV_KEYS);
  const {
    isSupabaseEnabled,
    isPublicSupabaseEnabled,
    getSupabaseConfig,
    getPublicSupabaseConfig,
    extractHttpsUrl,
    resetSupabaseClientForTests,
  } = require('../src/lib/supabase');

  try {
    section('helper: extractHttpsUrl');
    assert.strictEqual(
      extractHttpsUrl('NEXT_PUBLIC_SUPABASE_URL = [https://abc.supabase.co](https://abc.supabase.co)'),
      'https://abc.supabase.co'
    );
    assert.strictEqual(
      extractHttpsUrl('https://abc.supabase.co/'),
      'https://abc.supabase.co'
    );
    console.log('ok');

    section('clean env enables server + browser config');
    clearSupabaseEnv();
    resetSupabaseClientForTests();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_test_anon_key_value_123456';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture_service_role_key_test_value_1234567890';
    assert.strictEqual(isSupabaseEnabled(), true);
    assert.strictEqual(isPublicSupabaseEnabled(), true);
    const pub = getPublicSupabaseConfig();
    assert.strictEqual(pub.enabled, true);
    assert.strictEqual(pub.url, 'https://example.supabase.co');
    assert.ok(pub.anonKey.startsWith('sb_publishable_'));
    console.log('ok');

    section('scrambled Cursor-style secrets are recovered');
    clearSupabaseEnv();
    resetSupabaseClientForTests();
    // Simulate the mis-paste pattern (KEY=value text / swapped slots) with
    // synthetic fixture values — avoid live Supabase secret-key shapes so scanners stay quiet.
    process.env.NEXT_PUBLIC_SUPABASE_URL =
      'NEXT_PUBLIC_SUPABASE_ANON_KEY = sb_publishable_fixture_anon_key_00123456789';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
      'SUPABASE_SERVICE_ROLE_KEY = fixture_service_role_key_abcdefghijklmnopqrstuv';
    process.env.SUPABASE_SERVICE_ROLE_KEY =
      'NEXT_PUBLIC_SUPABASE_URL = [https://fixture-project.supabase.co](https://fixture-project.supabase.co)';

    const cfg = getSupabaseConfig();
    assert.strictEqual(cfg.url, 'https://fixture-project.supabase.co');
    assert.strictEqual(cfg.anonKey, 'sb_publishable_fixture_anon_key_00123456789');
    assert.strictEqual(cfg.serviceKey, 'fixture_service_role_key_abcdefghijklmnopqrstuv');
    assert.strictEqual(isSupabaseEnabled(), true);
    assert.strictEqual(isPublicSupabaseEnabled(), true);
    const publicCfg = getPublicSupabaseConfig();
    assert.strictEqual(publicCfg.enabled, true);
    assert.strictEqual(publicCfg.url, 'https://fixture-project.supabase.co');
    assert.strictEqual(publicCfg.anonKey, 'sb_publishable_fixture_anon_key_00123456789');
    console.log('ok');

    section('truncated anon key alone does not enable public config');
    clearSupabaseEnv();
    resetSupabaseClientForTests();
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'truncated-anon-key...';
    assert.strictEqual(isPublicSupabaseEnabled(), false);
    assert.deepStrictEqual(getPublicSupabaseConfig(), {
      enabled: false,
      url: null,
      anonKey: null,
    });
    console.log('ok');

    section('frontend bridge validates https url + anonKey');
    const bridgeSrc = require('fs').readFileSync(
      path.join(__dirname, '../public/src/services/supabaseService.js'),
      'utf8'
    );
    assert.ok(bridgeSrc.includes("fetch('/api/config/supabase'"));
    assert.ok(bridgeSrc.includes('/^https?:\\/\\//i.test(url)'));
    assert.ok(bridgeSrc.includes('createClient(url, anonKey'));
    console.log('ok');
  } finally {
    restoreEnv(snap);
    resetSupabaseClientForTests();
  }

  console.log('\nSupabase env config tests — ok');
}

main();
