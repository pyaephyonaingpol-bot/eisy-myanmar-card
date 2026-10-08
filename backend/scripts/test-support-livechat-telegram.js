#!/usr/bin/env node
'use strict';

/**
 * Unified live chat + support tickets + Telegram 2-way bridge guards.
 * Run: node backend/scripts/test-support-livechat-telegram.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function includes(haystack, needle, msg) {
  assert.ok(haystack.includes(needle), msg || `expected to include: ${needle}`);
}

async function main() {
  console.log('== Static wiring ==');
  const indexHtml = read('backend/public/index.html');
  const adminHtml = read('backend/public/admin.html');
  const supportChat = read('backend/public/supportChat.js');
  const adminJs = read('backend/public/admin.js');
  const styles = read('backend/public/styles.css');
  const supportRoutes = read('backend/src/routes/support.js');
  const adminRoutes = read('backend/src/routes/admin.js');
  const webhook = read('backend/src/routes/webhook.js');
  const telegramSvc = read('backend/src/services/telegram.js');
  const bridge = read('backend/src/services/supportTelegramService.js');
  const migration = read('backend/migrations/058_support_telegram_bridge.sql');
  const supabaseSql = read('supabase/support_messages_realtime.sql');
  const supabaseClient = read('backend/public/src/services/supabaseService.js');
  const envExample = read('backend/.env.example');

  includes(indexHtml, 'supportChat.js', 'customer widget script');
  includes(supportChat, 'Live Support', 'widget title');
  includes(supportChat, 'mmk_payouts', 'MMK Payouts category');
  includes(supportChat, 'card_issuing', 'Card Issuing category');
  includes(supportChat, '/api/support/threads', 'customer create/list API');
  includes(styles, '.support-chat-fab', 'widget fab styles');
  includes(styles, '.support-chat-panel', 'widget panel styles');

  includes(adminHtml, 'value="pending">Open', 'Open status label');
  includes(adminHtml, 'value="completed">Resolved', 'Resolved status label');
  includes(adminHtml, 'value="mmk_payouts">MMK Payouts', 'admin MMK category');
  includes(adminHtml, 'value="card_issuing">Card Issuing Issues', 'admin card category');
  includes(adminJs, 'startSupportMessagePolling', 'admin live message polling');
  includes(adminJs, 'onSupportMessageRealtime', 'admin message realtime handler');
  includes(adminJs, "pending: 'Open'", 'admin Open status map');
  includes(adminJs, "completed: 'Resolved'", 'admin Resolved status map');

  includes(supportRoutes, 'notifySupportEvent', 'telegram notify on customer message');
  includes(supportRoutes, 'syncSupportMessage', 'supabase message sync');
  includes(adminRoutes, 'notifySupportEvent', 'telegram notify on admin web reply');
  includes(webhook, "router.post('/telegram'", 'telegram webhook route');
  includes(webhook, 'handleTelegramUpdate', 'webhook uses bridge handler');
  includes(webhook, 'parseTelegramWebhookPayload', 'webhook parses Telegram reply payloads');
  includes(telegramSvc, 'sendAdminMessage', 'telegram send helper');
  includes(telegramSvc, 'isTelegramConfigured', 'telegram config helper');
  includes(bridge, 'notifySupportEvent', 'bridge outbound');
  includes(bridge, 'handleTelegramUpdate', 'bridge inbound');
  includes(bridge, '#T', 'ticket tag for reply mapping');
  includes(migration, 'telegram_root_message_id', 'thread telegram root col');
  includes(migration, 'telegram_message_id', 'message telegram id col');
  includes(supabaseSql, 'support_messages', 'supabase messages table');
  includes(supabaseSql, 'supabase_realtime', 'messages realtime publication');
  includes(supabaseClient, "table: 'support_messages'", 'client listens to support_messages');
  includes(envExample, 'TELEGRAM_WEBHOOK_SECRET', 'webhook secret documented');
  console.log('ok');

  console.log('\n== Normalizers ==');
  const {
    normalizeSupportCategory,
    normalizeSupportPriority,
    normalizeSupportStatus,
    SUPPORT_MAIN_CATEGORIES,
    SUPPORT_STATUS_LABELS,
  } = require('../src/constants/supportTasks');
  assert.strictEqual(normalizeSupportCategory('MMK Payouts'), 'mmk_payouts');
  assert.strictEqual(normalizeSupportCategory('Card Issuing Issues'), 'card_issuing');
  assert.strictEqual(normalizeSupportPriority('High'), 'high');
  assert.strictEqual(normalizeSupportStatus('open'), 'pending');
  assert.strictEqual(normalizeSupportStatus('resolved'), 'completed');
  assert.strictEqual(SUPPORT_STATUS_LABELS.pending, 'Open');
  assert.strictEqual(SUPPORT_STATUS_LABELS.completed, 'Resolved');
  assert.deepStrictEqual([...SUPPORT_MAIN_CATEGORIES], ['mmk_payouts', 'card_issuing']);
  console.log('ok');

  console.log('\n== DB + Telegram inbound mapping ==');
  const dbFile = path.join(os.tmpdir(), `eisy-support-livechat-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  process.env.TELEGRAM_BOT_TOKEN = '';
  process.env.TELEGRAM_ADMIN_CHAT_ID = '';
  require('../src/lib/loadEnv');
  for (const key of Object.keys(process.env)) {
    if (/SUPABASE|TURSO/i.test(key)) delete process.env[key];
  }

  const { initDb, closeDb } = require('../src/db');
  await initDb();

  const User = require('../src/models/User');
  const SupportThread = require('../src/models/SupportThread');
  const SupportMessage = require('../src/models/SupportMessage');
  const {
    handleTelegramUpdate,
    extractThreadIdFromText,
  } = require('../src/services/supportTelegramService');

  assert.strictEqual(extractThreadIdFromText('Reply for #T42 please'), 42);

  const user = await User.create({
    name: 'Live Chat Tester',
    phone: `09${String(Date.now()).slice(-8)}`,
    email: `livechat-${Date.now()}@example.com`,
    pinHash: 'testhash',
  });

  const thread = await SupportThread.create({
    userId: user.id,
    subject: 'Payout stuck',
    category: 'mmk_payouts',
    priority: 'high',
  });
  assert.strictEqual(thread.category, 'mmk_payouts');
  assert.strictEqual(thread.priority, 'high');
  assert.strictEqual(thread.status, 'pending');

  const first = await SupportMessage.create({
    threadId: thread.id,
    senderType: 'user',
    senderId: user.id,
    message: 'Please check my MMK payout',
    source: 'web',
  });
  assert.ok(first.id);
  assert.strictEqual(first.source || 'web', 'web');

  console.log('\n== Outbound customer support message ==');
  process.env.TELEGRAM_ADMIN_CHAT_ID = '-100123';
  process.env.TELEGRAM_BOT_TOKEN = '000000:TEST';
  delete process.env.TELEGRAM_SUPPORT_TOPIC_ID;
  delete process.env.TELEGRAM_FORUM_TOPIC_ID;

  const { notifySupportEvent, isTelegramConfigured } = require('../src/services/supportTelegramService');
  assert.strictEqual(isTelegramConfigured(), true);

  const sentBodies = [];
  const previousFetch = global.fetch;
  global.fetch = async (url, init) => {
    sentBodies.push({ url: String(url), body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 9100 + sentBodies.length } }),
    };
  };
  try {
    const opened = await notifySupportEvent({
      thread,
      message: first,
      user,
      isNewTicket: true,
    });
    assert.strictEqual(opened.ok, true, JSON.stringify(opened));
    assert.strictEqual(sentBodies.length, 1);
    assert.match(String(sentBodies[0].url), /\/sendMessage$/);
    assert.strictEqual(String(sentBodies[0].body.chat_id), '-100123');
    assert.match(sentBodies[0].body.text, /Please check my MMK payout/);
    assert.match(sentBodies[0].body.text, new RegExp(`#T${thread.id}`));

    const follow = await SupportMessage.create({
      threadId: thread.id,
      senderType: 'user',
      senderId: user.id,
      message: 'Any update on the payout?',
      source: 'web',
    });
    const continued = await notifySupportEvent({
      thread,
      message: follow,
      user,
      isNewTicket: false,
    });
    assert.strictEqual(continued.ok, true, JSON.stringify(continued));
    assert.strictEqual(sentBodies.length, 2);
    assert.match(sentBodies[1].body.text, /Any update on the payout\?/);
    assert.strictEqual(Number(sentBodies[1].body.reply_to_message_id), 9101);
  } finally {
    global.fetch = previousFetch;
  }

  const linked = await SupportThread.findById(thread.id);
  assert.strictEqual(Number(linked.telegram_root_message_id), 9101);
  assert.strictEqual(String(linked.telegram_chat_id), '-100123');

  // Simulate Telegram linkage + inbound admin reply.
  const { getDb } = require('../src/db');
  const db = getDb();
  await db.run(
    `UPDATE support_threads
     SET telegram_chat_id = ?, telegram_root_message_id = ?, telegram_last_outbound_id = ?
     WHERE id = ?`,
    '-100123',
    9001,
    9001,
    thread.id
  );

  // Without configured bot, inbound from wrong chat is ignored.
  const ignored = await handleTelegramUpdate({
    message: {
      message_id: 9002,
      text: 'We are checking #T' + thread.id,
      chat: { id: '-100999' },
      from: { id: 1, is_bot: false },
      reply_to_message: { message_id: 9001, text: `#T${thread.id}` },
    },
  });
  assert.ok(ignored.ignored || ignored.ok === false || ignored.skipped);

  // Force configured chat id path with empty bot (still can ingest to DB when chat matches).
  process.env.TELEGRAM_ADMIN_CHAT_ID = '-100123';
  process.env.TELEGRAM_BOT_TOKEN = '000000:TEST';

  // Re-require won't reload telegram helpers; bridge reads env each call.
  const result = await handleTelegramUpdate({
    message: {
      message_id: 9003,
      text: 'Payout is processing now',
      chat: { id: '-100123' },
      from: { id: 55, is_bot: false, first_name: 'Admin' },
      reply_to_message: {
        message_id: 9001,
        text: `🎫 New Support Ticket\n🔖 Ticket: #T${thread.id}`,
      },
    },
  });

  // When bot token is fake, sendAdminMessage may fail on soft hints, but ingest should succeed.
  assert.ok(result.ok || result.duplicate || result.messageId, 'telegram reply ingested: ' + JSON.stringify(result));

  const messages = await SupportMessage.findByThreadId(thread.id);
  const fromTelegram = messages.find((m) => m.source === 'telegram' || Number(m.telegram_message_id) === 9003);
  assert.ok(fromTelegram, 'telegram-sourced message stored');
  assert.strictEqual(fromTelegram.sender_type, 'admin');
  assert.match(fromTelegram.message, /Payout is processing/);

  const updated = await SupportThread.findById(thread.id);
  assert.strictEqual(updated.status, 'in_progress');

  console.log('\n== HTTP webhook reply in user inbox ==');
  const http = require('http');
  const express = require('express');
  const { createSession } = require('../src/services/authService');
  const { parseTelegramWebhookPayload } = require('../src/services/supportTelegramService');

  const quoted = JSON.stringify({
    update_id: 77,
    message: {
      message_id: 42,
      text: 'quoted',
      chat: { id: -100123 },
      reply_to_message: { message_id: 1, text: `#T${thread.id}` },
    },
  });
  const parsedQuote = parseTelegramWebhookPayload(quoted);
  assert.strictEqual(parsedQuote.message.text, 'quoted');
  assert.strictEqual(parsedQuote.message.chat.id, -100123);

  process.env.TELEGRAM_WEBHOOK_SECRET = 'hook-secret';
  const mini = express();
  mini.use(express.json({
    verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
  }));
  mini.use('/api/webhook', require('../src/routes/webhook'));
  mini.use('/api/support', require('../src/routes/support'));
  const server = http.createServer(mini);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  function requestJson(method, urlPath, body, headers) {
    return new Promise((resolve, reject) => {
      const payload = body == null ? null : JSON.stringify(body);
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: {
          ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = {};
          try { json = raw ? JSON.parse(raw) : {}; } catch (_) { json = { raw }; }
          resolve({ status: res.statusCode, json });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  const replyPayload = {
    update_id: 90010,
    message: {
      message_id: 9010,
      text: 'Your payout is on the way',
      chat: { id: -100123, type: 'supergroup' },
      from: { id: 55, is_bot: false, first_name: 'Admin' },
      reply_to_message: {
        message_id: 9001,
        text: `🎫 New Support Ticket\n🔖 Ticket: #T${thread.id}`,
      },
    },
  };

  const denied = await requestJson('POST', '/api/webhook/telegram', replyPayload, {});
  assert.strictEqual(denied.status, 401);

  const accepted = await requestJson('POST', '/api/webhook/telegram', replyPayload, {
    'x-telegram-bot-api-secret-token': 'hook-secret',
  });
  assert.strictEqual(accepted.status, 200);
  assert.strictEqual(accepted.json.ok, true);
  assert.strictEqual(accepted.json.result.ok, true);
  assert.strictEqual(accepted.json.result.threadId, thread.id);

  const quotedOnly = {
    update_id: 90011,
    message: {
      message_id: 9011,
      text: 'Checking the card issue now',
      chat: { id: '-100123', type: 'supergroup' },
      from: { id: 55, is_bot: false },
      reply_to_message: { message_id: 7777 },
      quote: { text: `Ticket: #T${thread.id}` },
    },
  };
  const quotedReply = await requestJson('POST', '/api/webhook/telegram', quotedOnly, {
    'x-telegram-bot-api-secret-token': 'hook-secret',
  });
  assert.strictEqual(quotedReply.status, 200);
  assert.strictEqual(quotedReply.json.result.ok, true);

  const duplicate = await requestJson('POST', '/api/webhook/telegram', replyPayload, {
    'x-telegram-bot-api-secret-token': 'hook-secret',
  });
  assert.strictEqual(duplicate.json.result.duplicate, true);

  const { sessionToken } = await createSession({ userId: user.id });
  const inbox = await requestJson(
    'GET',
    `/api/support/threads/${thread.id}/messages`,
    null,
    { authorization: `Bearer ${sessionToken}` }
  );
  assert.strictEqual(inbox.status, 200);
  const payout = inbox.json.messages.find((m) => /Your payout is on the way/.test(m.message));
  const card = inbox.json.messages.find((m) => /Checking the card issue now/.test(m.message));
  assert.ok(payout, 'admin reply is in the user inbox');
  assert.strictEqual(payout.sender_type, 'admin');
  assert.strictEqual(payout.source, 'telegram');
  assert.ok(card, 'quoted reply is in the user inbox');
  assert.strictEqual(card.sender_type, 'admin');
  assert.strictEqual(card.source, 'telegram');

  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  await new Promise((resolve) => server.close(resolve));

  await closeDb();
  try { fs.unlinkSync(dbFile); } catch (_) { /* ignore */ }
  console.log('ok');

  console.log('\nSupport live chat + Telegram bridge checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
