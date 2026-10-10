#!/usr/bin/env node
'use strict';

/**
 * KYC gates P2P trading only. Virtual card issue must not require KYC.
 * Run: node backend/scripts/test-p2p-only-kyc.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function sliceFn(src, name, nextName) {
  const start = src.indexOf(name);
  const end = nextName ? src.indexOf(nextName, start + name.length) : src.length;
  assert.ok(start >= 0 && end > start, `slice ${name}`);
  return src.slice(start, end);
}

async function main() {
  const dash = read('public/dashboard.js');
  const html = read('public/index.html');
  const instant = read('public/instant.html');
  const adminHtml = read('public/admin.html');
  const adminJs = read('public/admin.js');
  const i18n = read('public/i18n.js');
  const buy = read('src/services/p2pBuyOrderService.js');
  const sell = read('src/services/p2pSellOrderService.js');
  const ads = read('src/services/p2pAdService.js');
  const cards = read('src/services/pagoCardService.js');
  const userRoutes = read('src/routes/user.js');
  const p2pRoutes = read('src/routes/p2p.js');
  const adminRoutes = read('src/routes/admin.js');

  const pageChange = sliceFn(dash, 'onPageChange(page, opts = {})', 'bindProofLightbox()');
  assert.ok(pageChange.includes("page === 'p2p'") && pageChange.includes('this.promptP2pKycGate()'), 'P2P tab prompts KYC');
  const cardsBranch = pageChange.slice(pageChange.indexOf("page === 'cards'"), pageChange.indexOf("page === 'instant-card'"));
  const instantBranch = pageChange.slice(pageChange.indexOf("page === 'instant-card'"), pageChange.indexOf("page === 'home'"));
  assert.ok(!cardsBranch.includes('promptP2pKycGate') && !cardsBranch.includes('showKycGateModal'), 'cards page has no KYC gate');
  assert.ok(!instantBranch.includes('promptP2pKycGate') && !instantBranch.includes('showKycGateModal'), 'instant card page has no KYC gate');

  const startTrade = sliceFn(dash, 'startP2pTrade(listing, side)', 'isKycVerified() {');
  const postAd = sliceFn(dash, 'openPostP2pAdModal()', 'closePostP2pAdModal()');
  assert.ok(startTrade.includes('promptP2pKycGate()'), 'starting a P2P order prompts KYC');
  assert.ok(postAd.includes('promptP2pKycGate()'), 'posting a P2P ad prompts KYC');
  assert.ok(dash.includes('showKycGateModal') || dash.includes('promptP2pKycGate'), 'KYC gate helpers remain');
  assert.ok(!dash.includes('verified banking'), 'dashboard copy is P2P-only');

  assert.ok(html.includes('id="kycGateModal"'), 'user KYC gate modal');
  assert.ok(html.includes('id="kycGateModal"'), 'gate modal markup');
  assert.ok(/Virtual Visa cards do not require KYC|Virtual Visa cards do not need KYC/i.test(html), 'card users are told KYC is optional');
  assert.ok(html.includes('dashboard.js?v=20261010globalUsdt'), 'dashboard cache bust');
  assert.ok(instant.includes('id="kycGateModal"'), 'instant portal keeps the KYC gate markup');
  assert.ok(instant.includes('dashboard.js?v=20261010globalUsdt'), 'instant portal cache bust');
  assert.ok(!html.includes('verified banking') && !instant.includes('verified banking'), 'portal copy dropped banking KYC');
  assert.ok(i18n.includes('Virtual Visa cards do not need KYC'), 'english KYC hint');
  assert.ok(i18n.includes('Virtual Visa Card သုံးရန် KYC မလိုပါ'), 'burmese KYC hint');

  for (const src of [buy, sell, ads]) {
    assert.ok(src.includes('assertKycVerifiedForP2p'), 'P2P service requires verified KYC');
  }
  assert.ok(p2pRoutes.includes('P2P_RETIRED'), 'user P2P API is retired');
  assert.ok(!cards.includes('kyc') && !cards.includes('KYC'), 'card issue service has no KYC check');
  const requestRoute = sliceFn(userRoutes, "router.post('/cards/request'", "router.post('/cards/sync'");
  assert.ok(!/kyc/i.test(requestRoute), 'card request route has no KYC check');
  assert.ok(!/assertKycVerifiedForP2p/.test(userRoutes), 'user card routes do not assert P2P KYC');

  assert.ok(adminHtml.includes('id="kycRequestsTable"'), 'admin KYC queue');
  assert.ok(adminHtml.includes('id="kycStatusFilter"'), 'admin KYC filter');
  assert.ok(adminHtml.includes('id="kycDocumentViewerImg"'), 'admin document viewer');
  assert.ok(adminJs.includes('data-kyc-approve') && adminJs.includes('data-kyc-reject'), 'approve and reject actions');
  assert.ok(adminJs.includes("'/api/admin/kyc-requests/' + id + '/approve'"), 'approve endpoint');
  assert.ok(adminJs.includes("'/api/admin/kyc-requests/' + id + '/reject'"), 'reject endpoint');
  assert.ok(adminRoutes.includes("'/kyc-requests/:id/approve'") && adminRoutes.includes("'/kyc-requests/:id/reject'"), 'admin review routes');
  assert.ok(!adminHtml.includes('verified banking'), 'admin queue copy is P2P-only');

  const dbFile = path.join(os.tmpdir(), `eisy-p2p-kyc-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  for (const key of Object.keys(process.env)) {
    if (/SUPABASE|TURSO|PAGO|ADMIN_EMAIL|ADMIN_PASSWORD/i.test(key)) delete process.env[key];
  }
  process.env.DATABASE_URL = `file:${dbFile}`;

  const { initDb, closeDb } = require('../src/db');
  await initDb();
  const User = require('../src/models/User');
  const { assertKycVerifiedForP2p } = require('../src/services/kycService');
  const stamp = Date.now();
  const user = await User.create({
    name: 'P2P KYC Tester',
    phone: `09${String(stamp).slice(-8)}`,
    email: `p2p-kyc-${stamp}@example.com`,
    pinHash: 'testhash',
  });

  let blocked = null;
  try {
    await assertKycVerifiedForP2p(user.id);
  } catch (err) {
    blocked = err;
  }
  assert.strictEqual(blocked && blocked.code, 'KYC_REQUIRED', 'unverified user cannot trade P2P');
  assert.strictEqual(blocked.kyc_status, 'UNVERIFIED');

  const { getDb } = require('../src/db');
  await getDb().run(`UPDATE users SET kyc_status = 'VERIFIED' WHERE id = ?`, user.id);
  const verified = await assertKycVerifiedForP2p(user.id);
  assert.strictEqual(verified.id, user.id, 'verified user passes the P2P KYC gate');

  await closeDb();
  console.log('ok — KYC is required for P2P only');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
