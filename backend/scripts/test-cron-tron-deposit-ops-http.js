#!/usr/bin/env node
'use strict';

/**
 * HTTP smoke for GET /api/cron/tron-deposit-ops (auth + JSON, dry-run sweep).
 * Run: node backend/scripts/test-cron-tron-deposit-ops-http.js
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { generateMnemonic } = require('@scure/bip39');
const { wordlist } = require('@scure/bip39/wordlists/english');

process.chdir(path.join(__dirname, '..'));

const dbFile = path.join(os.tmpdir(), `eisy-cron-http-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.NODE_ENV = 'test';
process.env.CRON_SECRET = 'cron-http-test-secret';
process.env.TRON_HD_MNEMONIC = generateMnemonic(wordlist, 128);
process.env.TRON_HD_ENABLED = 'true';
process.env.TRON_CRON_DRY_RUN = 'true';
process.env.MASTER_PRIVATE_KEY = 'a'.repeat(64);
process.env.MASTER_WALLET_ADDRESS = 'TXYZabcdefghijklmnopqrstuvwxyz12';
process.env.TRON_API_KEY = 'test-tron-api-key';

const { resetLoadEnvForTests } = require('../src/lib/loadEnv');
resetLoadEnvForTests();
require('../src/lib/loadEnv').loadEnv({ force: true });

const { initDb, closeDb } = require('../src/db');
const { app } = require('../src/index');

function request(port, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/cron/tron-deposit-ops?dry_run=true',
        method: 'GET',
        headers,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          let json = null;
          try {
            json = body ? JSON.parse(body) : null;
          } catch (err) {
            reject(new Error(`Invalid JSON: ${body.slice(0, 200)}`));
            return;
          }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  await initDb();
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  const port = server.address().port;

  try {
    const unauth = await request(port, {});
    assert.strictEqual(unauth.status, 401);
    assert.strictEqual(unauth.json.success, false);

    const bad = await request(port, { Authorization: 'Bearer wrong' });
    assert.strictEqual(bad.status, 401);

    const ok = await request(port, { Authorization: `Bearer ${process.env.CRON_SECRET}` });
    assert.ok(ok.status === 200 || ok.status === 207, `status ${ok.status}`);
    assert.strictEqual(ok.json.success, true);
    assert.strictEqual(ok.json.ok, true);
    assert.ok(ok.json.sweep, 'includes sweep summary');
    assert.ok(typeof ok.json.started_at === 'string');

    console.log('test-cron-tron-deposit-ops-http: OK');
  } finally {
    await new Promise((r) => server.close(r));
    await closeDb?.().catch(() => {});
    try { fs.unlinkSync(dbFile); } catch (_) {}
  }
})().catch((err) => {
  console.error('test-cron-tron-deposit-ops-http FAILED:', err);
  process.exit(1);
});
