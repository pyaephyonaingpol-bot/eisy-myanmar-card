#!/usr/bin/env node
/**
 * Profile phone helpers + PATCH /api/user/profile smoke test.
 * Run: node backend/scripts/test-user-profile-phone.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

async function main() {
  console.log('\n== phoneUtils ==');
  const {
    isSyntheticPhone,
    syntheticPhone,
    formatDisplayPhone,
    normalizePhoneInput,
  } = require('../src/lib/phoneUtils');

  assert.strictEqual(isSyntheticPhone('eabc123def456'), true);
  assert.strictEqual(isSyntheticPhone('+959123456789'), false);
  assert.strictEqual(formatDisplayPhone('eabc123def456'), null);
  assert.strictEqual(formatDisplayPhone('+959123456789'), '+959123456789');
  assert.strictEqual(normalizePhoneInput('+95 9 123 456 789'), '+959123456789');
  assert.throws(() => normalizePhoneInput('abc'), /valid phone/i);
  const synthetic = syntheticPhone('user@example.com');
  assert.ok(isSyntheticPhone(synthetic));
  console.log('ok');

  console.log('\n== updateUserProfile ==');
  const dbFile = path.join(require('os').tmpdir(), `eisy-profile-test-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';

  const { initDb, closeDb, getDb } = require('../src/db');
  await initDb();
  const db = getDb();

  const phoneA = `09${String(Date.now()).slice(-8)}`;
  const phoneB = `09${String(Date.now() + 1).slice(-8)}`;
  const email = `profile-${Date.now()}@example.com`;
  const ins = await db.run(
    `INSERT INTO users (name, phone, email, email_verified) VALUES (?, ?, ?, 1)`,
    'Profile Test',
    syntheticPhone(email),
    email
  );
  const userId = Number(ins.lastID);

  const { updateUserProfile, mapPublicUser } = require('../src/services/profileService');
  const User = require('../src/models/User');

  let updated = await updateUserProfile(userId, { name: 'Profile Updated', phone: phoneA });
  assert.strictEqual(updated.name, 'Profile Updated');
  assert.strictEqual(updated.phone, phoneA);
  assert.strictEqual(updated.has_phone, true);

  const conflictUser = await db.run(
    `INSERT INTO users (name, phone, email, email_verified) VALUES (?, ?, ?, 1)`,
    'Other User',
    phoneB,
    `other-${Date.now()}@example.com`
  );
  assert.ok(conflictUser.lastID);

  let conflictErr;
  try {
    await updateUserProfile(userId, { phone: phoneB });
  } catch (err) {
    conflictErr = err;
  }
  assert.strictEqual(conflictErr?.code, 'PHONE_ALREADY_REGISTERED');

  updated = await updateUserProfile(userId, { phone: '' });
  const row = await User.findById(userId);
  assert.ok(isSyntheticPhone(row.phone), 'clearing phone reverts to synthetic placeholder');

  const masked = mapPublicUser(row);
  assert.strictEqual(masked.phone, null);
  console.log('ok');

  await closeDb().catch(() => {});
  try {
    require('fs').unlinkSync(dbFile);
  } catch {
    /* ignore */
  }

  console.log('\nProfile phone checks passed.');
}

main().catch((err) => {
  console.error('\nProfile phone checks FAILED:', err);
  process.exit(1);
});
