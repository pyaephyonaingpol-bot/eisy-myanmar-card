const { getDb } = require('../db');
const User = require('../models/User');
const P2PAd = require('../models/P2PAd');
const P2PBuyOrder = require('../models/P2PBuyOrder');
const TransactionLog = require('../models/TransactionLog');
const { formatUsdt, formatMmk } = require('./walletService');
const { consumeEscrowToBuyer, ensureActiveEscrowHold } = require('./usdtLedgerService');
const { getCardPricingSettings, calculateP2pFeeBreakdown } = require('./settingsService');
const { PLATFORM_FEE_TYPES } = require('./platformRevenueService');
const { parsePaymentMethods } = require('./p2pMarketService');
const { expiresAtFromNow } = require('./p2pOrderExpiryService');
const { getAdForTrade, getPaymentAccountFromAd } = require('./p2pAdService');
const { assertKycVerifiedForP2p } = require('./kycService');

function generateRefCode() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `P2P-${num}`;
}

async function uniqueP2pRefCode() {
  const db = getDb();
  let refCode;
  let attempts = 0;
  do {
    refCode = generateRefCode();
    const existing = await db.get('SELECT id FROM p2p_buy_orders WHERE ref_code = ?', refCode);
    if (!existing) break;
    attempts++;
  } while (attempts < 10);
  return refCode;
}

function parsePaymentAccounts(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function getPaymentAccountForMethod(seller, paymentMethod) {
  const accounts = parsePaymentAccounts(seller.payment_accounts);
  const method = String(paymentMethod || '').trim();
  if (accounts[method]) return { method, ...accounts[method] };

  const normalized = method.toLowerCase();
  for (const [key, val] of Object.entries(accounts)) {
    if (key.toLowerCase() === normalized) return { method: key, ...val };
  }
  return null;
}

function mapPaymentAccountForClient(account) {
  if (!account) return null;
  return {
    method: account.method,
    account_name: account.account_name || '',
    account_number: account.account_number || '',
    bank_name: account.bank_name || null,
  };
}

async function createP2pBuyOrder(userId, body) {
  await assertKycVerifiedForP2p(userId);
  const adId = parseInt(body.ad_id, 10);
  if (!adId) {
    throw new Error('Select a user P2P listing to buy from — platform merchants are no longer supported');
  }
  return createP2pBuyOrderFromAd(userId, {
    adId,
    amount_usdt: body.amount_usdt,
    payment_method: body.payment_method,
  });
}

async function createP2pBuyOrderFromAd(userId, { adId, amount_usdt, payment_method }) {
  const { ad, user: makerUser, mapped } = await getAdForTrade(adId, {
    side: 'sell',
    excludeUserId: userId,
  });

  const priceMmk = Number(ad.price_mmk_per_usdt);
  const amountUsdt = parseFloat(amount_usdt);
  if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) {
    throw new Error('Enter a valid USDT amount');
  }

  const minOrder = Number(ad.min_order_usdt);
  const maxOrder = Number(ad.max_order_usdt);
  if (amountUsdt < minOrder) {
    throw new Error(`Minimum order is $${minOrder.toFixed(2)} USDT`);
  }
  if (amountUsdt > maxOrder) {
    throw new Error(`Maximum order is $${maxOrder.toFixed(2)} USDT`);
  }
  if (amountUsdt > Number(ad.available_volume_usdt)) {
    throw new Error(`Only ${Number(ad.available_volume_usdt).toFixed(2)} USDT available on this ad`);
  }

  const methods = parsePaymentMethods(ad.payment_methods);
  const paymentMethod = String(payment_method || '').trim();
  if (!paymentMethod || !methods.some((m) => m.toLowerCase() === paymentMethod.toLowerCase())) {
    throw new Error('Select a valid payment method for this ad');
  }
  const matchedMethod = methods.find((m) => m.toLowerCase() === paymentMethod.toLowerCase()) || paymentMethod;
  const paymentAccount = await getPaymentAccountFromAd(ad, matchedMethod);
  if (!paymentAccount?.account_number) {
    throw new Error(`Seller has no ${matchedMethod} account configured`);
  }

  const amountMmk = Math.round(amountUsdt * priceMmk);
  const refCode = await uniqueP2pRefCode();
  const settings = await getCardPricingSettings();
  const feeBreakdown = calculateP2pFeeBreakdown(amountUsdt, settings);
  const roundedUsdt = Math.round(amountUsdt * 100) / 100;

  if (Number(ad.escrow_locked_usdt) < roundedUsdt - 0.001) {
    throw new Error('Seller ad has insufficient escrow for this trade');
  }

  const db = getDb();
  const activeHold = await ensureActiveEscrowHold(db, {
    userId: ad.user_id,
    referenceType: 'p2p_ads',
    referenceId: adId,
    holdType: 'p2p_ad',
  });
  if (!activeHold) {
    throw new Error('Seller ad escrow is not ready — ask the seller to re-post the listing');
  }
  if (Number(activeHold.remaining_usdt) < roundedUsdt - 0.001) {
    throw new Error('Seller ad has insufficient escrow hold for this trade');
  }

  await P2PAd.reserveVolume(adId, roundedUsdt);

  const order = await P2PBuyOrder.create({
    userId,
    sellerId: null,
    adId,
    makerUserId: ad.user_id,
    refCode,
    amountUsdt: roundedUsdt,
    amountMmk,
    priceMmkPerUsdt: priceMmk,
    paymentMethod: matchedMethod,
    expiresAt: expiresAtFromNow(),
    metadata: {
      ad_id: adId,
      maker_user_id: ad.user_id,
      seller_name: makerUser?.name || mapped.name,
      seller_network: ad.network,
      payment_source: 'external_bank',
      marketplace_type: 'c2c',
      fee_percent_applied: feeBreakdown.fee_percent,
      platform_fee_usdt_preview: feeBreakdown.platform_fee_usdt,
      buyer_receives_usdt_preview: feeBreakdown.buyer_receives_usdt,
      seller_total_usdt_preview: feeBreakdown.seller_total_usdt,
    },
  });

  await TransactionLog.create({
    userId,
    type: 'p2p_buy_order',
    direction: 'neutral',
    amountUsd: roundedUsdt,
    amountMmk,
    referenceType: 'p2p_buy_orders',
    referenceId: order.id,
    description: `P2P buy order (C2C) — ${refCode} via ${matchedMethod}`,
    createdBy: 'user',
    metadata: {
      ad_id: adId,
      maker_user_id: ad.user_id,
      payment_method: matchedMethod,
      status: 'pending_payment',
      marketplace_type: 'c2c',
    },
  });

  return {
    order: P2PBuyOrder.mapForClient(order, { seller: { name: makerUser?.name, network: ad.network }, user: null }),
    payment_account: mapPaymentAccountForClient(paymentAccount),
    payment_source: 'external_bank',
    fee: feeBreakdown,
    seller: {
      id: ad.user_id,
      ad_id: adId,
      name: makerUser?.name || mapped.name,
      network: ad.network,
      price_mmk_per_usdt: priceMmk,
    },
  };
}

async function confirmMmkTransfer(orderId, userId, {
  proofPath,
  proofOriginalName,
  proofMimeType,
  txRef,
} = {}) {
  const order = await P2PBuyOrder.findById(orderId);
  if (!order) throw new Error('Order not found');
  if (order.user_id !== userId) throw new Error('Access denied');
  if (!order.ad_id) throw new Error('Invalid order — not linked to a user ad');
  if (order.status !== 'pending_payment') {
    throw new Error(`Order cannot be confirmed in status: ${order.status}`);
  }
  if (!proofPath) {
    throw new Error('Upload a payment receipt / payslip screenshot before confirming transfer');
  }

  await P2PBuyOrder.savePaymentProof(orderId, {
    proofPath,
    originalName: proofOriginalName,
    mimeType: proofMimeType,
    txRef: txRef || null,
  });

  const updated = await P2PBuyOrder.updateStatus(orderId, 'pending_seller_release');
  const user = await User.findById(userId);
  const maker = order.maker_user_id ? await User.findById(order.maker_user_id) : null;

  await TransactionLog.create({
    userId,
    type: 'p2p_buy_order',
    direction: 'neutral',
    amountUsd: order.amount_usdt,
    amountMmk: order.amount_mmk,
    referenceType: 'p2p_buy_orders',
    referenceId: orderId,
    description: `User confirmed external payment — ${order.ref_code} pending seller release`,
    createdBy: 'user',
    metadata: {
      status: 'pending_seller_release',
      ad_id: order.ad_id,
      maker_user_id: order.maker_user_id,
      payment_source: 'external_bank',
      marketplace_type: 'c2c',
      payment_tx_ref: txRef || null,
      payment_proof_path: proofPath,
    },
  });

  const P2POrderMessage = require('../models/P2POrderMessage');
  await P2POrderMessage.create({
    orderType: 'buy',
    orderId,
    senderRole: 'user',
    senderUserId: userId,
    message: 'Payment transfer confirmed with receipt',
    attachmentPath: proofPath,
    txRef: txRef || null,
  });

  return {
    order: P2PBuyOrder.mapForClient(updated, {
      seller: maker ? { name: maker.name } : null,
      user,
    }),
    message: 'Payment confirmed — waiting for the seller to release USDT to your wallet.',
  };
}

async function releaseP2pBuyOrder(orderId, { adminNote, reviewedBy = 'admin', makerUserId, finalStatus = 'released' } = {}) {
  const order = await P2PBuyOrder.findById(orderId);
  if (!order) throw new Error('Order not found');
  if (order.status !== 'pending_seller_release') {
    throw new Error(`Order cannot be released in status: ${order.status}`);
  }

  if (!order.ad_id) {
    throw new Error('Legacy platform merchant orders are no longer supported');
  }

  const isAdminRelease = reviewedBy === 'admin' || String(reviewedBy).startsWith('admin');
  const actorType = isAdminRelease ? 'admin' : 'user';
  if (makerUserId) {
    if (order.maker_user_id !== makerUserId) {
      throw new Error('Only the ad owner can release USDT for this order');
    }
  } else if (!isAdminRelease) {
    throw new Error('This order must be released by the seller (ad owner)');
  }

  const maker = order.maker_user_id ? await User.findById(order.maker_user_id) : null;
  const amountUsdt = Number(order.amount_usdt);
  const settings = await getCardPricingSettings();

  let metadata = {};
  try {
    metadata = order.metadata ? JSON.parse(order.metadata) : {};
  } catch (_) { /* ignore */ }

  const feePercent = metadata.fee_percent_applied ?? settings.p2p_seller_fee_percent;
  const feeBreakdown = calculateP2pFeeBreakdown(amountUsdt, {
    ...settings,
    p2p_seller_fee_percent: feePercent,
  });
  const platformFee = feeBreakdown.platform_fee_usdt;
  const buyerReceives = feeBreakdown.buyer_receives_usdt;
  const sellerTotalUsdt = feeBreakdown.seller_total_usdt;

  await consumeEscrowToBuyer({
    fromUserId: order.maker_user_id,
    toUserId: order.user_id,
    grossAmountUsdt: sellerTotalUsdt,
    netToBuyerUsdt: buyerReceives,
    platformFeeUsdt: platformFee,
    holdReference: {
      referenceType: 'p2p_ads',
      referenceId: order.ad_id,
      holdType: 'p2p_ad',
    },
    description: `P2P buy order released — ${order.ref_code} (${formatUsdt(sellerTotalUsdt)} from seller escrow)`,
    buyerDescription: `P2P buy order — ${formatUsdt(buyerReceives)} received (${order.ref_code})`,
    referenceType: 'p2p_buy_orders',
    referenceId: orderId,
    platformFeeType: PLATFORM_FEE_TYPES.P2P,
    platformMetadata: {
      description: `P2P seller platform fee — ${order.ref_code} (${formatUsdt(platformFee)} @ ${feePercent}%)`,
      p2p_buy_order_id: orderId,
      ad_id: order.ad_id,
      fee_percent: feePercent,
      fee_paid_by: 'seller',
    },
    metadata: {
      p2p_buy_order_id: orderId,
      ad_id: order.ad_id,
      payment_method: order.payment_method,
      amount_mmk: order.amount_mmk,
      fee_percent_applied: feePercent,
    },
    createdBy: actorType,
  });

  const updated = await P2PBuyOrder.updateStatus(orderId, finalStatus, {
    adminNote,
    platformFeeUsdt: platformFee,
    netUsdtToBuyer: buyerReceives,
    feePercentApplied: feePercent,
  });

  if (order.ad_id) {
    await P2PAd.consumeEscrow(order.ad_id, sellerTotalUsdt);
  }

  const user = await User.findById(order.user_id);

  await TransactionLog.create({
    userId: order.user_id,
    type: 'p2p_buy_order_release',
    direction: 'credit',
    amountUsd: buyerReceives,
    amountMmk: order.amount_mmk,
    referenceType: 'p2p_buy_orders',
    referenceId: orderId,
    description: `P2P buy order ${order.ref_code} released — ${formatUsdt(buyerReceives)} to buyer, ${formatUsdt(platformFee)} platform fee from seller escrow`,
    createdBy: actorType,
    metadata: {
      admin_note: adminNote,
      buyer_receives_usdt: buyerReceives,
      seller_total_usdt: sellerTotalUsdt,
      platform_fee_usdt: platformFee,
      fee_percent_applied: feePercent,
      fee_paid_by: 'seller',
      escrow_ledger: true,
    },
  });

  return {
    order: P2PBuyOrder.mapForClient(updated, { seller: maker ? { name: maker.name } : null, user }),
    user: {
      id: user.id,
      balance_usdt: user.balance_usdt,
      balance_usdt_locked: user.balance_usdt_locked,
    },
    fee: feeBreakdown,
    message: finalStatus === 'completed_by_admin'
      ? 'USDT Force Released to Buyer'
      : `Released ${formatUsdt(buyerReceives)} to buyer (${formatUsdt(platformFee)} platform fee deducted from seller escrow)`,
  };
}

async function releaseP2pBuyOrderByMaker(orderId, makerUserId) {
  return releaseP2pBuyOrder(orderId, { makerUserId, reviewedBy: 'user' });
}

async function rejectP2pBuyOrder(orderId, { adminNote, rejectionReason, reviewedBy = 'admin', finalStatus = 'rejected' } = {}) {
  const order = await P2PBuyOrder.findById(orderId);
  if (!order) throw new Error('Order not found');
  if (!['pending_payment', 'pending_seller_release'].includes(order.status)) {
    throw new Error(`Order cannot be rejected in status: ${order.status}`);
  }

  const actorType = (reviewedBy === 'admin' || String(reviewedBy).startsWith('admin')) ? 'admin' : 'user';

  if (order.ad_id) {
    await P2PAd.restoreVolume(order.ad_id, Number(order.amount_usdt));
  }

  const updated = await P2PBuyOrder.updateStatus(orderId, finalStatus, {
    adminNote: adminNote || rejectionReason,
  });

  await TransactionLog.create({
    userId: order.user_id,
    type: 'p2p_buy_order_rejected',
    direction: 'neutral',
    amountUsd: order.amount_usdt,
    amountMmk: order.amount_mmk,
    referenceType: 'p2p_buy_orders',
    referenceId: orderId,
    description: `P2P buy order rejected — ${order.ref_code}: ${rejectionReason || adminNote || 'No reason'}`,
    createdBy: actorType,
    metadata: {
      ad_id: order.ad_id,
      maker_user_id: order.maker_user_id,
      escrow_restored_to_seller_ad: Boolean(order.ad_id),
    },
  });

  return {
    order: P2PBuyOrder.mapForClient(updated),
    message: finalStatus === 'cancelled_by_admin'
      ? 'Dispute Rejected - Escrow Refunded to Seller'
      : 'P2P buy order rejected',
  };
}

async function adminRefundP2pBuyOrderDispute(orderId, { adminNote, reviewedBy = 'admin' } = {}) {
  return rejectP2pBuyOrder(orderId, {
    adminNote,
    rejectionReason: adminNote,
    reviewedBy,
    finalStatus: 'cancelled_by_admin',
  });
}

async function listP2pBuyOrdersForAdmin({ status } = {}) {
  const rows = await P2PBuyOrder.listByStatus(status || 'pending_seller_release');
  const settings = await getCardPricingSettings();
  const enriched = await Promise.all(rows.map(async (row) => {
    const maker = row.maker_user_id ? await User.findById(row.maker_user_id) : null;
    const user = await User.findById(row.user_id);
    const mapped = P2PBuyOrder.mapForClient(row, { seller: maker ? { name: maker.name } : null, user });
    const feePercent = mapped.fee_percent_applied ?? mapped.metadata?.fee_percent_applied ?? settings.p2p_seller_fee_percent;
    const fee = calculateP2pFeeBreakdown(row.amount_usdt, { ...settings, p2p_seller_fee_percent: feePercent });
    return { ...mapped, fee };
  }));
  return enriched;
}

async function listP2pBuyOrdersForUser(userId) {
  const rows = await P2PBuyOrder.findByUserId(userId);
  const settings = await getCardPricingSettings();
  const enriched = await Promise.all(rows.map(async (row) => {
    const maker = row.maker_user_id ? await User.findById(row.maker_user_id) : null;
    const mapped = P2PBuyOrder.mapForClient(row, { seller: maker ? { name: maker.name } : null });
    const fee = calculateP2pFeeBreakdown(row.amount_usdt, settings);
    return { ...mapped, fee };
  }));
  return enriched;
}

async function getP2pFeeInfo() {
  const settings = await getCardPricingSettings();
  return {
    buyer_fee_percent: 0,
    buyer_fee_label: '0% Fee for Buyers',
    buyer_fee_note: '0% Fee for Buyers. Seller pays platform fee upon release.',
    p2p_seller_fee_percent: settings.p2p_seller_fee_percent,
    platform_usdt_revenue_balance: settings.platform_usdt_revenue_balance,
  };
}

module.exports = {
  parsePaymentAccounts,
  getPaymentAccountForMethod,
  mapPaymentAccountForClient,
  createP2pBuyOrder,
  confirmMmkTransfer,
  releaseP2pBuyOrder,
  releaseP2pBuyOrderByMaker,
  rejectP2pBuyOrder,
  adminRefundP2pBuyOrderDispute,
  listP2pBuyOrdersForAdmin,
  listP2pBuyOrdersForUser,
  getP2pFeeInfo,
};
