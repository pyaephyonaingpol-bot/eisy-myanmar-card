#!/usr/bin/env node
'use strict';

/**
 * Admin support task management: MMK Payouts + Card Issuing Issues,
 * priority/status filters, PATCH meta, Supabase Realtime wiring.
 * Run: node scripts/test-admin-support-tasks.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
process.chdir(path.join(__dirname, '..'));

function assertIncludes(haystack, needle, msg) {
  assert.ok(haystack.includes(needle), msg || `expected to include: ${needle}`);
}

async function main() {
  const adminHtml = fs.readFileSync(path.join(ROOT, 'backend/public/admin.html'), 'utf8');
  const adminJs = fs.readFileSync(path.join(ROOT, 'backend/public/admin.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(ROOT, 'backend/public/index.html'), 'utf8');
  const dashboardJs = fs.readFileSync(path.join(ROOT, 'backend/public/dashboard.js'), 'utf8');
  const stylesCss = fs.readFileSync(path.join(ROOT, 'backend/public/styles.css'), 'utf8');
  const supabaseService = fs.readFileSync(
    path.join(ROOT, 'backend/public/src/services/supabaseService.js'),
    'utf8'
  );
  const adminRoutes = fs.readFileSync(path.join(ROOT, 'backend/src/routes/admin.js'), 'utf8');
  const supportRoutes = fs.readFileSync(path.join(ROOT, 'backend/src/routes/support.js'), 'utf8');
  const syncService = fs.readFileSync(
    path.join(ROOT, 'backend/src/services/supabaseSyncService.js'),
    'utf8'
  );
  const migration = fs.readFileSync(
    path.join(ROOT, 'backend/migrations/056_support_task_categories.sql'),
    'utf8'
  );
  const supabaseSql = fs.readFileSync(
    path.join(ROOT, 'supabase/support_threads_realtime.sql'),
    'utf8'
  );

  // --- UI: filters, badges, live toast ---
  assertIncludes(adminHtml, 'Support Task Management', 'admin support title');
  assertIncludes(adminHtml, 'id="supportCategoryFilter"', 'category filter');
  assertIncludes(adminHtml, 'value="mmk_payouts">MMK Payouts', 'MMK Payouts category');
  assertIncludes(adminHtml, 'value="card_issuing">Card Issuing Issues', 'Card Issuing category');
  assertIncludes(adminHtml, 'id="supportPriorityFilter"', 'priority filter');
  assertIncludes(adminHtml, 'value="high">High', 'High priority option');
  assertIncludes(adminHtml, 'value="medium">Medium', 'Medium priority option');
  assertIncludes(adminHtml, 'value="low">Low', 'Low priority option');
  assertIncludes(adminHtml, 'id="supportStatusFilter"', 'status filter');
  assertIncludes(adminHtml, 'value="pending">Open', 'Open status');
  assertIncludes(adminHtml, 'value="in_progress">In Progress', 'In Progress status');
  assertIncludes(adminHtml, 'value="completed">Resolved', 'Resolved status');
  assertIncludes(adminHtml, 'value="failed">Failed', 'Failed status');
  assertIncludes(adminHtml, 'id="supportUrgentToast"', 'urgent realtime toast');
  assertIncludes(adminHtml, 'id="supportTaskMeta"', 'task meta editor');
  assertIncludes(adminHtml, 'id="supportSaveTaskMetaBtn"', 'save task meta button');
  assertIncludes(adminHtml, 'admin.js?v=20260911supportChat', 'admin.js cache bust');

  assertIncludes(adminJs, 'supportFilters', 'filter state');
  assertIncludes(adminJs, 'onSupportRealtime', 'realtime handler');
  assertIncludes(adminJs, 'showSupportUrgentToast', 'urgent toast renderer');
  assertIncludes(adminJs, 'saveSupportTaskMeta', 'PATCH meta saver');
  assertIncludes(adminJs, "toLowerCase() === 'high'", 'high priority toast gate');
  assertIncludes(adminJs, "PATCH', '/api/admin/support/threads/", 'PATCH API call');

  assertIncludes(indexHtml, 'id="supportCategory"', 'user support category');
  assertIncludes(indexHtml, 'value="mmk_payouts">MMK Payouts', 'user MMK category');
  assertIncludes(indexHtml, 'value="card_issuing">Card Issuing Issues', 'user card category');
  assertIncludes(indexHtml, 'id="supportPriority"', 'user priority select');
  assertIncludes(dashboardJs, "category: $('supportCategory')", 'dashboard sends category');
  assertIncludes(dashboardJs, "priority: $('supportPriority')", 'dashboard sends priority');

  assertIncludes(stylesCss, '.support-badge.priority-high', 'priority badge styles');
  assertIncludes(stylesCss, '.support-urgent-toast', 'urgent toast styles');
  assertIncludes(stylesCss, '.thread-item.is-urgent', 'urgent thread highlight');

  // --- Realtime subscription ---
  assertIncludes(supabaseService, "table: 'support_threads'", 'admin realtime support_threads');
  assertIncludes(supabaseService, 'handlers.onSupport', 'onSupport callback');
  assertIncludes(syncService, 'async function syncSupportThread', 'mirror upsert');
  assertIncludes(syncService, 'syncSupportThread,', 'export syncSupportThread');
  assertIncludes(supabaseSql, 'ALTER PUBLICATION supabase_realtime ADD TABLE support_threads', 'realtime publication');

  // --- API routes ---
  assertIncludes(adminRoutes, "router.get('/support/threads'", 'list threads');
  assertIncludes(adminRoutes, "router.patch('/support/threads/:id'", 'patch threads');
  assertIncludes(adminRoutes, 'const category = req.query.category', 'list category filter');
  assertIncludes(adminRoutes, 'const priority = req.query.priority', 'list priority filter');
  assertIncludes(adminRoutes, "status: 'in_progress'", 'reply moves pending→in_progress');
  assertIncludes(supportRoutes, 'SUPPORT_MAIN_CATEGORIES', 'user create main categories');
  assertIncludes(supportRoutes, 'normalizeSupportPriority', 'user create priority');

  // --- Migration taxonomy ---
  assertIncludes(migration, 'PRAGMA foreign_keys = OFF', 'FK off for rebuild');
  assertIncludes(migration, "'mmk_payouts', 'card_issuing'", 'new categories in CHECK');
  assertIncludes(migration, "'pending', 'in_progress', 'completed', 'failed'", 'new statuses');
  assertIncludes(migration, "'low', 'medium', 'high'", 'new priorities');

  // --- Normalize helpers ---
  const {
    normalizeSupportCategory,
    normalizeSupportPriority,
    normalizeSupportStatus,
    isUrgentSupportPriority,
    SUPPORT_MAIN_CATEGORIES,
  } = require('../src/constants/supportTasks');

  assert.strictEqual(normalizeSupportCategory('MMK Payouts'), 'mmk_payouts');
  assert.strictEqual(normalizeSupportCategory('card-issuing'), 'card_issuing');
  assert.strictEqual(normalizeSupportPriority('urgent'), 'high');
  assert.strictEqual(normalizeSupportPriority('normal'), 'medium');
  assert.strictEqual(normalizeSupportStatus('open'), 'pending');
  assert.strictEqual(normalizeSupportStatus('closed'), 'completed');
  assert.strictEqual(normalizeSupportStatus('In Progress'), 'in_progress');
  assert.strictEqual(isUrgentSupportPriority('high'), true);
  assert.deepStrictEqual([...SUPPORT_MAIN_CATEGORIES], ['mmk_payouts', 'card_issuing']);

  // --- Integration: migration + filters + meta + sync stub ---
  const dbFile = path.join(os.tmpdir(), `eisy-support-tasks-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret-key-for-tests-xxxxx';

  const { initDb, closeDb } = require('../src/db');
  const { resetSupabaseClientForTests } = require('../src/lib/supabase');
  resetSupabaseClientForTests();
  await initDb();

  const sync = require('../src/services/supabaseSyncService');
  let mirrored = [];
  sync.syncSupportThread = async (thread) => {
    mirrored.push({ ...thread });
    return thread;
  };

  // Reload model so create/update pick up stubbed sync via require inside helper
  // (SupportThread requires sync lazily each call — stubbing export is enough.)
  const User = require('../src/models/User');
  const SupportThread = require('../src/models/SupportThread');

  const user = await User.create({
    name: 'Support Task Tester',
    phone: `09${String(Date.now()).slice(-8)}`,
    email: `support-task-${Date.now()}@example.com`,
    pinHash: 'testhash',
  });

  const highMmk = await SupportThread.create({
    userId: user.id,
    subject: 'Need MMK bank payout',
    category: 'mmk_payouts',
    priority: 'high',
  });
  assert.strictEqual(highMmk.category, 'mmk_payouts');
  assert.strictEqual(highMmk.priority, 'high');
  assert.strictEqual(highMmk.status, 'pending');
  assert.ok(mirrored.some((t) => t.id === highMmk.id), 'create mirrors to supabase');

  const cardIssue = await SupportThread.create({
    userId: user.id,
    subject: 'Card not issued',
    category: 'card_issuing',
    priority: 'medium',
  });
  assert.strictEqual(cardIssue.category, 'card_issuing');

  const lowGeneral = await SupportThread.create({
    userId: user.id,
    subject: 'Other',
    category: 'general',
    priority: 'low',
    status: 'pending',
  });

  const mmkOnly = await SupportThread.listAll({ category: 'mmk_payouts' });
  assert.ok(mmkOnly.every((t) => t.category === 'mmk_payouts'), 'category filter');
  assert.ok(mmkOnly.some((t) => t.id === highMmk.id));

  const highOnly = await SupportThread.listAll({ priority: 'high' });
  assert.ok(highOnly.every((t) => t.priority === 'high'), 'priority filter');

  const pending = await SupportThread.listAll({ status: 'pending' });
  assert.ok(pending.some((t) => t.id === highMmk.id));

  const updated = await SupportThread.updateMeta(highMmk.id, {
    status: 'in_progress',
    priority: 'high',
    category: 'mmk_payouts',
  });
  assert.strictEqual(updated.status, 'in_progress');
  assert.ok(mirrored.filter((t) => t.id === highMmk.id).length >= 2, 'update mirrors again');

  const completed = await SupportThread.close(cardIssue.id);
  assert.strictEqual(completed.status, 'completed');
  assert.ok(completed.closed_at, 'close sets closed_at');

  const ordered = await SupportThread.listAll({});
  const idxHigh = ordered.findIndex((t) => t.id === highMmk.id);
  const idxLow = ordered.findIndex((t) => t.id === lowGeneral.id);
  assert.ok(idxHigh >= 0 && idxLow >= 0);
  assert.ok(idxHigh < idxLow, 'high priority sorts before low');

  // Schema CHECK accepts new enums
  const db = require('../src/db').getDb();
  const schema = await db.get(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='support_threads'"
  );
  assertIncludes(schema.sql, 'mmk_payouts', 'schema has mmk_payouts');
  assertIncludes(schema.sql, 'in_progress', 'schema has in_progress');
  assertIncludes(schema.sql, "'medium'", 'schema has medium priority');

  await closeDb();
  try { fs.unlinkSync(dbFile); } catch (_) { /* ignore */ }

  console.log('Admin support task management (categories/priority/status/realtime) — ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
