#!/usr/bin/env node
'use strict';

/**
 * Login / auth performance guards:
 * - async PBKDF2 on login critical path
 * - parallel session + recordLogin (no redundant User.findById)
 * - fire-and-forget login ledger + Supabase wallet ensure
 * - admin middleware uses JOIN (no second user SELECT / blocking touch)
 * - home /wallet prefers Turso (no awaited Supabase overlay)
 * - auth lookup indexes
 *
 * Run: node scripts/test-login-auth-perf.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function assertIncludes(haystack, needle, msg) {
  assert.ok(haystack.includes(needle), msg || `expected to include: ${needle}`);
}

async function main() {
  console.log('== Static wiring ==');
  const authSvc = read('src/services/authService.js');
  const adminAuth = read('src/services/adminAuthService.js');
  const cryptoSvc = read('src/services/cryptoService.js');
  const middleware = read('src/middleware/auth.js');
  const userRoute = read('src/routes/user.js');
  const adminJs = read('public/admin.js');
  const migration = read('migrations/057_login_auth_perf_indexes.sql');
  const sessionModel = read('src/models/UserSession.js');

  assertIncludes(cryptoSvc, 'verifyPinAsync', 'async PIN verify');
  assertIncludes(cryptoSvc, 'verifyPasswordAsync', 'async password verify');
  assertIncludes(cryptoSvc, 'promisify(crypto.pbkdf2)', 'async pbkdf2');

  assertIncludes(authSvc, 'finalizeLoginSession', 'shared login finalizer');
  assertIncludes(authSvc, 'Promise.all([', 'parallel session + recordLogin');
  assertIncludes(authSvc, 'verifyPinAsync', 'PIN login uses async verify');
  assertIncludes(authSvc, 'verifySupabaseAccessToken', 'local/timed Google token verify');
  assertIncludes(authSvc, 'logLoginEvent', 'fire-and-forget login ledger');
  const pinFn = authSvc.slice(authSvc.indexOf('async function loginWithPin'), authSvc.indexOf('async function verifyLoginOtp'));
  assertIncludes(pinFn, 'finalizeLoginSession', 'loginWithPin uses finalizeLoginSession');
  assert.ok(!pinFn.includes('User.findById'), 'loginWithPin must not re-SELECT user');
  const otpFn = authSvc.slice(authSvc.indexOf('async function verifyLoginOtp'), authSvc.indexOf('async function createSession'));
  assertIncludes(otpFn, 'finalizeLoginSession', 'verifyLoginOtp uses finalizeLoginSession');
  assert.ok(!otpFn.includes('User.findById'), 'verifyLoginOtp must not re-SELECT user');
  assert.ok(!authSvc.includes('Account could not be loaded after PIN verification'),
    'removed redundant post-PIN user lookup error path');

  assertIncludes(adminAuth, 'verifyPasswordAsync', 'admin async password verify');
  assertIncludes(adminAuth, 'Promise.all([', 'admin parallel session + recordLogin');
  const adminLoginFn = adminAuth.slice(
    adminAuth.indexOf('async function loginAdmin'),
    adminAuth.indexOf('async function bootstrapSuperAdmin') >= 0
      ? adminAuth.indexOf('async function bootstrapSuperAdmin')
      : adminAuth.indexOf('module.exports')
  );
  assert.ok(!adminLoginFn.includes('User.findById'), 'admin login must not re-fetch user');

  assertIncludes(middleware, 'shouldTouchSession(token)', 'admin touch throttled');
  assertIncludes(middleware, 'session.admin_role', 'admin auth uses JOIN fields');
  assert.ok(!/await User\.findById\(session\.user_id\)/.test(middleware),
    'admin middleware must not SELECT users again');

  assertIncludes(userRoute, "source: 'turso'", 'home wallet marks turso source');
  assertIncludes(userRoute, 'fetchFreshUserWalletRow', 'home wallet warms cache in background');
  assert.ok(
    !/else \{\s*balances = await overlayWalletPayloadFromSupabase\(req\.user\.id, localPayload\);/.test(userRoute),
    'default /wallet must not await Supabase overlay'
  );

  assertIncludes(adminJs, 'loadActiveTabData', 'admin loads active tab first');
  assertIncludes(adminJs, 'this.loadActiveTabData();\n        this.loadAll();', 'restore does not await loadAll');

  assertIncludes(sessionModel, 'Avoid a round-trip SELECT on the login hot path', 'session create skips SELECT');

  assertIncludes(migration, 'idx_user_sessions_token_active', 'session token index');
  assertIncludes(migration, 'idx_otp_email_purpose_created', 'otp login index');
  const authPatch = read('migrations/patches/applyUserAuthColumns.js');
  assertIncludes(authPatch, 'idx_users_email_lower', 'email lookup index in auth patch');
  console.log('ok');

  console.log('== PIN login timing + indexes ==');
  const dbFile = path.join(os.tmpdir(), `eisy-login-perf-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const { initDb, closeDb, getDb } = require('../src/db');
  const { resetSupabaseClientForTests } = require('../src/lib/supabase');
  resetSupabaseClientForTests();
  await initDb();

  const db = getDb();
  const idx = await db.all(
    `SELECT name FROM sqlite_master WHERE type='index' AND (
      name LIKE 'idx_users_email%' OR name LIKE 'idx_user_sessions%' OR name LIKE 'idx_otp%'
    )`
  );
  const names = idx.map((r) => r.name);
  assert.ok(names.includes('idx_users_email_lower'), `email index missing: ${names.join(',')}`);
  assert.ok(names.includes('idx_user_sessions_token_active'), 'session active index');
  assert.ok(names.includes('idx_otp_email_purpose_created'), 'otp created index');

  const User = require('../src/models/User');
  const { hashPinAsync, verifyPinAsync } = require('../src/services/cryptoService');
  const authService = require('../src/services/authService');

  const email = `login-perf-${Date.now()}@example.com`;
  const pin = '654321';
  const pinHash = await hashPinAsync(pin);
  assert.ok(await verifyPinAsync(pin, pinHash), 'async verify matches');

  const user = await User.create({
    name: 'Login Perf',
    phone: `09${String(Date.now()).slice(-8)}`,
    email,
    pinHash,
  });

  const t0 = Date.now();
  const result = await authService.loginWithPin({
    email,
    pin,
    ipAddress: '127.0.0.1',
    deviceName: 'perf-test',
    devicePlatform: 'node',
  });
  const elapsed = Date.now() - t0;
  assert.ok(result.sessionToken, 'session token');
  assert.strictEqual(result.user.email, email);
  assert.ok(result.pin_token, 'pin token');
  // Single-user local SQLite should be well under 1s even with PBKDF2.
  assert.ok(elapsed < 2000, `PIN login too slow: ${elapsed}ms`);
  console.log(`PIN login OK in ${elapsed}ms`);

  // Local JWT verify path (no Supabase network)
  const secret = 'test-supabase-jwt-secret-for-login-perf';
  process.env.SUPABASE_JWT_SECRET = secret;
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'google-user-1',
    email,
    exp: Math.floor(Date.now() / 1000) + 3600,
    user_metadata: { full_name: 'Login Perf' },
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  const jwt = `${header}.${payload}.${sig}`;

  // Force public supabase "enabled" enough for oauth guard — use dummy URL/anon if needed.
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4YW1wbGUiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTY0MDk5NTIwMCwiZXhwIjoxOTU2NTcxMjAwfQ.example';

  const { resetSupabaseClientForTests: resetSb } = require('../src/lib/supabase');
  resetSb();

  const g0 = Date.now();
  const google = await authService.loginWithGoogleOAuth({
    accessToken: jwt,
    ipAddress: '127.0.0.1',
    deviceName: 'perf-test',
    devicePlatform: 'node',
  });
  const gElapsed = Date.now() - g0;
  assert.ok(google.sessionToken, 'google session');
  assert.strictEqual(google.user.email, email);
  assert.ok(gElapsed < 1500, `Google local JWT login too slow: ${gElapsed}ms`);
  console.log(`Google local JWT login OK in ${gElapsed}ms`);

  await closeDb();
  try { fs.unlinkSync(dbFile); } catch (_) { /* ignore */ }
  console.log('Login auth performance — ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
