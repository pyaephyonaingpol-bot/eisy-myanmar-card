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

  await closeDb();
  try { fs.unlinkSync(dbFile); } catch (_) { /* ignore */ }
  console.log('ok');

  console.log('\nSupport live chat + Telegram bridge checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
