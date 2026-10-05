#!/usr/bin/env node
'use strict';

/**
 * Supabase access-token verification.
 * ES256 Google tokens must succeed even when an HS256 JWT secret is configured.
 * Run: node backend/scripts/test-supabase-jwt.js
 */
const assert = require('assert');
const crypto = require('crypto');

const { setSupabaseClientForTests, resetSupabaseClientForTests } = require('../src/lib/supabase');
const {
  verifySupabaseJwtLocally,
  setSupabaseJwksForTests,
  resetSupabaseJwtForTests,
} = require('../src/lib/supabaseJwt');
const { verifySupabaseAccessToken } = require('../src/services/authService');

function b64url(value) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return buf.toString('base64url');
}

function signHs256(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest();
  return `${data}.${b64url(sig)}`;
}

function signEs256(payload, privateKey, kid) {
  const header = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = crypto.sign('sha256', Buffer.from(data), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${data}.${b64url(sig)}`;
}

async function main() {
  const secret = 'test-hs256-secret';
  const project = 'https://example.supabase.co';
  const jwksUrl = `${project}/auth/v1/.well-known/jwks.json`;
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'test-ec-1';
  jwk.alg = 'ES256';
  jwk.use = 'sig';

  const future = Math.floor(Date.now() / 1000) + 3600;
  const payload = {
    sub: 'user-es256',
    email: 'google.user@example.com',
    exp: future,
    user_metadata: { full_name: 'Google User' },
  };

  console.log('== ES256 verifies with JWKS while an HS256 secret is set ==');
  setSupabaseJwksForTests([jwk]);
  const esToken = signEs256(payload, privateKey, jwk.kid);
  const esUser = await verifySupabaseJwtLocally(esToken, { jwtSecret: secret, jwksUrl });
  assert.strictEqual(esUser.id, 'user-es256');
  assert.strictEqual(esUser.email, 'google.user@example.com');
  assert.strictEqual(esUser.user_metadata.full_name, 'Google User');
  console.log('ok');

  console.log('== HS256 verifies only with the matching secret ==');
  const hsPayload = { ...payload, sub: 'user-hs256', email: 'hs@example.com' };
  const hsToken = signHs256(hsPayload, secret);
  const hsUser = await verifySupabaseJwtLocally(hsToken, { jwtSecret: secret, jwksUrl });
  assert.strictEqual(hsUser.id, 'user-hs256');
  const wrongSecret = await verifySupabaseJwtLocally(hsToken, { jwtSecret: 'other-secret', jwksUrl });
  assert.strictEqual(wrongSecret, null, 'bad HMAC falls through instead of throwing');
  console.log('ok');

  console.log('== Bad ES256 signature falls through; expired token throws ==');
  const junk = `${esToken.slice(0, esToken.lastIndexOf('.'))}.${b64url(Buffer.alloc(64, 7))}`;
  const bad = await verifySupabaseJwtLocally(junk, { jwtSecret: secret, jwksUrl });
  assert.strictEqual(bad, null);
  const expired = signEs256({ ...payload, exp: Math.floor(Date.now() / 1000) - 120 }, privateKey, jwk.kid);
  let expiredErr = null;
  try {
    await verifySupabaseJwtLocally(expired, { jwtSecret: secret, jwksUrl });
  } catch (err) {
    expiredErr = err;
  }
  assert.strictEqual(expiredErr && expiredErr.code, 'GOOGLE_TOKEN_EXPIRED');
  const foreign = signEs256(
    { ...payload, iss: 'https://other.supabase.co/auth/v1' },
    privateKey,
    jwk.kid
  );
  let issuerErr = null;
  try {
    await verifySupabaseJwtLocally(foreign, { jwtSecret: secret, jwksUrl });
  } catch (err) {
    issuerErr = err;
  }
  assert.strictEqual(issuerErr && issuerErr.code, 'GOOGLE_TOKEN_INVALID');
  console.log('ok');

  console.log('== auth service does not reject ES256 just because the HMAC secret is set ==');
  process.env.SUPABASE_JWT_SECRET = secret;
  process.env.NEXT_PUBLIC_SUPABASE_URL = project;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.signaturepaddingpaddingpadding';
  resetSupabaseClientForTests();
  setSupabaseJwksForTests([]);
  let remoteCalls = 0;
  setSupabaseClientForTests({
    auth: {
      async getUser(token) {
        remoteCalls += 1;
        assert.strictEqual(token, junk);
        return {
          data: {
            user: {
              id: 'remote-user',
              email: 'remote@example.com',
              user_metadata: {},
            },
          },
          error: null,
        };
      },
    },
  });
  const remoteUser = await verifySupabaseAccessToken(junk);
  assert.strictEqual(remoteCalls, 1, 'invalid ES256 uses auth.getUser');
  assert.strictEqual(remoteUser.id, 'remote-user');

  remoteCalls = 0;
  setSupabaseJwksForTests([jwk]);
  const localOnly = await verifySupabaseAccessToken(esToken);
  assert.strictEqual(remoteCalls, 0, 'valid ES256 does not call auth.getUser');
  assert.strictEqual(localOnly.email, 'google.user@example.com');
  console.log('ok');

  resetSupabaseJwtForTests();
  resetSupabaseClientForTests();
  delete process.env.SUPABASE_JWT_SECRET;
  console.log('\nSupabase JWT checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
