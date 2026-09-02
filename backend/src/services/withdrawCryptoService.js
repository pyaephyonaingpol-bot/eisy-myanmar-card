/**
 * Automated TRC20 USDT withdrawal with fixed fee + master-wallet send.
 * Manual energy mode — no Feee.io / external energy rental APIs.
 *
 * POST /api/withdraw body: { customerAddress, withdrawAmount }
 * Fee: fixed 2.0 USDT (Net Payout = withdrawAmount - 2.0)
 *
 * SECURITY: After unauthorized-withdrawal incident, on-chain broadcast requires
 * WITHDRAWALS_PAUSED=false AND AUTO_ONCHAIN_WITHDRAWALS=true. Otherwise the
 * debit is recorded and the request stays pending for admin review.
 */
const UsdtWithdrawal = require('../models/UsdtWithdrawal');
const {
  debitUsdt,
  creditUsdt,
  formatUsdt,
} = require('./walletService');
const { creditPlatformUsdtRevenue, PLATFORM_FEE_TYPES } = require('./platformRevenueService');
const tronMasterWalletService = require('./tronMasterWalletService');
const { getDb } = require('../db');
const {
  assertWithdrawalsNotPaused,
  isAutoOnchainWithdrawalEnabled,
  assertMasterWalletTransfersAllowed,
} = require('./securityFlags');

const FIXED_WITHDRAW_FEE_USDT = Number(process.env.WITHDRAW_FIXED_FEE_USDT || 2);

function roundUsdt(value) {
  return Math.round(Number(value) * 1e6) / 1e6;
}

function getFixedWithdrawFeeUsdt() {
  const fee = Number(FIXED_WITHDRAW_FEE_USDT);
  return Number.isFinite(fee) && fee >= 0 ? fee : 2;
}

function generateRefCode(prefix = 'WD') {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${num}`;
}

async function uniqueWithdrawRefCode() {
  const db = getDb();
  let refCode;
  let attempts = 0;
  do {
    refCode = generateRefCode('WD');
    const existing = await db.get(
      'SELECT id FROM usdt_withdrawal_requests WHERE ref_code = ?',
      refCode
    );
    if (!existing) break;
    attempts += 1;
  } while (attempts < 10);
  return refCode;
}

/**
 * Validate + compute fixed-fee payout.
 * @returns {{ withdrawAmount: number, feeUsdt: number, netPayout: number, customerAddress: string }}
 */
function calculateFixedFeeWithdraw({ customerAddress, withdrawAmount }) {
  const address = String(customerAddress || '').trim();
  if (!address) {
    const err = new Error('customerAddress is required');
    err.code = 'WITHDRAW_ADDRESS_REQUIRED';
    throw err;
  }
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
    const err = new Error('customerAddress must be a valid TRC20 (TRON) address');
    err.code = 'WITHDRAW_ADDRESS_INVALID';
    throw err;
  }
  if (!tronMasterWalletService.isLikelyTronAddress(address)) {
    const err = new Error('customerAddress failed TRON Base58Check validation');
    err.code = 'WITHDRAW_ADDRESS_INVALID';
    throw err;
  }

  const amount = Number(withdrawAmount);
  if (!Number.isFinite(amount)) {
    const err = new Error('withdrawAmount must be a number');
    err.code = 'WITHDRAW_AMOUNT_INVALID';
    throw err;
  }

  const feeUsdt = getFixedWithdrawFeeUsdt();
  if (!(amount > feeUsdt)) {
    const err = new Error(
      `withdrawAmount must be strictly greater than the ${feeUsdt.toFixed(1)} USDT fee`
    );
    err.code = 'WITHDRAW_AMOUNT_TOO_LOW';
    throw err;
  }

  const netPayout = roundUsdt(amount - feeUsdt);
  if (!(netPayout > 0)) {
    const err = new Error('Net payout must be positive after fee');
    err.code = 'WITHDRAW_NET_INVALID';
    throw err;
  }

  return {
    customerAddress: address,
    withdrawAmount: roundUsdt(amount),
    feeUsdt: roundUsdt(feeUsdt),
    netPayout,
  };
}

/**
 * Debit user wallet and optionally send net USDT on-chain from the master wallet.
 */
async function executeFixedFeeTrc20Withdraw(userId, { customerAddress, withdrawAmount }) {
  assertWithdrawalsNotPaused();

  if (!userId) {
    const err = new Error('Authenticated user is required');
    err.code = 'WITHDRAW_USER_REQUIRED';
    throw err;
  }

  const calc = calculateFixedFeeWithdraw({ customerAddress, withdrawAmount });
  const refCode = await uniqueWithdrawRefCode();

  const withdrawal = await UsdtWithdrawal.create({
    userId,
    refCode,
    payoutMethod: 'crypto',
    network: 'TRC20',
    walletAddress: calc.customerAddress,
    amountUsdt: calc.withdrawAmount,
    feeUsdt: calc.feeUsdt,
    netUsdt: calc.netPayout,
    feeType: 'fixed',
  });

  try {
    await debitUsdt(userId, calc.withdrawAmount, {
      description: `USDT withdrawal ${refCode} — ${formatUsdt(calc.netPayout)} net to TRC20 (fee ${formatUsdt(calc.feeUsdt)})`,
      referenceType: 'usdt_withdrawal',
      referenceId: withdrawal.id,
      createdBy: 'user',
      metadata: {
        purpose: 'usdt_withdrawal',
        payout_method: 'crypto',
        ref_code: refCode,
        network: 'TRC20',
        wallet_address: calc.customerAddress,
        fee_usdt: calc.feeUsdt,
        net_usdt: calc.netPayout,
        withdraw_channel: 'api_withdraw',
      },
    });
  } catch (err) {
    await UsdtWithdrawal.updateStatus(withdrawal.id, {
      status: 'cancelled',
      adminNote: `Debit failed: ${err.message}`,
    }).catch(() => {});
    throw err;
  }

  if (calc.feeUsdt > 0) {
    try {
      await creditPlatformUsdtRevenue(calc.feeUsdt, {
        feeType: PLATFORM_FEE_TYPES.WITHDRAWAL,
        description: `USDT withdrawal fee — ${refCode} (TRC20, ${formatUsdt(calc.feeUsdt)})`,
        referenceType: 'usdt_withdrawal_requests',
        referenceId: withdrawal.id,
        relatedUserId: userId,
        metadata: {
          network: 'TRC20',
          fee_rule: 'fixed_2_usdt',
          withdraw_channel: 'api_withdraw',
        },
      });
    } catch (feeErr) {
      console.warn('[withdraw] platform fee credit failed:', feeErr.message);
    }
  }

  if (!isAutoOnchainWithdrawalEnabled()) {
    const pending = await UsdtWithdrawal.updateStatus(withdrawal.id, {
      status: 'pending',
      adminNote: 'Queued for admin review — auto on-chain withdraw disabled (security incident lock)',
    });
    return {
      success: true,
      queued: true,
      message: `Withdrawal ${refCode} queued for admin review. ${formatUsdt(calc.netPayout)} USDT will be sent after approval.`,
      txId: null,
      tx_hash: null,
      customerAddress: calc.customerAddress,
      withdrawAmount: calc.withdrawAmount,
      feeUsdt: calc.feeUsdt,
      fee_collected: calc.feeUsdt,
      netPayout: calc.netPayout,
      net_payout: calc.netPayout,
      network: 'TRC20',
      token: 'USDT',
      fromAddress: null,
      withdrawal: {
        id: pending.id,
        ref_code: pending.ref_code,
        status: pending.status,
        tx_hash: pending.tx_hash || null,
      },
    };
  }

  assertMasterWalletTransfersAllowed('api /withdraw');

  await UsdtWithdrawal.updateStatus(withdrawal.id, {
    status: 'processing',
    adminNote: 'Automated TRC20 withdraw — master wallet transfer (manual energy)',
  });

  let transfer;
  try {
    transfer = await tronMasterWalletService.transferUsdtTrc20({
      toAddress: calc.customerAddress,
      amountUsdt: calc.netPayout,
    });
  } catch (err) {
    await UsdtWithdrawal.updateStatus(withdrawal.id, {
      status: 'rejected',
      adminNote: `On-chain transfer failed: ${err.message}`,
    }).catch(() => {});

    await creditUsdt(userId, calc.withdrawAmount, {
      purpose: 'usdt_withdrawal_refund',
      description: `USDT withdrawal ${refCode} failed — ${formatUsdt(calc.withdrawAmount)} refunded`,
      referenceType: 'usdt_withdrawal',
      referenceId: withdrawal.id,
      createdBy: 'system',
      metadata: {
        purpose: 'usdt_withdrawal_refund',
        reason: err.message,
      },
    }).catch((refundErr) => {
      console.error('[withdraw] refund after transfer failure:', refundErr.message);
    });

    const wrapped = new Error(err.message || 'USDT transfer failed');
    wrapped.code = err.code || 'TRANSFER_FAILED';
    wrapped.cause = err;
    wrapped.withdrawal = await UsdtWithdrawal.findById(withdrawal.id);
    throw wrapped;
  }

  const completed = await UsdtWithdrawal.updateStatus(withdrawal.id, {
    status: 'completed',
    txHash: transfer.txId,
    adminNote: `On-chain TRC20 transfer from master wallet (${transfer.fromAddress})`,
  });

  return {
    success: true,
    queued: false,
    message: 'Withdrawal completed',
    txId: transfer.txId,
    tx_hash: transfer.txId,
    customerAddress: calc.customerAddress,
    withdrawAmount: calc.withdrawAmount,
    feeUsdt: calc.feeUsdt,
    fee_collected: calc.feeUsdt,
    netPayout: calc.netPayout,
    net_payout: calc.netPayout,
    network: 'TRC20',
    token: 'USDT',
    fromAddress: transfer.fromAddress,
    withdrawal: {
      id: completed.id,
      ref_code: completed.ref_code,
      status: completed.status,
      tx_hash: completed.tx_hash,
    },
  };
}

module.exports = {
  FIXED_WITHDRAW_FEE_USDT,
  getFixedWithdrawFeeUsdt,
  calculateFixedFeeWithdraw,
  executeFixedFeeTrc20Withdraw,
};
