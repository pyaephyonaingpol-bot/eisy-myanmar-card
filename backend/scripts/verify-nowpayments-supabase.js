/**
 * Verify NOWPayments webhook wiring + Supabase `transactions` table.
 * Run: node backend/scripts/verify-nowpayments-supabase.js
 */
'use strict';

require('../src/lib/loadEnv');
const path = require('path');
const fs = require('fs');

const {
  isSupabaseEnabled,
  getSupabase,
  getSupabaseConfig,
} = require('../src/lib/supabase');
const {
  upsertSupabaseNowPaymentsTransaction,
  verifyNowPaymentsSignature,
  sortObjectDeep,
} = require('../src/services/nowPaymentsService');
const crypto = require('crypto');

async function main() {
  console.log('== NOWPayments + Supabase verification ==\n');

  const cfg = getSupabaseConfig();
  console.log('Supabase URL configured:', Boolean(cfg.url));
  console.log('Supabase enabled (server):', isSupabaseEnabled());

  if (!isSupabaseEnabled()) {
    console.error('\nFAIL: Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const sb = getSupabase();
  const { error: probeErr } = await sb.from('transactions').select('id').limit(1);
  if (probeErr) {
    console.error('\nFAIL: Supabase `public.transactions` is missing or inaccessible.');
    console.error('  ', probeErr.message);
    console.error('\nFix: run this SQL in Supabase → SQL Editor:');
    const sqlPath = path.join(__dirname, '..', '..', 'supabase', 'nowpayments_transactions.sql');
    console.error('\n---');
    console.error(fs.readFileSync(sqlPath, 'utf8'));
    console.error('---\n');
    process.exit(2);
  }
  console.log('OK: `transactions` table is reachable');

  const paymentId = `verify-${Date.now()}`;
  const orderId = `NP-VERIFY-${Date.now()}`;
  const row = await upsertSupabaseNowPaymentsTransaction({
    userId: 'verify-script',
    paymentId,
    amount: 1.23,
    currency: 'USDT',
    orderId,
    status: 'pending',
    paymentStatus: 'waiting',
    metadata: { provider: 'nowpayments', verify_script: true },
  });
  if (!row) {
    console.error('FAIL: upsert returned null');
    process.exit(1);
  }
  console.log('OK: inserted/upserted pending row', row.id, row.payment_id);

  const finished = await upsertSupabaseNowPaymentsTransaction({
    userId: 'verify-script',
    paymentId,
    amount: 1.23,
    currency: 'USDT',
    orderId,
    status: 'finished',
    paymentStatus: 'finished',
    metadata: { provider: 'nowpayments', verify_script: true, finished: true },
  });
  console.log('OK: marked finished', finished?.status, finished?.payment_status);

  // Cleanup probe row
  await sb.from('transactions').delete().eq('payment_id', paymentId);
  console.log('OK: cleaned probe row');

  // Signature smoke (does not hit network)
  const secret = String(process.env.NOWPAYMENTS_IPN_SECRET || 'verify-secret').trim();
  const prev = process.env.NOWPAYMENTS_IPN_SECRET;
  process.env.NOWPAYMENTS_IPN_SECRET = secret;
  const payload = {
    payment_id: paymentId,
    payment_status: 'confirming',
    order_id: orderId,
    pay_amount: 1.23,
  };
  const sig = crypto
    .createHmac('sha512', secret)
    .update(JSON.stringify(sortObjectDeep(payload)))
    .digest('hex');
  assertOk(verifyNowPaymentsSignature(payload, sig), 'signature verify');
  if (prev === undefined) delete process.env.NOWPAYMENTS_IPN_SECRET;
  else process.env.NOWPAYMENTS_IPN_SECRET = prev;

  console.log('\nWebhook listener path: POST /api/nowpayments/webhook');
  console.log('Create payment path:   POST /api/create-payment');
  console.log('\nAll checks passed.');
}

function assertOk(cond, label) {
  if (!cond) {
    console.error('FAIL:', label);
    process.exit(1);
  }
  console.log('OK:', label);
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
