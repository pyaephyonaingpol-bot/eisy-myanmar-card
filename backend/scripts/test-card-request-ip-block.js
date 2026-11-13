#!/usr/bin/env node
/**
 * IP blocklist + card-issue IP rate limiter.
 * Run: node backend/scripts/test-card-request-ip-block.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

process.chdir(path.join(__dirname, '..'));

const {
  HARDCODED_BLOCKED_IPS,
  normalizeIp,
  getRequestIp,
  isIpBlocked,
  temporaryBanIp,
  createIpBlocklistMiddleware,
} = require('../src/middleware/ipBlocklist');
const {
  createCardIssueIpRateLimiter,
  createCardIssueRateLimiter,
} = require('../src/middleware/security');

assert.ok(HARDCODED_BLOCKED_IPS.includes('162.35.41.40'));
assert.strictEqual(normalizeIp('::ffff:162.35.41.40'), '162.35.41.40');
assert.strictEqual(isIpBlocked('162.35.41.40'), true);
assert.strictEqual(isIpBlocked('8.8.8.8'), false);

process.env.BLOCKED_IPS = '203.0.113.9, 198.51.100.2';
assert.strictEqual(isIpBlocked('203.0.113.9'), true);
assert.strictEqual(isIpBlocked('198.51.100.2'), true);
delete process.env.BLOCKED_IPS;

const until = temporaryBanIp('203.0.113.50', 60_000);
assert.ok(until > Date.now());
assert.strictEqual(isIpBlocked('203.0.113.50'), true);

assert.strictEqual(
  getRequestIp({
    ip: '::ffff:162.35.41.40',
    headers: {},
  }),
  '162.35.41.40'
);

assert.strictEqual(typeof createCardIssueIpRateLimiter(), 'function');
assert.strictEqual(typeof createCardIssueRateLimiter(), 'function');

const indexSrc = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
assert.ok(indexSrc.includes('createIpBlocklistMiddleware'));

const userSrc = fs.readFileSync(path.join(__dirname, '../src/routes/user.js'), 'utf8');
assert.ok(userSrc.includes('cardIssueIpLimiter'));
assert.ok(userSrc.includes('cardIssueIpLimiter,\n  cardIssueLimiter'));

(async () => {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createIpBlocklistMiddleware());
  app.get('/ping', (_req, res) => res.json({ ok: true }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const blocked = await fetch(`http://127.0.0.1:${port}/ping`, {
    headers: { 'x-forwarded-for': '162.35.41.40' },
  });
  assert.strictEqual(blocked.status, 403);
  const blockedBody = await blocked.json();
  assert.strictEqual(blockedBody.code, 'IP_BLOCKED');

  const allowed = await fetch(`http://127.0.0.1:${port}/ping`, {
    headers: { 'x-forwarded-for': '203.0.113.100' },
  });
  assert.strictEqual(allowed.status, 200);

  // IP card-issue limiter: 3/hour then 429 + temp ban
  const issueApp = express();
  issueApp.set('trust proxy', 1);
  issueApp.use(express.json());
  const ipLimiter = createCardIssueIpRateLimiter();
  issueApp.post('/issue', (req, _res, next) => {
    req.user = { id: 1, email: 'a@gmail.com' };
    next();
  }, ipLimiter, (_req, res) => res.status(201).json({ ok: true }));

  const issueServer = http.createServer(issueApp);
  await new Promise((resolve) => issueServer.listen(0, '127.0.0.1', resolve));
  const issuePort = issueServer.address().port;
  const spamIp = '198.51.100.77';

  for (let i = 0; i < 3; i += 1) {
    const res = await fetch(`http://127.0.0.1:${issuePort}/issue`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': spamIp,
      },
      body: '{}',
    });
    assert.strictEqual(res.status, 201, `attempt ${i + 1} should pass`);
  }
  const limited = await fetch(`http://127.0.0.1:${issuePort}/issue`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': spamIp,
    },
    body: '{}',
  });
  assert.strictEqual(limited.status, 429);
  const limitedBody = await limited.json();
  assert.strictEqual(limitedBody.code, 'CARD_ISSUE_IP_RATE_LIMITED');
  assert.strictEqual(isIpBlocked(spamIp), true, 'IP should be temporarily banned after limit');

  server.close();
  issueServer.close();
  console.log('test-card-request-ip-block: OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
