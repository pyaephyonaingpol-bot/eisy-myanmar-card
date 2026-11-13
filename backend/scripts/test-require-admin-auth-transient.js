#!/usr/bin/env node
/**
 * requireAdminAuth maps transient Turso failures to 503 (not opaque 500).
 * Run: node backend/scripts/test-require-admin-auth-transient.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'test-admin-key-for-transient-auth';

const UserSession = require('../src/models/UserSession');
const { requireAdminAuth } = require('../src/middleware/auth');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function main() {
  const original = UserSession.findByToken;
  let calls = 0;
  UserSession.findByToken = async () => {
    calls += 1;
    const err = new Error('fetch failed: timeout connecting to Turso');
    throw err;
  };

  try {
    const req = {
      headers: { authorization: 'Bearer fake-admin-token' },
    };
    const res = mockRes();
    let nextCalled = false;
    await requireAdminAuth(req, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(res.body.code, 'ADMIN_AUTH_UNAVAILABLE');
    assert.ok(calls >= 2, 'retries once on transient Turso failure');
    console.log('test-require-admin-auth-transient: OK', res.body);
  } finally {
    UserSession.findByToken = original;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
