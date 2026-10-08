#!/usr/bin/env node
'use strict';

/**
 * Phone lock-screen notifications: service worker, Web Push storage, and hooks.
 * Run: node backend/scripts/test-web-push.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const html = read('backend/public/index.html');
const instant = read('backend/public/instant.html');
const dash = read('backend/public/dashboard.js');
const i18n = read('backend/public/i18n.js');
const sw = read('backend/public/sw.js');
const client = read('backend/public/pushNotifications.js');
const routes = read('backend/src/routes/user.js');
const service = read('backend/src/services/webPushService.js');
const webhook = read('backend/src/services/pago3dsWebhookService.js');
const telegram = read('backend/src/services/telegram.js');
const server = read('backend/src/index.js');
const vercel = read('vercel.json');
const migration = read('backend/migrations/072_push_subscriptions.sql');

for (const doc of [html, instant]) {
  assert.ok(doc.includes('id="pushNotifyPanel"'), 'settings card present');
  assert.ok(doc.includes('id="pushEnableBtn"'), 'enable button present');
  assert.ok(doc.includes('id="pushStatus"'), 'status line present');
  assert.ok(doc.includes('data-i18n="push_heading"'), 'heading i18n');
  assert.ok(doc.includes('/pushNotifications.js?v=20261008push'), 'client script tag');
  const settingsAt = doc.indexOf('id="pageSettings"');
  const panelAt = doc.indexOf('id="pushNotifyPanel"');
  assert.ok(settingsAt > -1 && panelAt > settingsAt, 'phone notifications sit on Settings');
}

assert.ok(sw.includes("addEventListener('push'"), 'service worker handles push');
assert.ok(sw.includes("addEventListener('notificationclick'"), 'click focuses the app');
assert.ok(sw.includes('showNotification'), 'worker displays a system notification');
assert.ok(sw.includes("msg.type !== 'SHOW_NOTIFICATION'"), 'worker accepts page messages');
assert.ok(!/export\s+function/.test(sw), 'worker stays classic script');

assert.ok(client.includes("serviceWorker.register"), 'page registers the worker');
assert.ok(client.includes('showNotification'), 'page asks the worker to show a notification');
assert.ok(client.includes('/api/user/push/subscribe'), 'page stores the subscription');
assert.ok(client.includes('/api/user/push/config'), 'page loads the VAPID public key');
assert.ok(client.includes('EisyPush'), 'client exposes EisyPush');
assert.ok(!/export\s+function/.test(client), 'client stays classic script');

assert.ok(dash.includes('EisyPush?.show'), 'toasts can surface as system notifications');
assert.ok(dash.includes('EisyPush?.sync'), 'login syncs an existing subscription');
assert.ok(dash.includes("tag: otpCode ? 'eisy-3ds' : 'eisy'"), 'OTP toasts use a stable tag');

assert.ok(i18n.includes("push_heading: 'Phone notifications'"), 'EN heading');
assert.ok(i18n.includes("push_heading: 'ဖုန်း အကြောင်းကြားချက်'"), 'MY heading');
assert.ok(i18n.includes("push_enable: 'Enable phone notifications'"), 'EN button');
assert.ok(i18n.includes("push_enable: 'ဖုန်း အကြောင်းကြားချက် ဖွင့်မည်'"), 'MY button');
assert.ok(i18n.includes('push_3ds_title'), 'OTP title key');
assert.ok(i18n.includes('push_local_only'), 'local-only hint');

assert.ok(routes.includes("router.get('/push/config'"), 'public config route');
assert.ok(routes.includes("router.post('/push/subscribe'"), 'subscribe route');
assert.ok(routes.includes("router.post('/push/unsubscribe'"), 'unsubscribe route');
assert.ok(routes.includes("router.post('/push/test'"), 'test push route');
const pushAt = routes.indexOf("router.post('/push/subscribe'");
const catchAll = routes.indexOf("router.get('/:user_id'");
assert.ok(pushAt > -1 && catchAll > pushAt, 'push routes are registered before the user id catch-all');

assert.ok(service.includes("require('web-push')"), 'service uses web-push');
assert.ok(service.includes('notifyUserPush'), 'service can deliver to a user');
assert.ok(service.includes('status === 404 || status === 410'), 'expired endpoints are removed');
assert.ok(!/export\s+function/.test(service), 'service stays CommonJS');

assert.ok(webhook.includes('notifyUserPush'), '3DS webhook sends a phone alert');
assert.ok(webhook.includes("tag: 'eisy-3ds'"), '3DS alerts share one tag');
assert.ok(telegram.includes('notifyUserPush'), 'deposit credit sends a phone alert');
assert.ok(telegram.includes("tag: `eisy-deposit-${deposit?.ref_code || 'deposit'}`"), 'deposit tag is stable');

assert.ok(server.includes("Service-Worker-Allowed"), 'service worker may control the site root');
assert.ok(vercel.includes('"/sw.js"'), 'vercel serves the worker with explicit headers');
assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS push_subscriptions'), 'subscription table');
assert.ok(migration.includes('UNIQUE(endpoint)'), 'one row per browser endpoint');

async function assertDelivery() {
  const dbFile = path.join(os.tmpdir(), `eisy-web-push-${process.pid}.db`);
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try { fs.unlinkSync(dbFile + suffix); } catch (_) { /* fresh */ }
  }
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.TURSO_DATABASE_URL = '';
  process.env.TURSO_AUTH_TOKEN = '';
  process.env.DATABASE_AUTH_TOKEN = '';
  process.env.SUPABASE_URL = 'off';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'off';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'off';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'off';
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;

  const { resetSupabaseClientForTests } = require('../src/lib/supabase');
  resetSupabaseClientForTests();
  const { initDb, closeDb, getDb } = require('../src/db');
  const User = require('../src/models/User');
  const push = require('../src/services/webPushService');

  await initDb();
  resetSupabaseClientForTests();
  push.resetVapidCacheForTests();

  const stamp = Date.now();
  const owner = await User.create({
    name: 'Push Owner',
    phone: `8${String(stamp).slice(-9)}`,
    email: `push-${stamp}@example.com`,
    pinHash: null,
  });

  assert.strictEqual(push.normalizeSubscription({ endpoint: 'http://insecure.example/push', keys: { p256dh: 'aa', auth: 'bb' } }), null);
  assert.strictEqual(push.normalizeSubscription({ endpoint: 'https://push.example.test/1', keys: { p256dh: '', auth: 'bb' } }), null);
  assert.strictEqual(push.normalizeSubscription({ endpoint: 'https://push.example.test/1', keys: { p256dh: 'abc', auth: 'def' } }), null);
  const p256dh = Buffer.alloc(65, 7).toString('base64url');
  const authKey = Buffer.alloc(16, 9).toString('base64url');

  const config = await push.getPublicConfig();
  assert.strictEqual(config.enabled, true);
  assert.ok(config.publicKey && config.publicKey.length > 20, 'VAPID public key is generated');

  const endpoint = `https://push.example.test/sub/${stamp}`;
  await push.saveSubscription(owner.id, {
    endpoint,
    keys: { p256dh, auth: authKey },
  }, 'EisyTest/1.0');

  const sent = [];
  const ok = await push.notifyUserPush(owner.id, {
    title: '3DS verification code',
    body: '482913 for Cafe',
    url: '/#cards',
    tag: 'eisy-3ds',
  }, {
    sendNotification: async (sub, data) => {
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(data) });
    },
  });
  assert.strictEqual(ok.sent, 1);
  assert.strictEqual(ok.removed, 0);
  assert.strictEqual(sent[0].endpoint, endpoint);
  assert.strictEqual(sent[0].payload.title, '3DS verification code');
  assert.strictEqual(sent[0].payload.body, '482913 for Cafe');
  assert.strictEqual(sent[0].payload.url, '/#cards');
  assert.strictEqual(sent[0].payload.tag, 'eisy-3ds');

  const gone = await push.notifyUserPush(owner.id, { title: 'gone', body: 'x' }, {
    sendNotification: async () => {
      const err = new Error('gone');
      err.statusCode = 410;
      throw err;
    },
  });
  assert.strictEqual(gone.removed, 1);
  assert.strictEqual(gone.sent, 0);
  const left = await getDb().get(
    'SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ?',
    owner.id
  );
  assert.strictEqual(Number(left.c), 0, '410 subscriptions are deleted');

  const skipped = await push.notifyUserPush(0, { title: 'nope' });
  assert.strictEqual(skipped.skipped, true);

  await closeDb();
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try { fs.unlinkSync(dbFile + suffix); } catch (_) { /* cleaned */ }
  }
}

assertDelivery()
  .then(() => {
    console.log('web push notification checks passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
