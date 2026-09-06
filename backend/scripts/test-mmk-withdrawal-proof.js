#!/usr/bin/env node
/**
 * Regression: MMK/USDT bank withdrawal payment-proof upload + email wiring.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const migration = read('backend/migrations/052_withdrawal_payment_proof.sql');
assert.ok(migration.includes('mmk_withdrawal_requests ADD COLUMN proof_url'), 'migration adds mmk proof_url');
assert.ok(migration.includes('usdt_withdrawal_requests ADD COLUMN proof_url'), 'migration adds usdt proof_url');

const mmkPatch = read('backend/migrations/patches/ensureMmkWithdrawalColumns.js');
assert.ok(mmkPatch.includes('proof_url'), 'mmk boot patch includes proof_url');

const usdtPatch = read('backend/migrations/patches/ensureUsdtWithdrawalProofColumns.js');
assert.ok(usdtPatch.includes('ensureUsdtWithdrawalProofColumns'), 'usdt proof patch exported');

const dbJs = read('backend/src/db.js');
assert.ok(dbJs.includes('ensureUsdtWithdrawalProofColumns'), 'db boots usdt proof patch');

const upload = read('backend/src/middleware/upload.js');
assert.ok(upload.includes('uploadWithdrawalProof'), 'multer uploadWithdrawalProof');
assert.ok(upload.includes("category: 'withdrawals'") || upload.includes("'withdrawals'"), 'withdrawals category');

const email = read('backend/src/services/emailService.js');
assert.ok(email.includes('sendWithdrawalProofEmail'), 'Resend withdrawal proof email helper');

const proofSvc = read('backend/src/services/withdrawalProofService.js');
assert.ok(proofSvc.includes('persistProofFromRequest'), 'persistProofFromRequest');
assert.ok(proofSvc.includes('notifyUserOfPayoutProof'), 'notifyUserOfPayoutProof');
assert.ok(proofSvc.includes('sendWithdrawalProofEmail'), 'proof svc uses Resend helper');

const wdSvc = read('backend/src/services/withdrawalService.js');
assert.ok(wdSvc.includes('proofFile'), 'complete accepts proofFile');
assert.ok(wdSvc.includes('notifyUserOfPayoutProof'), 'complete emails proof');
assert.ok(wdSvc.includes('proofUpdateFields'), 'complete persists proof fields');

const adminRoutes = read('backend/src/routes/admin.js');
assert.ok(adminRoutes.includes('uploadWithdrawalProof.single'), 'admin complete uses multer');
assert.ok(adminRoutes.includes("single('proof')"), 'proof field name is proof');

const wdRoutes = read('backend/src/routes/withdrawal.js');
assert.ok(wdRoutes.includes('proof_url:'), 'user history exposes proof_url');

const ledger = read('backend/src/services/adminLedgerTransactionService.js');
assert.ok(ledger.includes('proof_url:'), 'admin ledger exposes proof_url');

const adminHtml = read('backend/public/admin.html');
assert.ok(adminHtml.includes('id="withdrawalProofModal"'), 'admin complete modal present');
assert.ok(adminHtml.includes('id="wdProofFile"'), 'proof file input present');

const adminJs = read('backend/public/admin.js');
assert.ok(adminJs.includes('openWithdrawalProofModal'), 'opens proof modal on complete');
assert.ok(adminJs.includes('apiFormData'), 'multipart helper present');
assert.ok(adminJs.includes("append('proof'"), 'FormData appends proof');
assert.ok(adminJs.includes('View proof') || adminJs.includes('proof_url'), 'completed rows can show proof');

// Runtime: require critical modules
require('../src/services/emailService');
require('../src/services/withdrawalProofService');
require('../src/services/withdrawalService');
require('../src/middleware/upload');

console.log('MMK/USDT withdrawal payment proof wiring — ok');
