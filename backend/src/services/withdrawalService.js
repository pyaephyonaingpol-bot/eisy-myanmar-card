const { getDb } = require('../db');
const UsdtWithdrawal = require('../models/UsdtWithdrawal');
const { debitUsdt, formatUsdt } = require('./walletService');
const { getWithdrawalFeeSettings, calculateWithdrawalBreakdown } = require('./settingsService');
const { creditPlatformUsdtRevenue, PLATFORM_FEE_TYPES } = require('./platformRevenueService');

function generateRefCode() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `WD-${num}`;
}

async function uniqueWithdrawalRefCode() {
  const db = getDb();
  let refCode;
  let attempts = 0;
  do {
    refCode = generateRefCode();
    const existing = await db.get(
      'SELECT id FROM usdt_withdrawal_requests WHERE ref_code = ?',
      refCode
    );
    if (!existing) break;
    attempts++;
  } while (attempts < 10);
  return refCode;
}

function normalizeNetwork(network) {
  const n = String(network || '').trim().toUpperCase();
  if (n === 'TRC20' || n === 'TRON') return 'TRC20';
  if (n === 'BEP20' || n === 'BSC') return 'BEP20';
  return null;
}

function validateWalletAddress(network, address) {
  const addr = String(address || '').trim();
  if (!addr) throw new Error('Enter your external USDT wallet address');

  if (network === 'TRC20') {
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) {
      throw new Error('Invalid TRC20 address — must start with T and be 34 characters');
    }
    return addr;
  }

  if (network === 'BEP20') {
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      throw new Error('Invalid BEP20 address — must be a 42-character hex address starting with 0x');
    }
    return addr;
  }

  throw new Error('Select TRC20 or BEP20 network');
}

async function createUsdtWithdrawalRequest(userId, { network, wallet_address, amount_usdt }) {
  const normalizedNetwork = normalizeNetwork(network);
  if (!normalizedNetwork) {
    throw new Error('Select withdrawal network: TRC20 or BEP20');
  }

  const walletAddress = validateWalletAddress(normalizedNetwork, wallet_address);
  const requestedAmount = parseFloat(amount_usdt);
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    throw new Error('Enter a valid USDT withdrawal amount');
  }

  const settings = await getWithdrawalFeeSettings();
  const breakdown = calculateWithdrawalBreakdown(requestedAmount, normalizedNetwork, settings);

  if (requestedAmount < settings.minimum_usdt_withdrawal) {
    throw new Error(
      `Minimum withdrawal is ${formatUsdt(settings.minimum_usdt_withdrawal)}`
    );
  }

  if (breakdown.net_usdt <= 0) {
    throw new Error(
      `Amount too small — after ${formatUsdt(breakdown.fee_usdt)} network fee, nothing would be sent. Increase the amount.`
    );
  }

  const refCode = await uniqueWithdrawalRefCode();

  const withdrawal = await UsdtWithdrawal.create({
    userId,
    refCode,
    network: normalizedNetwork,
    walletAddress,
    amountUsdt: breakdown.amount_usdt,
    feeUsdt: breakdown.fee_usdt,
    netUsdt: breakdown.net_usdt,
    feeType: breakdown.fee_type,
  });

  await debitUsdt(userId, breakdown.amount_usdt, {
    description: `USDT withdrawal ${refCode} — ${formatUsdt(breakdown.net_usdt)} net to ${normalizedNetwork} (fee ${formatUsdt(breakdown.fee_usdt)})`,
    referenceType: 'usdt_withdrawal',
    referenceId: withdrawal.id,
    createdBy: 'user',
    metadata: {
      purpose: 'usdt_withdrawal',
      ref_code: refCode,
      network: normalizedNetwork,
      wallet_address: walletAddress,
      fee_usdt: breakdown.fee_usdt,
      net_usdt: breakdown.net_usdt,
    },
  });

  if (breakdown.fee_usdt > 0) {
    await creditPlatformUsdtRevenue(breakdown.fee_usdt, {
      feeType: PLATFORM_FEE_TYPES.WITHDRAWAL,
      description: `USDT withdrawal fee — ${refCode} (${normalizedNetwork}, ${formatUsdt(breakdown.fee_usdt)})`,
      referenceType: 'usdt_withdrawal_requests',
      referenceId: withdrawal.id,
      relatedUserId: userId,
      metadata: {
        network: normalizedNetwork,
        ref_code: refCode,
        fee_type: breakdown.fee_type,
        requested_amount: breakdown.amount_usdt,
      },
    });
  }

  return {
    withdrawal,
    breakdown,
    message: `Withdrawal ${refCode} submitted. ${formatUsdt(breakdown.net_usdt)} will be sent to your ${normalizedNetwork} address after processing.`,
  };
}

module.exports = {
  createUsdtWithdrawalRequest,
  normalizeNetwork,
  validateWalletAddress,
};
