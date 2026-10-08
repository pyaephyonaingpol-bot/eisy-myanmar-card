#!/usr/bin/env node
'use strict';

/**
 * Set the designated owner account to role ADMIN and store the operator
 * password as a bcrypt hash.
 *
 * Updates that one user only. Does not delete existing rows.
 *
 *   node backend/scripts/set-owner-admin-account.js
 *
 * Uses DATABASE_URL (Turso in production, file DB locally).
 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();

(async () => {
  const { initDb, closeDb } = require('../src/db');
  const { getDatabaseInfo } = require('../src/lib/databaseConfig');
  const { applyOwnerAdminAccount } = require('../src/services/ownerAdminAccount');

  await initDb();
  console.log('[set-owner-admin] db=', getDatabaseInfo());
  const result = await applyOwnerAdminAccount();
  console.log('[set-owner-admin] result=', JSON.stringify(result, null, 2));
  await closeDb().catch(() => {});
})().catch((err) => {
  console.error('[set-owner-admin] failed:', err.message);
  process.exit(1);
});
