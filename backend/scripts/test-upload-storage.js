#!/usr/bin/env node
/**
 * Upload storage helpers — local fallback + Supabase public URL builder.
 * Run: node backend/scripts/test-upload-storage.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const SUPABASE_ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_UPLOAD_STORAGE',
  'SUPABASE_UPLOAD_BUCKET',
];

function snapshotEnv(keys) {
  const snap = {};
  for (const key of keys) snap[key] = process.env[key];
  return snap;
}

function restoreEnv(snap) {
  for (const [key, value] of Object.entries(snap)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function main() {
  const snap = snapshotEnv(SUPABASE_ENV_KEYS);

  console.log('\n== buildPublicStorageUrl ==');
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  const {
    buildPublicStorageUrl,
    isUploadStorageEnabled,
    persistBuffer,
  } = require('../src/services/uploadStorageService');
  const { resetSupabaseClientForTests } = require('../src/lib/supabase');

  assert.strictEqual(
    buildPublicStorageUrl('deposits/deposit-123.jpg'),
    'https://example.supabase.co/storage/v1/object/public/uploads/deposits/deposit-123.jpg'
  );
  console.log('ok');

  console.log('\n== isUploadStorageEnabled ==');
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  resetSupabaseClientForTests();
  assert.strictEqual(isUploadStorageEnabled(), false);

  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  resetSupabaseClientForTests();
  assert.strictEqual(isUploadStorageEnabled(), true);

  process.env.SUPABASE_UPLOAD_STORAGE = 'false';
  assert.strictEqual(isUploadStorageEnabled(), false);
  console.log('ok');

  console.log('\n== local disk fallback ==');
  process.env.SUPABASE_UPLOAD_STORAGE = 'false';
  resetSupabaseClientForTests();
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const saved = await persistBuffer({
    category: 'deposits',
    buffer: tinyPng,
    mimeType: 'image/png',
    originalName: 'proof.png',
    prefix: 'deposit',
  });
  assert.strictEqual(saved.storage, 'local');
  assert.ok(saved.publicUrl.startsWith('/uploads/deposits/deposit-'));
  assert.ok(saved.publicUrl.endsWith('.png'));
  console.log('ok');

  restoreEnv(snap);
  resetSupabaseClientForTests();
  console.log('\nUpload storage checks passed.');
}

main().catch((err) => {
  console.error('\nUpload storage checks FAILED:', err);
  process.exit(1);
});
