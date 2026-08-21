const User = require('../models/User');
const P2PAd = require('../models/P2PAd');
const TransactionLog = require('../models/TransactionLog');
const { formatUsdt } = require('./walletService');
const { lockUsdtForEscrow, refundEscrowHold } = require('./usdtLedgerService');
const { assertKycVerifiedForP2p } = require('./kycService');

function getPaymentAccountForMethod(accountsRaw, paymentMethod) {
  let accounts = accountsRaw;
  if (typeof accounts === 'string') {
    try { accounts = JSON.parse(accounts); } catch (_) { accounts = {}; }
  }
  if (!accounts || typeof accounts !== 'object') return null;
  const method = String(paymentMethod || '').trim();
  if (accounts[method]) return { method, ...accounts[method] };
  const normalized = method.toLowerCase();
  for (const [key, val] of Object.entries(accounts)) {
    if (key.toLowerCase() === normalized) return { method: key, ...val };
  }
  return null;
}

async function assertVerifiedUser(userId) {
  const user = await assertKycVerifiedForP2p(userId);
  if (user.auth_status && user.auth_status !== 'active') {
    throw new Error('Your account is not active');
  }
  return user;
}

function parsePaymentAccountsInput(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function buildPaymentAccountsFromBody(body) {
  const accounts = {};
  const kpayName = body.kpay_name || body.kpay_account_name;
  const kpayNum = body.kpay_number || body.kpay_account_number;
  const waveName = body.wave_name || body.wave_account_name;
  const waveNum = body.wave_number || body.wave_account_number;
  const kbzName = body.kbz_account_name;
  const kbzNum = body.kbz_account_number;
  const kbzBank = body.kbz_bank_name || 'KBZ Bank';
  if (kpayNum) accounts.KPay = { account_name: kpayName || '', account_number: String(kpayNum).trim() };
  if (waveNum) accounts.WavePay = { account_name: waveName || '', account_number: String(waveNum).trim() };
  if (kbzNum) {
    accounts['KBZ Bank'] = {
      account_name: kbzName || '',
      account_number: String(kbzNum).trim(),
      bank_name: kbzBank,
    };
  }
  if (body.payment_accounts) {
    return { ...parsePaymentAccountsInput(body.payment_accounts), ...accounts };
  }
  return accounts;
}

async function createP2pAd(userId, body) {
  const user = await assertVerifiedUser(userId);

  const side = body.side === 'buy' ? 'buy' : 'sell';
  const network = String(body.network || 'TRC20').toUpperCase();
  const priceMmk = parseFloat(body.price_mmk_per_usdt);
  const totalVolume = parseFloat(body.total_volume_usdt ?? body.total_usdt_volume);
  const minOrder = parseFloat(body.min_order_usdt ?? body.min_deposit ?? 5);
  const maxOrder = parseFloat(body.max_order_usdt ?? body.max_deposit ?? 1000);

  if (!Number.isFinite(priceMmk) || priceMmk <= 0) {
    throw new Error('Enter a valid exchange rate (MMK per USDT)');
  }
  if (!Number.isFinite(totalVolume) || totalVolume <= 0) {
    throw new Error('Enter a valid total USDT volume');
  }
  if (!Number.isFinite(minOrder) || minOrder <= 0) {
    throw new Error('Enter a valid minimum order size');
  }
  if (!Number.isFinite(maxOrder) || maxOrder < minOrder) {
    throw new Error('Maximum order must be at least the minimum');
  }
  if (maxOrder > totalVolume) {
    throw new Error('Maximum order cannot exceed total ad volume');
  }

  const paymentMethods = body.payment_methods
    ? (Array.isArray(body.payment_methods) ? body.payment_methods : String(body.payment_methods).split(',').map((s) => s.trim()).filter(Boolean))
    : ['KPay', 'WavePay', 'KBZ Bank'];

  const paymentAccounts = buildPaymentAccountsFromBody(body);
  for (const method of paymentMethods) {
    const acct = paymentAccounts[method];
    if (!acct?.account_number) {
      throw new Error(`Payment account required for ${method}`);
    }
  }

  const roundedVolume = Math.round(totalVolume * 100) / 100;

  let ad;
  try {
    ad = await P2PAd.create({
      userId,
      side,
      network,
      priceMmkPerUsdt: priceMmk,
      totalVolumeUsdt: roundedVolume,
      availableVolumeUsdt: roundedVolume,
      minOrderUsdt: minOrder,
      maxOrderUsdt: maxOrder,
      paymentMethods,
      paymentAccounts,
      escrowLockedUsdt: side === 'sell' ? roundedVolume : 0,
    });

    if (side === 'sell') {
      await lockUsdtForEscrow(userId, roundedVolume, {
        holdType: 'p2p_ad',
        referenceType: 'p2p_ads',
        referenceId: ad.id,
        description: `P2P sell ad escrow — ${formatUsdt(roundedVolume)} locked for marketplace listing`,
        createdBy: 'user',
        metadata: { side: 'sell', total_volume_usdt: roundedVolume },
      });
    }
  } catch (err) {
    if (ad?.id && side === 'sell') {
      await P2PAd.updateStatus(ad.id, 'cancelled').catch(() => {});
    }
    throw err;
  }

  await TransactionLog.create({
    userId,
    type: 'p2p_ad_created',
    direction: side === 'sell' ? 'debit' : 'neutral',
    amountUsd: roundedVolume,
    referenceType: 'p2p_ads',
    referenceId: ad.id,
    description: `P2P ${side} ad posted — ${Math.round(priceMmk).toLocaleString()} MMK/USDT, ${formatUsdt(roundedVolume)}`,
    createdBy: 'user',
    metadata: { side, price_mmk_per_usdt: priceMmk, payment_methods: paymentMethods },
  });

  const refreshedUser = await User.findById(userId);
  return {
    ad: P2PAd.mapForClient(ad, { user: refreshedUser }),
    user: {
      id: refreshedUser.id,
      balance_usdt: refreshedUser.balance_usdt,
      balance_usdt_locked: refreshedUser.balance_usdt_locked,
    },
    message: side === 'sell'
      ? `Sell ad posted — ${formatUsdt(roundedVolume)} USDT escrowed from your wallet`
      : 'Buy ad posted — users can sell USDT to you at your rate',
  };
}

async function cancelP2pAd(userId, adId) {
  const ad = await P2PAd.findById(adId);
  if (!ad) throw new Error('Ad not found');
  if (ad.user_id !== userId) throw new Error('Access denied');
  if (ad.status === 'cancelled' || ad.status === 'closed') {
    throw new Error('Ad is already closed');
  }

  const pendingBuy = await P2PAd.countPendingBuyOrders(adId);
  const pendingSell = await P2PAd.countPendingSellOrders(adId);
  if (pendingBuy + pendingSell > 0) {
    throw new Error('Cannot cancel ad while orders are in progress — wait for pending trades to finish');
  }

  let user = await User.findById(userId);
  const escrowRemaining = Number(ad.escrow_locked_usdt || 0);
  let escrowRefunded = 0;
  let escrowHoldMissing = false;

  if (ad.side === 'sell' && escrowRemaining > 0) {
    try {
      const refund = await refundEscrowHold({
        userId,
        referenceType: 'p2p_ads',
        referenceId: adId,
        holdType: 'p2p_ad',
        amountUsdt: escrowRemaining,
        description: `P2P sell ad cancelled — ${formatUsdt(escrowRemaining)} escrow refunded`,
        createdBy: 'user',
        metadata: { ad_cancel: true, escrow_refund: true },
      });
      escrowRefunded = refund.refundAmount;
      user = await User.findById(userId);
    } catch (err) {
      if (err.code !== 'ESCROW_HOLD_NOT_FOUND') throw err;
      escrowHoldMissing = true;
    }
    await P2PAd.clearEscrow(adId);
  }

  const updated = await P2PAd.updateStatus(adId, 'cancelled');

  await TransactionLog.create({
    userId,
    type: 'p2p_ad_cancelled',
    direction: ad.side === 'sell' && escrowRefunded > 0 ? 'credit' : 'neutral',
    amountUsd: escrowRefunded || escrowRemaining,
    referenceType: 'p2p_ads',
    referenceId: adId,
    description: escrowHoldMissing
      ? `P2P ${ad.side} ad cancelled — no escrow hold record (legacy listing cleared)`
      : `P2P ${ad.side} ad cancelled — ${formatUsdt(escrowRefunded || escrowRemaining)} escrow refunded`,
    createdBy: 'user',
    metadata: escrowHoldMissing ? { escrow_hold_missing: true, escrow_cleared: escrowRemaining } : undefined,
  });

  return {
    ad: P2PAd.mapForClient(updated, { user }),
    user: { id: user.id, balance_usdt: user.balance_usdt },
    message: ad.side === 'sell'
      ? (escrowHoldMissing
        ? 'Ad cancelled — listing removed (no escrow hold was on file for this ad)'
        : `Ad cancelled — ${formatUsdt(escrowRefunded || escrowRemaining)} USDT returned to your wallet`)
      : 'Buy ad cancelled',
  };
}

async function listMyP2pAds(userId) {
  const rows = await P2PAd.findByUserId(userId);
  const user = await User.findById(userId);
  return rows.map((row) => P2PAd.mapForClient(row, { user }));
}

async function getAdForTrade(adId, { side, excludeUserId } = {}) {
  const ad = await P2PAd.findById(adId);
  if (!ad || ad.status !== 'active') {
    throw new Error('This ad is no longer available');
  }
  if (side && ad.side !== side) {
    throw new Error('Ad type does not match this trade');
  }
  if (excludeUserId && ad.user_id === excludeUserId) {
    throw new Error('You cannot trade against your own ad');
  }
  const user = await User.findById(ad.user_id);
  return { ad, user, mapped: P2PAd.mapForClient(ad, { user }) };
}

async function getPaymentAccountFromAd(ad, paymentMethod) {
  return getPaymentAccountForMethod(ad.payment_accounts, paymentMethod);
}

module.exports = {
  assertVerifiedUser,
  createP2pAd,
  cancelP2pAd,
  listMyP2pAds,
  getAdForTrade,
  getPaymentAccountFromAd,
  buildPaymentAccountsFromBody,
};
