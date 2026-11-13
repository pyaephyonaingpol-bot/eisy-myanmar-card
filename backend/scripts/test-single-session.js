#!/usr/bin/env node
/**
 * Single-session enforcement: new login revokes prior device tokens.
 * Run: node backend/scripts/test-single-session.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const os = require('os');
const express = require('express');
const http = require('http');

process.chdir(path.join(__dirname, '..'));

const dbPath = path.join(os.tmpdir(), `eisy-single-session-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbPath}`;
process.env.NODE_ENV = 'test';
process.env.AUTH_SECRET = 'test-single-session-secret';

const { initDb } = require('../src/db');

(async () => {
  await initDb();

  const User = require('../src/models/User');
  const UserSession = require('../src/models/UserSession');
  const { createSession } = require('../src/services/authService');
  const { requireAuth } = require('../src/middleware/auth');

  const user = await User.create({
    email: 'single-session@gmail.com',
    name: 'Single Session',
    phone: `+959${String(Date.now()).slice(-8)}`,
  });

  const deviceA = await createSession({
    userId: user.id,
    ipAddress: '203.0.113.10',
    deviceName: 'Device A',
    devicePlatform: 'web',
  });
  assert.ok(deviceA.sessionToken);
  assert.ok(await UserSession.findByToken(deviceA.sessionToken));

  const deviceB = await createSession({
    userId: user.id,
    ipAddress: '203.0.113.20',
    deviceName: 'Device B',
    devicePlatform: 'web',
  });
  assert.ok(deviceB.sessionToken);
  assert.ok(await UserSession.findByToken(deviceB.sessionToken));

  // Device A must be revoked
  assert.strictEqual(await UserSession.findByToken(deviceA.sessionToken), undefined);
  assert.strictEqual(
    await UserSession.classifyMissingToken(deviceA.sessionToken),
    'SESSION_SUPERSEDED'
  );

  const app = express();
  app.get('/me', requireAuth, (req, res) => res.json({ ok: true, userId: req.user.id }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const oldRes = await fetch(`http://127.0.0.1:${port}/me`, {
    headers: { Authorization: `Bearer ${deviceA.sessionToken}` },
  });
  assert.strictEqual(oldRes.status, 401);
  const oldBody = await oldRes.json();
  assert.strictEqual(oldBody.code, 'SESSION_SUPERSEDED');
  assert.strictEqual(
    oldBody.error,
    'Your session has expired because you logged in from another device'
  );

  const newRes = await fetch(`http://127.0.0.1:${port}/me`, {
    headers: { Authorization: `Bearer ${deviceB.sessionToken}` },
  });
  assert.strictEqual(newRes.status, 200);
  const newBody = await newRes.json();
  assert.strictEqual(newBody.userId, user.id);

  server.close();
  console.log('test-single-session: OK');
  process.exit(0);
})().catch((err) => {
  console.error('test-single-session: FAIL', err);
  process.exit(1);
});
