/**
 * Custom TRON USDT (TRC20) payment gateway — order creation + poller bootstrap.
 * Matching / credit lives in tronDepositCreditService (shared with webhook + cron).
 */
const crypto = require('crypto');
const supabaseLib = require('../lib/supabase');
const { getMasterWalletAddress } = require('./tronMasterWalletService');
const DepositRequest = require('../models/DepositRequest');
const TransactionLog = require('../models/TransactionLog');
const {
  calculateUsdtPaymentFeeBreakdown,
  assertValidPaymentAmount,
} = require('./paymentFeeService');
const { getDepositFeeSettings } = require('./settingsService');
const { uniqueRefCode, assertNoRapidDuplicateUsdtDeposit } = require('./depositService');
const { formatUsdt } = require('./walletService');
const credit = require('./tronDepositCreditService');

const DEFAULT_MASTER_DEPOSIT_ADDRESS = 'TM8LqqR6Tz8qbvGRYAMbHv2PQgw3biPgqH';
const USDT_TRC20_CONTRACT = credit.USDT_TRC20_CONTRACT;
const ORDER_STATUS_PENDING = credit.ORDER_STATUS_PENDING;
const ORDER_STATUS_COMPLETED = credit.ORDER_STATUS_COMPLETED;

const {
  mapOrderRow,
  amountWithinTolerance,
  parseTrc20TransferAmount,
  findDepositByTronOrderId,
  creditTronOrderWallet,
  fetchIncomingUsdtTransfers,
  listPendingTronOrders,
  verifyPendingTronOrders,
  runTronOrderPollSafely,
} = credit;

/**
 * Master wallet users send USDT to. Prefers env overrides, then platform default.
 */
function getGatewayDepositAddress() {
  const explicit = String(
    process.env.TRON_GATEWAY_DEPOSIT_ADDRESS
    || process.env.MASTER_WALLET_ADDRESS
    || ''
  ).trim();
  if (explicit) return explicit;

  try {
    return getMasterWalletAddress();
  } catch {
    return DEFAULT_MASTER_DEPOSIT_ADDRESS;
  }
}

function generateBusinessOrderId() {
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `TRON${Date.now()}${suffix}`.slice(0, 32);
}

function roundUsdt(value) {
  return Math.round(Number(value) * 1e6) / 1e6;
}

function assertSupabaseConfigured() {
  if (!supabaseLib.isSupabaseEnabled()) {
    const err = new Error('Supabase is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    err.code = 'SUPABASE_NOT_CONFIGURED';
    throw err;
  }
  const sb = supabaseLib.getSupabase();
  if (!sb) {
    const err = new Error('Supabase client failed to initialize');
    err.code = 'SUPABASE_NOT_CONFIGURED';
    throw err;
  }
  return sb;
}

/**
 * Create a TRON gateway order in Supabase and a matching local pending deposit.
 * Canonical entry for all TRC20 deposit intents (wallet API, /api/tron/orders,
 * and /api/deposit/request).
 */
async function createTronOrder(userId, { amount_usdt, amount, metadata: extraMeta } = {}) {
  if (!userId) {
    const err = new Error('Authenticated user is required');
    err.code = 'TRON_ORDER_USER_REQUIRED';
    throw err;
  }

  const gross = parseFloat(amount_usdt != null ? amount_usdt : amount);
  if (!Number.isFinite(gross) || gross <= 0) {
    const err = new Error('Positive amount_usdt is required');
    err.code = 'TRON_ORDER_INVALID_AMOUNT';
    throw err;
  }

  const settings = await getDepositFeeSettings();
  const minUsdt = settings.minimum_usdt_deposit ?? 5;
  if (gross < minUsdt) {
    const err = new Error(`Minimum TRON deposit is $${Number(minUsdt).toFixed(2)} USDT`);
    err.code = 'TRON_ORDER_AMOUNT_TOO_LOW';
    throw err;
  }

  const feeBreakdown = calculateUsdtPaymentFeeBreakdown(gross, settings);
  assertValidPaymentAmount(feeBreakdown, { kind: 'TRON deposit' });

  await assertNoRapidDuplicateUsdtDeposit(userId, {
    amountUsdt: feeBreakdown.amount_usdt,
    network: 'TRC20',
  });

  const sb = assertSupabaseConfigured();
  const resolvedAddress = await (async () => {
    const { resolveUserTrc20DepositAddress } = require('./tronDepositAddressService');
    return resolveUserTrc20DepositAddress(userId, getGatewayDepositAddress);
  })();
  const depositAddress = resolvedAddress.address;
  const orderId = generateBusinessOrderId();
  const refCode = await uniqueRefCode();
  const normalizedAmount = roundUsdt(gross);
  const depositChannel = String(extraMeta?.deposit_channel || 'tron_trc20').toLowerCase();

  const metadata = {
    ...(extraMeta || {}),
    deposit_currency: 'USDT',
    deposit_channel: depositChannel === 'platform_direct' ? 'platform_direct' : 'tron_trc20',
    payment_provider: 'tron_trc20',
    tron_order_id: orderId,
    order_id: orderId,
    usdt_network: 'TRC20',
    deposit_address: depositAddress,
    deposit_address_source: resolvedAddress.source,
    derivation_index: resolvedAddress.index,
    derivation_path: resolvedAddress.path,
    amount_usdt: feeBreakdown.amount_usdt,
    gross_usdt: feeBreakdown.amount_usdt,
    fee_usdt: feeBreakdown.fee_usdt,
    net_usdt: feeBreakdown.net_usdt,
    payment_fee: {
      operation: 'deposit',
      currency: 'USDT',
      provider: 'tron_trc20',
      gross_usdt: feeBreakdown.amount_usdt,
      fee_usdt: feeBreakdown.fee_usdt,
      net_usdt: feeBreakdown.net_usdt,
      platform_profit_usd: feeBreakdown.fee_usdt,
      fee_percent: feeBreakdown.fee_percent,
      minimum_fee_usdt: feeBreakdown.minimum_fee_usdt,
      used_minimum_fee: feeBreakdown.used_minimum_fee,
      fee_rule: feeBreakdown.fee_rule,
      fee_label: feeBreakdown.fee_label,
    },
    pricing: {
      amount_usdt: feeBreakdown.amount_usdt,
      fee_usdt: feeBreakdown.fee_usdt,
      net_usdt: feeBreakdown.net_usdt,
      platform_profit_usd: feeBreakdown.fee_usdt,
      fee_percent: feeBreakdown.fee_percent,
      minimum_fee_usdt: feeBreakdown.minimum_fee_usdt,
      used_minimum_fee: feeBreakdown.used_minimum_fee,
      fee_label: feeBreakdown.fee_label,
      is_usdt_topup: true,
      deposit_channel: depositChannel === 'platform_direct' ? 'platform_direct' : 'tron_trc20',
    },
  };

  const deposit = await DepositRequest.create({
    userId,
    amountMmk: 0,
    amountUsd: feeBreakdown.amount_usdt,
    refCode,
    paymentMethod: 'USDT-TRC20',
    purpose: 'usdt_topup',
    depositCurrency: 'USDT',
    usdtNetwork: 'TRC20',
    metadata,
    platformProfitUsd: feeBreakdown.fee_usdt,
  });

  await TransactionLog.create({
    userId,
    type: 'deposit_request',
    direction: 'neutral',
    amountUsd: feeBreakdown.amount_usdt,
    referenceType: 'deposit_requests_v2',
    referenceId: deposit.id,
    description: `[usdt_topup] TRON deposit ${refCode} — gross ${formatUsdt(feeBreakdown.amount_usdt)}, fee ${formatUsdt(feeBreakdown.fee_usdt)}, net ${formatUsdt(feeBreakdown.net_usdt)}`,
    createdBy: 'user',
    metadata: {
      purpose: 'usdt_topup',
      deposit_channel: metadata.deposit_channel,
      tron_order_id: orderId,
      payment_fee: metadata.payment_fee,
    },
  }).catch((err) => {
    console.warn('[tron/orders] deposit_request log skipped:', err.message);
  });

  const row = {
    order_id: orderId,
    user_id: userId,
    local_deposit_id: deposit.id,
    ref_code: refCode,
    amount: normalizedAmount,
    deposit_address: depositAddress,
    status: ORDER_STATUS_PENDING,
  };

  const { data, error } = await sb
    .from('orders')
    .insert(row)
    .select('*')
    .single();

  if (error) {
    console.error('[tron/orders] Supabase insert failed:', error.message);
    const err = new Error(`Failed to create order: ${error.message}`);
    err.code = 'TRON_ORDER_INSERT_FAILED';
    throw err;
  }

  return {
    message: 'TRON USDT deposit order created',
    provider: 'tron_trc20',
    order: mapOrderRow(data),
    deposit: {
      id: deposit.id,
      ref_code: refCode,
      status: deposit.status,
    },
    fee_breakdown: feeBreakdown,
    payment: {
      network: 'TRC20',
      token: 'USDT',
      contract_address: USDT_TRC20_CONTRACT,
      deposit_address: depositAddress,
      deposit_address_source: resolvedAddress.source,
      derivation_index: resolvedAddress.index,
      amount_usdt: normalizedAmount,
    },
  };
}

async function findTronOrderByOrderId(orderId) {
  const sb = supabaseLib.getSupabase();
  if (!sb || !orderId) return null;

  const { data, error } = await sb
    .from('orders')
    .select('*')
    .eq('order_id', String(orderId))
    .maybeSingle();

  if (error) {
    console.error('[tron/orders] lookup failed:', error.message);
    throw new Error(`Order lookup failed: ${error.message}`);
  }
  return mapOrderRow(data);
}

function startTronOrderPoller({ intervalMs } = {}) {
  const ms = Math.max(
    10_000,
    parseInt(process.env.TRON_ORDER_POLL_MS || String(intervalMs || 30_000), 10) || 30_000
  );
  if (String(process.env.TRON_ORDER_POLL_ENABLED || 'true').toLowerCase() === 'false') {
    console.log('[tron/orders] background poll disabled (TRON_ORDER_POLL_ENABLED=false)');
    return null;
  }
  // On Vercel serverless the process is ephemeral — durable poll is cron.
  if (process.env.VERCEL) {
    console.log('[tron/orders] in-process poll skipped on Vercel (use /api/cron/tron-deposits)');
    return null;
  }

  const timer = setInterval(() => {
    runTronOrderPollSafely().catch((err) => {
      console.error('[tron/orders/poll]', err.message);
    });
  }, ms);
  timer.unref?.();

  runTronOrderPollSafely().catch((err) => {
    console.error('[tron/orders/poll] initial run failed:', err.message);
  });

  console.log(`[tron/orders] TronGrid poll every ${ms}ms`);
  return timer;
}

module.exports = {
  DEFAULT_MASTER_DEPOSIT_ADDRESS,
  ORDER_STATUS_PENDING,
  ORDER_STATUS_COMPLETED,
  getGatewayDepositAddress,
  createTronOrder,
  findTronOrderByOrderId,
  findDepositByTronOrderId,
  creditTronOrderWallet,
  fetchIncomingUsdtTransfers,
  listPendingTronOrders,
  verifyPendingTronOrders,
  runTronOrderPollSafely,
  startTronOrderPoller,
  parseTrc20TransferAmount,
  amountWithinTolerance,
  mapOrderRow,
};
