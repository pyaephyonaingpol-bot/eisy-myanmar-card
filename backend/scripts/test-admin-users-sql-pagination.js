#!/usr/bin/env node
/**
 * Admin /users default path must SQL-paginate Turso (not scan 10k + Supabase).
 * Run: node backend/scripts/test-admin-users-sql-pagination.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

async function main() {
  const dbFile = path.join(os.tmpdir(), `eisy-admin-users-page-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  for (const key of Object.keys(process.env)) {
    if (/SUPABASE/i.test(key)) delete process.env[key];
  }

  const { initDb, closeDb, getDb } = require('../src/db');
  await initDb();
  const User = require('../src/models/User');
  const { listAdminUserDirectory } = require('../src/services/adminUserDirectory');

  try {
    const stamp = Date.now();
    for (let i = 0; i < 35; i += 1) {
      const user = await User.create({
        name: `Paged ${i}`,
        phone: `09${String(30000000 + i)}`,
        email: `paged${i}-${stamp}@example.com`,
        pinHash: `hash-${i}`,
      });
      await getDb().run(
        'UPDATE users SET created_at = ? WHERE id = ?',
        `2026-04-${String((i % 28) + 1).padStart(2, '0')} 12:00:00`,
        user.id
      );
    }

    const page1 = await listAdminUserDirectory({ limit: 10, offset: 0, sort: 'created_at_desc' });
    assert.strictEqual(page1.mode, 'registry');
    assert.strictEqual(page1.users.length, 10);
    assert.strictEqual(page1.total, 35);
    assert.strictEqual(page1.has_more, true);

    const page2 = await listAdminUserDirectory({ limit: 10, offset: 10, sort: 'created_at_desc' });
    assert.strictEqual(page2.users.length, 10);
    const overlap = page1.users.some((a) => page2.users.some((b) => String(a.id) === String(b.id)));
    assert.strictEqual(overlap, false, 'pages do not overlap');

    const asc = await listAdminUserDirectory({ limit: 5, offset: 0, sort: 'created_at_asc' });
    assert.strictEqual(asc.sort, 'created_at_asc');
    assert.ok(timeValue(asc.users[0]) <= timeValue(asc.users[4]));

    const blocked = await listAdminUserDirectory({ status: 'blocked', limit: 20, offset: 0 });
    assert.strictEqual(blocked.total, 0);

    const src = fs.readFileSync(path.join(__dirname, '../src/services/adminUserDirectory.js'), 'utf8');
    assert.ok(src.includes("mode: 'registry'"), 'fast path marked registry');
    assert.ok(src.includes('listSupabaseWalletsByUserIds'), 'page enrich uses id IN query');

    const patch = fs.readFileSync(
      path.join(__dirname, '../migrations/patches/applyUserAuthColumns.js'),
      'utf8'
    );
    assert.ok(patch.includes('idx_users_auth_status_created_at'), 'status+created index in auth patch');

    console.log('test-admin-users-sql-pagination: OK', {
      total: page1.total,
      page1: page1.users.length,
      page2: page2.users.length,
    });
  } finally {
    await closeDb().catch(() => {});
    try { fs.unlinkSync(dbFile); } catch (_) {}
  }
}

function timeValue(row) {
  const raw = row?.created_at || '';
  return Date.parse(String(raw).includes('T') ? raw : String(raw).replace(' ', 'T')) || 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
