#!/usr/bin/env node
'use strict';

/**
 * Unit test for Google OAuth → app session exchange.
 * Run: node backend/scripts/test-google-oauth-service.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config();

const assert = require('assert');
const { initDb, closeDb } = require('../src/db');
const { setSupabaseClientForTests, resetSupabaseClientForTests } = require('../src/lib/supabase');
const authService = require('../src/services/authService');
const User = require('../src/models/User');

async function main() {
  console.log('== loginWithGoogleOAuth verifies token & creates session ==');
  await initDb();

  const email = `google.oauth.${Date.now()}@example.com`;
  const fakeSupabaseUser = {
    id: 'supabase-google-user-1',
    email,
    user_metadata: { full_name: 'Google Tester', name: 'Google Tester' },
  };

  // Ensure public Supabase config checks pass even if env is empty in CI.
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNjAwMDAwMDAwLCJleHAiOjE5MDAwMDAwMDB9.signaturepaddingpaddingpadding';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE2MDAwMDAwMDAsImV4cCI6MTkwMDAwMDAwMH0.signaturepaddingpaddingpadding';

  resetSupabaseClientForTests();
  setSupabaseClientForTests({
    auth: {
      async getUser(token) {
        assert.strictEqual(token, 'valid-google-access-token');
        return { data: { user: fakeSupabaseUser }, error: null };
      },
    },
  });

  const result = await authService.loginWithGoogleOAuth({
    accessToken: 'valid-google-access-token',
    ipAddress: '127.0.0.1',
    deviceName: 'Test',
    devicePlatform: 'web',
  });

  assert.ok(result.sessionToken, 'sessionToken issued');
  assert.strictEqual(String(result.user.email).toLowerCase(), email.toLowerCase(), 'user email');
  assert.strictEqual(result.has_pin, false, 'new Google user has no PIN yet');
  assert.ok(!result.pin_token, 'no pin_token without PIN');
  assert.strictEqual(result.created, true, 'account created');

  const again = await authService.loginWithGoogleOAuth({
    accessToken: 'valid-google-access-token',
    ipAddress: '127.0.0.1',
    deviceName: 'Test',
    devicePlatform: 'web',
  });
  assert.ok(again.sessionToken, 'second login session');
  assert.strictEqual(again.created, false, 'existing user not recreated');
  assert.strictEqual(String(again.user.id), String(result.user.id), 'same user id');

  // Reject missing token
  let missingErr;
  try {
    await authService.loginWithGoogleOAuth({ accessToken: '' });
  } catch (err) {
    missingErr = err;
  }
  assert.ok(missingErr, 'rejects empty token');
  assert.strictEqual(missingErr.code, 'GOOGLE_TOKEN_REQUIRED');

  await closeDb().catch(() => {});
  resetSupabaseClientForTests();
  console.log('ok');
  console.log('\nGoogle OAuth service checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
