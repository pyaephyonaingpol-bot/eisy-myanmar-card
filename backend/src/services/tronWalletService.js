/**
 * Per-user TRON (TRC-20) wallet management for eisymyanmar.com.
 *
 * Cohesive façade over:
 *   - HD deposit address generation (tronHdWalletService / tronDepositAddressService)
 *   - Deposit detection + internal ledger credit (tronOrderService poller)
 *   - Withdrawals from the platform master wallet (withdrawCryptoService)
 *
 * Private keys for HD deposits are never persisted — only addresses + indexes.
 */
const User = require('../models/User');
const { UserUsdtWalletAddress } = require('../models/UserUsdtWalletAddress');
const {
  isHdEnabled,
  getPublicDepositAddressForUser,
} = require('./tronHdWalletService');
const {
  ensureUserTronDepositAddress,
  resolveUserTrc20DepositAddress,
} = require('./tronDepositAddressService');
const {
  createTronOrder,
  findTronOrderByOrderId,
  verifyPendingTronOrders,
  runTronOrderPollSafely,
  getGatewayDepositAddress,
} = require('./tronOrderService');
const {
  executeFixedFeeTrc20Withdraw,
  calculateFixedFeeWithdraw,
  getFixedWithdrawFeeUsdt,
} = require('./withdrawCryptoService');
const { getUsdtBalances } = require('./usdtLedgerService');
const { walletPayload, formatUsdt } = require('./walletService');

/**
 * Generate (or return existing) unique TRC-20 deposit address for a user.
 * Safe to call on registration and on every deposit flow.
 */
async function generateUserDepositAddress(userId) {
  if (!userId) {
    const err = new Error('userId is required');
    err.code = 'TRON_WALLET_USER_REQUIRED';
    throw err;
  }

  const assigned = await ensureUserTronDepositAddress(userId, { syncSupabase: true });
  if (assigned?.address) {
    return {
      user_id: Number(userId),
      network: 'TRC20',
      token: 'USDT',
      address: assigned.address,
      derivation_index: assigned.index,
      derivation_path: assigned.path,
      source: 'hd',
      created: Boolean(assigned.created),
    };
  }

  // HD disabled / unavailable — fall back to shared gateway (legacy).
  const resolved = await resolveUserTrc20DepositAddress(userId, getGatewayDepositAddress);
  return {
    user_id: Number(userId),
    network: 'TRC20',
    token: 'USDT',
    address: resolved.address,
    derivation_index: resolved.index,
    derivation_path: resolved.path,
    source: resolved.source,
    created: false,
  };
}

/**
 * Fire-and-forget provision after signup — never blocks registration.
 */
function provisionDepositAddressInBackground(userId) {
  if (!userId) return;
  setImmediate(() => {
    generateUserDepositAddress(userId).catch((err) => {
      console.warn('[tron/wallet] background address provision failed:', err.message);
    });
  });
}

/**
 * Snapshot: deposit address + internal USDT balances.
 */
async function getTronWalletSummary(userId) {
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  let deposit;
  try {
    deposit = await generateUserDepositAddress(userId);
  } catch (err) {
    deposit = {
      address: null,
      source: 'unavailable',
      error: err.message,
      code: err.code,
    };
  }

  const balances = await getUsdtBalances(userId).catch(() => null);
  const available = Number(
    balances?.available_usdt ?? user.balance_usdt ?? 0
  );
  const locked = Number(
    balances?.locked_usdt ?? user.balance_usdt_locked ?? 0
  );
  const total = Number(
    balances?.total_usdt ?? (available + locked)
  );

  const custodial = await UserUsdtWalletAddress.findCustodial(userId, 'TRC20').catch(() => null);

  return {
    user_id: Number(userId),
    network: 'TRC20',
    token: 'USDT',
    deposit_address: deposit.address || custodial?.address || null,
    deposit_address_source: deposit.source || null,
    derivation_index: deposit.derivation_index
      ?? (custodial?.derivation_index != null ? Number(custodial.derivation_index) : null),
    derivation_path: deposit.derivation_path || custodial?.derivation_path || null,
    hd_enabled: isHdEnabled(),
    balance: {
      available_usdt: available,
      locked_usdt: locked,
      total_usdt: total,
    },
    wallet: walletPayload(user),
    withdraw_fee_usdt: getFixedWithdrawFeeUsdt(),
  };
}

/**
 * Create a deposit intent: user sends USDT to their unique address;
 * the worker credits the internal balance when the transfer is detected.
 */
async function createDepositIntent(userId, { amount_usdt, amount } = {}) {
  // Ensures address exists + is written on the order before the user pays.
  await generateUserDepositAddress(userId);
  return createTronOrder(userId, { amount_usdt, amount });
}

async function getDepositIntent(orderId, userId = null) {
  const order = await findTronOrderByOrderId(orderId);
  if (!order) return null;
  if (userId != null && order.user_id != null && Number(order.user_id) !== Number(userId)) {
    const err = new Error('Order not found');
    err.code = 'TRON_ORDER_NOT_FOUND';
    throw err;
  }
  return order;
}

/**
 * Scan unique deposit addresses for pending orders and credit internal wallets.
 * Used by the background poller and by POST /api/tron/wallet/sync-deposits.
 */
async function creditDetectedDeposits() {
  return runTronOrderPollSafely();
}

/**
 * Force a full verify pass (same matcher as the worker).
 */
async function detectAndCreditDeposits() {
  return verifyPendingTronOrders();
}

/**
 * Withdraw USDT from the user's internal balance; payout is sent from the
 * platform master wallet to the user's external TRC-20 address.
 *
 * @param {number} userId
 * @param {{ toAddress: string, amountUsdt: number }} opts
 */
async function withdrawFromMasterWallet(userId, { toAddress, amountUsdt, customerAddress, withdrawAmount } = {}) {
  const dest = String(toAddress || customerAddress || '').trim();
  const amount = amountUsdt != null ? amountUsdt : withdrawAmount;

  // Validate fee math before debiting.
  calculateFixedFeeWithdraw({ customerAddress: dest, withdrawAmount: amount });

  const result = await executeFixedFeeTrc20Withdraw(userId, {
    customerAddress: dest,
    withdrawAmount: amount,
  });

  const user = await User.findById(userId);
  return {
    ...result,
    message: result.message || `Sent ${formatUsdt(result.netPayout)} USDT from master wallet`,
    wallet: user ? walletPayload(user) : undefined,
    fee: {
      type: 'fixed',
      amount_usdt: getFixedWithdrawFeeUsdt(),
    },
  };
}

module.exports = {
  generateUserDepositAddress,
  provisionDepositAddressInBackground,
  getTronWalletSummary,
  createDepositIntent,
  getDepositIntent,
  creditDetectedDeposits,
  detectAndCreditDeposits,
  withdrawFromMasterWallet,
  getPublicDepositAddressForUser,
  isHdEnabled,
};
