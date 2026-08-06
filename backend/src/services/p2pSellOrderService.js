const User = require('../models/User');
const P2PAd = require('../models/P2PAd');
const P2PSellOrder = require('../models/P2PSellOrder');
const TransactionLog = require('../models/TransactionLog');
const { formatUsdt, formatMmk } = require('./walletService');
const { lockUsdtForEscrow, refundEscrowHold, consumeEscrowToBuyer } = require('./usdtLedgerService');
const { getCardPricingSettings, calculateP2pFeeBreakdown } = require('./settingsService');
const { PLATFORM_FEE_TYPES } = require('./platformRevenueService');
const { parsePaymentMethods } = require('./p2pMarketService');
const { notifyAdminP2pSellOrderReleased } = require('./telegram');
const { expiresAtFromNow } = require('./p2pOrderExpiryService');
const { getAdForTrade } = require('./p2pAdService');
const { assertKycVerifiedForP2p } = require('./kycService');

function generateRefCode() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `P2S-${num}`;
}

async function uniqueP2pSellRefCode() {
  const { getDb } = require('../db');
  const db = getDb();
  let refCode;
  let attempts = 0;
  do {
    refCode = generateRefCode();
    const existing = await db.get('SELECT id FROM p2p_sell_orders WHERE ref_code = ?', refCode);
    if (!existing) break;
    attempts++;
  } while (attempts < 10);
  return refCode;
}

function parseUserPaymentAccount(body) {
  const method = String(body.payment_method || '').trim();
  const accountName = String(body.account_name || body.user_account_name || '').trim();
  const accountNumber = String(body.account_number || body.user_account_number || '').trim();
  const bankName = String(body.bank_name || body.user_bank_name || '').trim() || null;

  if (!method) throw new Error('Payment method is required');
  if (!accountName) throw new Error('Your account name is required');
  if (!accountNumber) throw new Error('Your account number is required');

  return {
    method,
    account_name: accountName,
    account_number: accountNumber,
    bank_name: bankName,
  };
}

async function createP2pSellOrder(userId, body) {
  await assertKycVerifiedForP2p(userId);
  const adId = parseInt(body.ad_id, 10);
  if (!adId) {
    throw new Error('Select a user P2P listing to sell to — platform merchants are no longer supported');
  }
  return createP2pSellOrderFromAd(userId, { ...body, adId });
}

async function createP2pSellOrderFromAd(userId, {
  adId,
  amount_usdt,
  payment_method,
  account_name,
  account_number,
  bank_name,
}) {
  const { ad, user: makerUser, mapped } = await getAdForTrade(adId, {
    side: 'buy',
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
    throw new Error(`Buyer only wants ${Number(ad.available_volume_usdt).toFixed(2)} USDT remaining on this ad`);
  }

  const methods = parsePaymentMethods(ad.payment_methods);
  const userPaymentAccount = parseUserPaymentAccount({
    payment_method,
    account_name,
    account_number,
    bank_name,
  });
  const matchedMethod = methods.find((m) => m.toLowerCase() === userPaymentAccount.method.toLowerCase())
    || userPaymentAccount.method;
  if (!methods.some((m) => m.toLowerCase() === userPaymentAccount.method.toLowerCase())) {
    throw new Error('Select a valid payment method for this ad');
  }
  userPaymentAccount.method = matchedMethod;

  const amountMmk = Math.round(amountUsdt * priceMmk);
  const refCode = await uniqueP2pSellRefCode();
  const settings = await getCardPricingSettings();
  const feeBreakdown = calculateP2pFeeBreakdown(amountUsdt, settings);
  const roundedUsdt = Math.round(amountUsdt * 100) / 100;

  await P2PAd.reserveVolume(adId, roundedUsdt);

  const order = await P2PSellOrder.create({
    userId,
    sellerId: null,
    adId,
    makerUserId: ad.user_id,
    refCode,
    amountUsdt: roundedUsdt,
    amountMmk,
    priceMmkPerUsdt: priceMmk,
    paymentMethod: matchedMethod,
    userPaymentAccount,
    expiresAt: expiresAtFromNow(),
    metadata: {
      ad_id: adId,
      maker_user_id: ad.user_id,
      buyer_name: makerUser?.name || mapped.name,
      marketplace_type: 'c2c',
      fee_percent_applied: feeBreakdown.fee_percent,
      platform_fee_usdt_preview: feeBreakdown.platform_fee_usdt,
    },
  });

  await lockUsdtForEscrow(userId, roundedUsdt, {
    holdType: 'p2p_sell_order',
    referenceType: 'p2p_sell_orders',
    referenceId: order.id,
    description: `P2P sell order escrow (C2C) — ${refCode}`,
    createdBy: 'user',
    metadata: { ad_id: adId, escrow: true },
  });

  await TransactionLog.create({
    userId,
    type: 'p2p_sell_order',
    direction: 'neutral',
    amountUsd: roundedUsdt,
    amountMmk,
    referenceType: 'p2p_sell_orders',
    referenceId: order.id,
    description: `P2P sell order (C2C) — ${refCode}`,
    createdBy: 'user',
    metadata: { ad_id: adId, maker_user_id: ad.user_id, marketplace_type: 'c2c' },
  });

  const user = await User.findById(userId);
  return {
    order: P2PSellOrder.mapForClient(order, { seller: { name: makerUser?.name }, user }),
    fee: { ...feeBreakdown, mmk_you_receive: amountMmk },
    user: { id: user.id, balance_usdt: user.balance_usdt },
    message: `${formatUsdt(roundedUsdt)} USDT escrowed. Buyer will send ${formatMmk(amountMmk)} MMK to your ${matchedMethod} account.`,
  };
}

async function releaseEscrowedUsdtFromSellOrder(orderId, {
  reviewedBy = 'user',
  finalStatus = 'released',
  adminNote,
} = {}) {
  const order = await P2PSellOrder.findById(orderId);
  if (!order) throw new Error('Order not found');
  if (order.status !== 'pending_merchant_mmk') {
    throw new Error(`Order cannot be released in status: ${order.status}`);
  }
  if (!order.ad_id || !order.maker_user_id) {
    throw new Error('Legacy platform merchant orders are no longer supported');
  }

  const maker = await User.findById(order.maker_user_id);
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

  await consumeEscrowToBuyer({
    fromUserId: order.user_id,
    toUserId: order.maker_user_id,
    grossAmountUsdt: amountUsdt,
    netToBuyerUsdt: buyerReceives,
    platformFeeUsdt: platformFee,
    holdReference: {
      referenceType: 'p2p_sell_orders',
      referenceId: orderId,
      holdType: 'p2p_sell_order',
    },
    description: `P2P sell order escrow released — ${order.ref_code}`,
    buyerDescription: `P2P C2C buy — ${formatUsdt(buyerReceives)} from seller (${order.ref_code})`,
    referenceType: 'p2p_sell_orders',
    referenceId: orderId,
    platformFeeType: PLATFORM_FEE_TYPES.P2P,
    platformMetadata: {
      description: `P2P sell platform fee — ${order.ref_code} (${formatUsdt(platformFee)} @ ${feePercent}%)`,
      p2p_sell_order_id: orderId,
      ad_id: order.ad_id,
      fee_percent: feePercent,
      fee_paid_by: 'user_seller',
    },
    metadata: {
      ad_id: order.ad_id,
      marketplace_type: 'c2c',
      admin_note: adminNote || null,
    },
    createdBy: reviewedBy,
  });

  const updated = await P2PSellOrder.updateStatus(orderId, finalStatus, {
    platformFeeUsdt: platformFee,
    netUsdtToMerchant: buyerReceives,
    feePercentApplied: feePercent,
    adminNote,
  });

  const sellerUser = await User.findById(order.user_id);

  await TransactionLog.create({
    userId: order.user_id,
    type: 'p2p_sell_order_release',
    direction: 'neutral',
    amountUsd: amountUsdt,
    amountMmk: order.amount_mmk,
    referenceType: 'p2p_sell_orders',
    referenceId: orderId,
    description: `Escrow released — ${order.ref_code}: ${formatUsdt(buyerReceives)} to buyer, ${formatUsdt(platformFee)} platform fee`,
    createdBy: reviewedBy,
    metadata: {
      escrowed_usdt: amountUsdt,
      platform_fee_usdt: platformFee,
      net_usdt_to_buyer: buyerReceives,
      fee_percent_applied: feePercent,
      mmk_received_externally: order.amount_mmk,
      ad_id: order.ad_id,
      maker_user_id: order.maker_user_id,
    },
  });

  return {
    order: updated,
    sellerUser,
    maker,
    feeBreakdown,
    platformFee,
    buyerReceives,
    amountUsdt,
  };
}

async function confirmMmkAndReleaseUsdt(orderId, userId) {
  const order = await P2PSellOrder.findById(orderId);
  if (!order) throw new Error('Order not found');
  if (order.user_id !== userId) throw new Error('Access denied');

  const result = await releaseEscrowedUsdtFromSellOrder(orderId, { reviewedBy: 'user' });
  const updated = result.order;

  await notifyAdminP2pSellOrderReleased({
    user: result.sellerUser,
    order: updated,
    seller: result.maker ? { name: result.maker.name } : null,
  });

  return {
    order: P2PSellOrder.mapForClient(updated, { seller: result.maker ? { name: result.maker.name } : null, user: result.sellerUser }),
    fee: { ...result.feeBreakdown, net_usdt_to_buyer: result.buyerReceives },
    message: `MMK receipt confirmed. ${formatUsdt(result.buyerReceives)} USDT released to buyer (${formatUsdt(result.platformFee)} platform fee deducted).`,
  };
}

async function adminReleaseP2pSellOrder(orderId, { adminNote, reviewedBy = 'admin' } = {}) {
  const result = await releaseEscrowedUsdtFromSellOrder(orderId, {
    reviewedBy,
    finalStatus: 'completed_by_admin',
    adminNote,
  });

  return {
    order: P2PSellOrder.mapForClient(result.order, {
      seller: result.maker ? { name: result.maker.name } : null,
      user: result.sellerUser,
    }),
    fee: { ...result.feeBreakdown, net_usdt_to_buyer: result.buyerReceives },
    message: 'USDT Force Released to Buyer',
  };
}

async function cancelP2pSellOrder(orderId, userId) {
  const order = await P2PSellOrder.findById(orderId);
  if (!order) throw new Error('Order not found');
  if (order.user_id !== userId) throw new Error('Access denied');
  if (order.status !== 'pending_merchant_mmk') {
    throw new Error(`Order cannot be cancelled in status: ${order.status}`);
  }

  const amountUsdt = Number(order.amount_usdt);
  await refundEscrowHold({
    userId,
    referenceType: 'p2p_sell_orders',
    referenceId: orderId,
    holdType: 'p2p_sell_order',
    amountUsdt,
    description: `P2P sell order cancelled — ${order.ref_code} escrow refunded`,
    createdBy: 'user',
    metadata: { p2p_sell_order_id: orderId, escrow_refund: true },
  });

  const user = await User.findById(userId);

  const updated = await P2PSellOrder.updateStatus(orderId, 'cancelled');

  if (order.ad_id) {
    await P2PAd.restoreVolume(order.ad_id, amountUsdt);
  }

  await TransactionLog.create({
    userId,
    type: 'p2p_sell_order_cancelled',
    direction: 'credit',
    amountUsd: amountUsdt,
    referenceType: 'p2p_sell_orders',
    referenceId: orderId,
    description: `P2P sell order cancelled — ${order.ref_code}, USDT escrow refunded`,
    createdBy: 'user',
  });

  return {
    order: P2PSellOrder.mapForClient(updated, { user }),
    user: { id: user.id, balance_usdt: user.balance_usdt },
    message: 'Order cancelled and USDT escrow refunded to your wallet',
  };
}

async function rejectP2pSellOrder(orderId, { adminNote, rejectionReason, reviewedBy = 'admin', finalStatus = 'rejected' } = {}) {
  const order = await P2PSellOrder.findById(orderId);
  if (!order) throw new Error('Order not found');
  if (order.status !== 'pending_merchant_mmk') {
    throw new Error(`Order cannot be rejected in status: ${order.status}`);
  }

  const amountUsdt = Number(order.amount_usdt);
  await refundEscrowHold({
    userId: order.user_id,
    referenceType: 'p2p_sell_orders',
    referenceId: orderId,
    holdType: 'p2p_sell_order',
    amountUsdt,
    description: `P2P sell order rejected — ${order.ref_code} escrow refunded`,
    createdBy: reviewedBy,
    metadata: { p2p_sell_order_id: orderId, escrow_refund: true, admin_rejection: true },
  });

  const user = await User.findById(order.user_id);

  const updated = await P2PSellOrder.updateStatus(orderId, finalStatus, {
    adminNote: adminNote || rejectionReason,
  });

  if (order.ad_id) {
    await P2PAd.restoreVolume(order.ad_id, amountUsdt);
  }

  await TransactionLog.create({
    userId: order.user_id,
    type: 'p2p_sell_order_rejected',
    direction: 'credit',
    amountUsd: amountUsdt,
    referenceType: 'p2p_sell_orders',
    referenceId: orderId,
    description: `P2P sell order rejected — ${order.ref_code}: ${rejectionReason || adminNote || 'No reason'}`,
    createdBy: reviewedBy,
  });

  return {
    order: P2PSellOrder.mapForClient(updated, { user }),
    user: { id: user.id, balance_usdt: user.balance_usdt },
    message: finalStatus === 'cancelled_by_admin'
      ? 'Dispute Rejected - Escrow Refunded to Seller'
      : 'P2P sell order rejected and USDT escrow refunded',
  };
}

async function adminRefundP2pSellOrder(orderId, { adminNote, reviewedBy = 'admin' } = {}) {
  return rejectP2pSellOrder(orderId, {
    adminNote,
    rejectionReason: adminNote,
    reviewedBy,
    finalStatus: 'cancelled_by_admin',
  });
}

async function listP2pSellOrdersForAdmin({ status } = {}) {
  const rows = await P2PSellOrder.listByStatus(status || 'pending_merchant_mmk');
  const settings = await getCardPricingSettings();
  const enriched = await Promise.all(rows.map(async (row) => {
    const maker = row.maker_user_id ? await User.findById(row.maker_user_id) : null;
    const user = await User.findById(row.user_id);
    const mapped = P2PSellOrder.mapForClient(row, {
      seller: maker ? { name: maker.name } : null,
      user,
    });
    const feePercent = mapped.fee_percent_applied ?? mapped.metadata?.fee_percent_applied ?? settings.p2p_seller_fee_percent;
    const fee = calculateP2pFeeBreakdown(row.amount_usdt, { ...settings, p2p_seller_fee_percent: feePercent });
    return {
      ...mapped,
      fee: {
        ...fee,
        net_usdt_to_buyer: Math.round((row.amount_usdt - fee.platform_fee_usdt) * 100) / 100,
      },
    };
  }));
  return enriched;
}

async function listP2pSellOrdersForUser(userId) {
  const rows = await P2PSellOrder.findByUserId(userId);
  const settings = await getCardPricingSettings();
  const enriched = await Promise.all(rows.map(async (row) => {
    const maker = row.maker_user_id ? await User.findById(row.maker_user_id) : null;
    const mapped = P2PSellOrder.mapForClient(row, {
      seller: maker ? { name: maker.name } : null,
    });
    const fee = calculateP2pFeeBreakdown(row.amount_usdt, settings);
    return {
      ...mapped,
      fee: {
        ...fee,
        net_usdt_to_buyer: Math.round((row.amount_usdt - fee.platform_fee_usdt) * 100) / 100,
        mmk_you_receive: row.amount_mmk,
      },
    };
  }));
  return enriched;
}

module.exports = {
  createP2pSellOrder,
  confirmMmkAndReleaseUsdt,
  adminReleaseP2pSellOrder,
  cancelP2pSellOrder,
  rejectP2pSellOrder,
  adminRefundP2pSellOrder,
  listP2pSellOrdersForAdmin,
  listP2pSellOrdersForUser,
};
