/**
 * Web Push (VAPID) so a service worker can show notifications on the phone
 * even when the Eisy tab is in the background or closed.
 *
 * Keys: VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY, or a pair stored in app_settings
 * the first time push is used. Subject: VAPID_SUBJECT (mailto:...).
 */

'use strict';

const webpush = require('web-push');
const { getDb } = require('../db');
const { getSetting, setSetting } = require('./settingsService');

const VAPID_SUBJECT = String(process.env.VAPID_SUBJECT || 'mailto:support@eisymyanmar.com').trim();

let vapidReady = null;

function cleanText(value, max = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function decodeKey(value) {
  try {
    const pad = '='.repeat((4 - (value.length % 4)) % 4);
    return Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
  } catch (_) {
    return null;
  }
}

function normalizeSubscription(body) {
  const sub = body?.subscription || body || {};
  const endpoint = cleanText(sub.endpoint, 2000);
  const keys = sub.keys || {};
  const p256dh = cleanText(keys.p256dh, 512);
  const auth = cleanText(keys.auth, 512);
  if (!endpoint || !/^https:\/\//i.test(endpoint)) return null;
  const publicKey = decodeKey(p256dh);
  const authSecret = decodeKey(auth);
  if (!publicKey || publicKey.length !== 65) return null;
  if (!authSecret || authSecret.length !== 16) return null;
  return { endpoint, keys: { p256dh, auth } };
}

async function ensureVapid() {
  if (vapidReady) return vapidReady;
  let publicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  let privateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  if (!publicKey || !privateKey) {
    publicKey = String(await getSetting('vapid_public_key') || '').trim();
    privateKey = String(await getSetting('vapid_private_key') || '').trim();
  }
  if (!publicKey || !privateKey) {
    const generated = webpush.generateVAPIDKeys();
    publicKey = generated.publicKey;
    privateKey = generated.privateKey;
    await setSetting('vapid_public_key', publicKey);
    await setSetting('vapid_private_key', privateKey);
  }
  webpush.setVapidDetails(VAPID_SUBJECT, publicKey, privateKey);
  vapidReady = { publicKey, privateKey, subject: VAPID_SUBJECT };
  return vapidReady;
}

async function getPublicConfig() {
  const keys = await ensureVapid();
  return {
    enabled: true,
    publicKey: keys.publicKey,
    subject: keys.subject,
  };
}

async function listForUser(userId) {
  const db = getDb();
  return db.all(
    `SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?`,
    userId
  );
}

async function saveSubscription(userId, subscription, userAgent = null) {
  const normalized = normalizeSubscription(subscription);
  if (!normalized) {
    const err = new Error('A valid push subscription is required');
    err.status = 400;
    err.code = 'INVALID_PUSH_SUBSCRIPTION';
    throw err;
  }
  const db = getDb();
  await db.run(
    `
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent,
      updated_at = datetime('now')
    `,
    userId,
    normalized.endpoint,
    normalized.keys.p256dh,
    normalized.keys.auth,
    userAgent ? cleanText(userAgent, 300) : null
  );
  return normalized;
}

async function removeSubscription(userId, endpoint) {
  const db = getDb();
  const target = cleanText(endpoint, 2000);
  if (!target) return;
  await db.run(
    'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?',
    userId,
    target
  );
}

async function removeByEndpoint(endpoint) {
  const db = getDb();
  await db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', endpoint);
}

function toWebPushSubscription(row) {
  return {
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
  };
}

function pushTopic(tag) {
  const raw = String(tag || 'eisy').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  return raw || 'eisy';
}

function pushOptions(tag) {
  return {
    TTL: 24 * 60 * 60,
    urgency: 'high',
    topic: pushTopic(tag),
  };
}

/**
 * Deliver one payload to every subscription for a user.
 * 404/410 endpoints are dropped so expired browsers stop receiving retries.
 */
async function notifyUserPush(userId, payload = {}, deps = {}) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return { sent: 0, removed: 0, skipped: true };
  const rows = await listForUser(id);
  if (!rows.length) return { sent: 0, removed: 0 };

  await ensureVapid();
  const body = JSON.stringify({
    title: cleanText(payload.title, 80) || 'Eisy Myanmar',
    body: cleanText(payload.body, 180),
    url: cleanText(payload.url, 300) || '/',
    tag: cleanText(payload.tag, 80) || 'eisy',
  });
  const send = deps.sendNotification || ((sub, data, options) => webpush.sendNotification(sub, data, options));
  const options = pushOptions(payload.tag);

  let sent = 0;
  let removed = 0;
  for (const row of rows) {
    try {
      await send(toWebPushSubscription(row), body, options);
      sent += 1;
    } catch (err) {
      const status = Number(err?.statusCode || err?.status || 0);
      if (status === 404 || status === 410) {
        await removeByEndpoint(row.endpoint);
        removed += 1;
        console.warn('[push] dropped expired subscription', status);
      } else {
        console.warn('[push] delivery failed:', status || err.message);
      }
    }
  }
  return { sent, removed };
}

function resetVapidCacheForTests() {
  vapidReady = null;
}

module.exports = {
  ensureVapid,
  getPublicConfig,
  normalizeSubscription,
  saveSubscription,
  removeSubscription,
  notifyUserPush,
  resetVapidCacheForTests,
};
