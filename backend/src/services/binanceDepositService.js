const crypto = require('crypto');
const { getDb } = require('../db');
const DepositRequest = require('../models/DepositRequest');
const TransactionLog = require('../models/TransactionLog');
const {
  calculateUsdtPaymentFeeBreakdown,
  assertValidPaymentAmount,
} = require('./paymentFeeService');
const { getDepositFeeSettings } = require('./settingsService');
const {
  createBinancePayOrder,
  parseWebhookEvent,
  verifyWebhookSignature,
  queryBinancePayOrder,
  getCredentials,
} = require('./binancePayService');
const { creditDepositAndVerify, uniqueRefCode } = require('./depositService');
const { formatUsdt } = require('./walletService');
const { enrichDeposit } = require('./depositEnrichment');
const { joinPublicUrl } = require('../lib/publicUrl');

function generateMerchantTradeNo(userId) {
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  const uid = String(userId || 0).padStart(4, '0').slice(-6);
  // Binance requires <= 32 alphanumeric chars
  return `BP${Date.now()}${uid}${suffix}`.slice(0, 32);
}

async function findDepositByMerchantTradeNo(merchantTradeNo) {
  const tradeNo = String(merchantTradeNo || '').trim();
  if (!tradeNo) return null;

  const db = getDb();
  const byMeta = await db.get(`
    SELECT * FROM deposit_requests_v2
    WHERE json_extract(metadata, '$.binance_merchant_trade_no') = ?
       OR json_extract(metadata, '$.merchantTradeNo') = ?
       OR ref_code = ?
    ORDER BY id DESC
    LIMIT 1
  `, tradeNo, tradeNo, tradeNo);

  if (byMeta) return byMeta;
  return DepositRequest.findByRefCode(tradeNo);
}

/**
 * Create a Binance Pay deposit order.
 * Fee rule: Math.max(amount * 0.02, 1) → user pays gross, wallet receives net.
 */
async function createBinancePayDeposit(userId, {
  amount_usdt,
  amount,
  currency = 'USDT',
  terminalType = 'WEB',
  returnUrl,
  cancelUrl,
  description,
} = {}) {
  const gross = parseFloat(amount_usdt != null ? amount_usdt : amount);
  if (!Number.isFinite(gross) || gross <= 0) {
    throw new Error('Positive amount_usdt is required');
  }

  const settings = await getDepositFeeSettings();
  const minUsdt = settings.minimum_usdt_deposit ?? 5;
  if (gross < minUsdt) {
    throw new Error(`Minimum Binance Pay deposit is $${Number(minUsdt).toFixed(2)} USDT`);
  }

  const feeBreakdown = calculateUsdtPaymentFeeBreakdown(gross, settings);
  assertValidPaymentAmount(feeBreakdown, { kind: 'Binance Pay deposit' });

  const merchantTradeNo = generateMerchantTradeNo(userId);
  const refCode = await uniqueRefCode();
  const { merchantId } = getCredentials();
  const webhookUrl = process.env.BINANCE_PAY_WEBHOOK_URL
    || joinPublicUrl('/api/webhook/binance');

  const metadata = {
    deposit_currency: 'USDT',
    deposit_channel: 'binance_pay',
    payment_provider: 'binance_pay',
    binance_merchant_id: merchantId || null,
    binance_merchant_trade_no: merchantTradeNo,
    merchantTradeNo,
    amount_usdt: feeBreakdown.amount_usdt,
    gross_usdt: feeBreakdown.amount_usdt,
    fee_usdt: feeBreakdown.fee_usdt,
    net_usdt: feeBreakdown.net_usdt,
    payment_fee: {
      operation: 'deposit',
      currency: 'USDT',
      provider: 'binance_pay',
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
      deposit_channel: 'binance_pay',
    },
  };

  const deposit = await DepositRequest.create({
    userId,
    amountMmk: 0,
    amountUsd: feeBreakdown.amount_usdt,
    refCode,
    paymentMethod: 'BINANCE_PAY',
    purpose: 'usdt_topup',
    depositCurrency: 'USDT',
    usdtNetwork: 'BINANCE_PAY',
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
    description: `[usdt_topup] Binance Pay deposit ${refCode} — gross ${formatUsdt(feeBreakdown.amount_usdt)}, fee ${formatUsdt(feeBreakdown.fee_usdt)}, net ${formatUsdt(feeBreakdown.net_usdt)}`,
    createdBy: 'user',
    metadata: {
      purpose: 'usdt_topup',
      deposit_channel: 'binance_pay',
      binance_merchant_trade_no: merchantTradeNo,
      payment_fee: metadata.payment_fee,
    },
  });

  let order;
  try {
    order = await createBinancePayOrder({
      merchantTradeNo,
      orderAmount: feeBreakdown.amount_usdt,
      currency: currency || 'USDT',
      description: description || `Eisy Myanmar deposit ${refCode}`,
      goodsName: 'USDT Wallet Deposit',
      terminalType,
      returnUrl: returnUrl || process.env.BINANCE_PAY_RETURN_URL || joinPublicUrl('/#deposits'),
      cancelUrl: cancelUrl || process.env.BINANCE_PAY_CANCEL_URL || joinPublicUrl('/#deposits'),
      webhookUrl,
    });
  } catch (err) {
    await DepositRequest.review(deposit.id, {
      status: 'FAILED',
      rejectionReason: err.message || 'Binance Pay order creation failed',
      adminNote: 'Binance Pay API error on create',
    }).catch(() => {});
    throw err;
  }

  const db = getDb();
  const nextMeta = {
    ...metadata,
    binance_prepay_id: order.prepayId,
    binance_checkout_url: order.checkoutUrl || order.universalUrl,
    binance_qrcode_link: order.qrcodeLink,
    binance_expire_time: order.expireTime,
  };
  await db.run(
    `UPDATE deposit_requests_v2 SET metadata = ?, updated_at = datetime('now') WHERE id = ?`,
    JSON.stringify(nextMeta),
    deposit.id
  );

  const refreshed = await DepositRequest.findById(deposit.id);

  return {
    deposit: enrichDeposit(refreshed),
    fee_breakdown: feeBreakdown,
    binance: {
      merchant_trade_no: order.merchantTradeNo,
      prepay_id: order.prepayId,
      checkout_url: order.checkoutUrl || order.universalUrl,
      qrcode_link: order.qrcodeLink,
      qr_content: order.qrContent,
      deeplink: order.deeplink,
      expire_time: order.expireTime,
      currency: order.currency,
      order_amount: order.orderAmount,
    },
    message: `Pay $${feeBreakdown.amount_usdt.toFixed(2)} via Binance Pay. Service fee ${feeBreakdown.fee_label}; net credit $${feeBreakdown.net_usdt.toFixed(2)} USDT after success.`,
  };
}

/**
 * Handle Binance Pay webhook. Credits net USDT on PAY_SUCCESS.
 */
async function handleBinancePayWebhook(req) {
  const timestamp = req.headers['binancepay-timestamp'] || req.headers['BinancePay-Timestamp'];
  const nonce = req.headers['binancepay-nonce'] || req.headers['BinancePay-Nonce'];
  const signature = req.headers['binancepay-signature'] || req.headers['BinancePay-Signature'];
  const certificateSn = req.headers['binancepay-certificate-sn'] || req.headers['BinancePay-Certificate-SN'];
  const rawBody = req.rawBody || JSON.stringify(req.body || {});

  const verified = await verifyWebhookSignature({
    timestamp,
    nonce,
    signature,
    certificateSn,
    rawBody,
  });

  if (!verified.ok) {
    const err = new Error(`Invalid Binance Pay webhook signature (${verified.reason || 'verify_failed'})`);
    err.code = 'BINANCE_WEBHOOK_INVALID_SIGNATURE';
    throw err;
  }

  const event = parseWebhookEvent(req.body || {});
  if (!event.isPaySuccess) {
    return {
      ignored: true,
      bizStatus: event.bizStatus,
      message: `Ignored non-success status: ${event.bizStatus || 'unknown'}`,
    };
  }

  if (!event.merchantTradeNo) {
    throw new Error('Webhook missing merchantTradeNo');
  }

  const deposit = await findDepositByMerchantTradeNo(event.merchantTradeNo);
  if (!deposit) {
    const err = new Error(`Deposit not found for merchantTradeNo ${event.merchantTradeNo}`);
    err.code = 'DEPOSIT_NOT_FOUND';
    throw err;
  }

  if (deposit.status === 'VERIFIED') {
    return {
      alreadyVerified: true,
      deposit: enrichDeposit(deposit),
      message: 'Deposit already credited',
    };
  }

  // Prefer confirming with Binance query API before credit (default on when configured)
  const shouldQuery = process.env.BINANCE_PAY_QUERY_BEFORE_CREDIT !== 'false';
  if (shouldQuery) {
    try {
      const query = await queryBinancePayOrder({
        prepayId: event.prepayId,
        merchantTradeNo: event.merchantTradeNo,
      });
      const status = String(query?.data?.status || query?.data?.orderStatus || '').toUpperCase();
      if (status && !['PAID', 'SUCCESS', 'PAY_SUCCESS'].includes(status)) {
        throw new Error(`Binance order status is ${status}, not paid`);
      }
      const paidAmount = Number(
        query?.data?.totalFee
        ?? query?.data?.orderAmount
        ?? query?.data?.amount
        ?? event.totalFee
      );
      const expected = Number(deposit.amount_usd);
      if (Number.isFinite(paidAmount) && Number.isFinite(expected) && expected > 0) {
        const tol = Math.max(0.01, expected * 0.005);
        if (Math.abs(paidAmount - expected) > tol) {
          const err = new Error(
            `Binance paid amount (${paidAmount}) does not match deposit gross (${expected})`
          );
          err.code = 'BINANCE_AMOUNT_MISMATCH';
          throw err;
        }
      }
    } catch (queryErr) {
      if (queryErr.code === 'BINANCE_AMOUNT_MISMATCH') throw queryErr;
      if (queryErr.code !== 'BINANCE_PAY_NOT_CONFIGURED') {
        // Fail closed when query is available but rejects; warn-only if not configured
        if (String(queryErr.message || '').includes('not paid') || queryErr.code === 'BINANCE_ORDER_UNPAID') {
          throw queryErr;
        }
        console.warn('[binancePay] query-before-credit failed:', queryErr.message);
      }
    }
  } else if (event.totalFee != null && Number.isFinite(Number(event.totalFee))) {
    const paidAmount = Number(event.totalFee);
    const expected = Number(deposit.amount_usd);
    const tol = Math.max(0.01, expected * 0.005);
    if (Number.isFinite(expected) && Math.abs(paidAmount - expected) > tol) {
      const err = new Error(
        `Binance paid amount (${paidAmount}) does not match deposit gross (${expected})`
      );
      err.code = 'BINANCE_AMOUNT_MISMATCH';
      throw err;
    }
  }

  const txnId = event.transactionId || event.prepayId || event.merchantTradeNo;
  const { assertTxHashAvailable } = require('./depositService');
  await assertTxHashAvailable(txnId, deposit.id);

  const result = await creditDepositAndVerify(deposit, {
    txnId,
    createdBy: 'binance_pay',
    adminNote: `Binance Pay PAY_SUCCESS — trade ${event.merchantTradeNo}`,
  });

  return {
    credited: true,
    alreadyVerified: Boolean(result.alreadyVerified),
    deposit: enrichDeposit(result.deposit),
    net_usdt: result.net_usdt,
    fee_usdt: result.fee_usdt,
    gross_usdt: result.gross_usdt,
    message: result.alreadyVerified
      ? 'Deposit already credited'
      : `Binance Pay success — credited ${formatUsdt(result.net_usdt || 0)} (after fee)`,
  };
}

module.exports = {
  createBinancePayDeposit,
  handleBinancePayWebhook,
  findDepositByMerchantTradeNo,
  generateMerchantTradeNo,
};
