const { getDb } = require('../db');
const UsdtWithdrawal = require('../models/UsdtWithdrawal');
const MmkWithdrawal = require('../models/MmkWithdrawal');
const {
  debitUsdt,
  creditUsdt,
  debitMmk,
  creditMmk,
  formatUsdt,
  formatMmk,
} = require('./walletService');
const {
  getWithdrawalFeeSettings,
  calculateWithdrawalBreakdown,
  calculateMmkWithdrawalBreakdown,
  getSetting,
  setSetting,
} = require('./settingsService');
const { creditPlatformUsdtRevenue, PLATFORM_FEE_TYPES } = require('./platformRevenueService');
const { transferUsdtTrc20, isLikelyTronAddress } = require('./tronMasterWalletService');
const { getFixedWithdrawFeeUsdt } = require('./withdrawCryptoService');
// NOWPayments payout helpers are retained for legacy IPN / admin tools only —
// user-facing crypto withdrawals use master-wallet TronWeb (manual energy).

function generateRefCode(prefix = 'WD') {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${num}`;
}

async function uniqueRefCode(table, prefix) {
  const db = getDb();
  let refCode;
  let attempts = 0;
  do {
    refCode = generateRefCode(prefix);
    const existing = await db.get(`SELECT id FROM ${table} WHERE ref_code = ?`, refCode);
    if (!existing) break;
    attempts++;
  } while (attempts < 10);
  return refCode;
}

function normalizeNetwork(network) {
  const n = String(network || '').trim().toUpperCase();
  if (n === 'TRC20' || n === 'TRON') return 'TRC20';
  if (n === 'BEP20' || n === 'BSC') return 'BEP20';
  if (n === 'BANK') return 'BANK';
  return null;
}

function normalizePayoutMethod(method) {
  const m = String(method || 'crypto').trim().toLowerCase();
  if (m === 'crypto' || m === 'wallet' || m === 'onchain' || m === 'nowpayments' || m === 'np') {
    return 'crypto';
  }
  if (m === 'bank' || m === 'mmk_bank' || m === 'fiat') return 'bank';
  return null;
}

function validateWalletAddress(network, address) {
  const addr = String(address || '').trim();
  if (!addr) throw new Error('Enter your external USDT wallet address');

  if (network === 'TRC20') {
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) {
      throw new Error('Invalid TRC20 address — must start with T and be 34 characters');
    }
    if (!isLikelyTronAddress(addr)) {
      throw new Error('Invalid TRC20 address — checksum failed');
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

function validateBankDetails({ bank_name, account_name, account_number }) {
  const bankName = String(bank_name || '').trim();
  const accountName = String(account_name || '').trim();
  const accountNumber = String(account_number || '').trim().replace(/\s+/g, '');

  if (!bankName || bankName.length < 2) {
    throw new Error('Enter your bank name (e.g. KBZ, AYA, CB)');
  }
  if (!accountName || accountName.length < 2) {
    throw new Error('Enter the bank account holder name');
  }
  if (!accountNumber || accountNumber.length < 5) {
    throw new Error('Enter a valid bank account number');
  }

  return { bankName, accountName, accountNumber };
}

async function reversePlatformUsdtFee(feeUsdt, { description, referenceType, referenceId } = {}) {
  const amount = Math.round((parseFloat(feeUsdt) || 0) * 100) / 100;
  if (amount <= 0) return null;

  const raw = await getSetting('platform_usdt_revenue_balance');
  const current = Math.round((parseFloat(raw) || 0) * 100) / 100;
  const next = Math.max(0, Math.round((current - amount) * 100) / 100);
  await setSetting('platform_usdt_revenue_balance', next);

  return {
    reversed: amount,
    balance_before: current,
    balance_after: next,
    description: description || `Reversed withdrawal fee ${formatUsdt(amount)}`,
    referenceType,
    referenceId,
  };
}

async function createUsdtWithdrawalRequest(userId, body = {}) {
  const payoutMethod = normalizePayoutMethod(body.payout_method || (body.network === 'BANK' ? 'bank' : 'crypto'));
  if (!payoutMethod) {
    throw new Error('Select withdrawal method: crypto wallet or bank account');
  }

  if (payoutMethod === 'bank') {
    return createUsdtBankWithdrawalRequest(userId, body);
  }
  return createUsdtCryptoWithdrawalRequest(userId, body);
}

async function createUsdtCryptoWithdrawalRequest(userId, { network, wallet_address, amount_usdt }) {
  const normalizedNetwork = normalizeNetwork(network);
  if (!normalizedNetwork || normalizedNetwork === 'BANK') {
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
    throw new Error(`Minimum withdrawal is ${formatUsdt(settings.minimum_usdt_withdrawal)}`);
  }

  if (normalizedNetwork === 'TRC20') {
    const fixedFee = getFixedWithdrawFeeUsdt();
    if (!(requestedAmount > fixedFee)) {
      const err = new Error(
        `withdrawAmount must be strictly greater than the ${fixedFee.toFixed(1)} USDT fee`
      );
      err.code = 'WITHDRAW_AMOUNT_TOO_LOW';
      throw err;
    }
  }

  if (breakdown.net_usdt <= 0) {
    throw new Error(
      `Amount too small — after ${formatUsdt(breakdown.fee_usdt)} network fee, nothing would be sent. Increase the amount.`
    );
  }

  const refCode = await uniqueRefCode('usdt_withdrawal_requests', 'WD');
  const feeTypeForDb = ['percent', 'fixed'].includes(String(breakdown.fee_type))
    ? breakdown.fee_type
    : (String(breakdown.fee_type || '').includes('percent') ? 'percent' : 'fixed');

  const withdrawal = await UsdtWithdrawal.create({
    userId,
    refCode,
    payoutMethod: 'crypto',
    network: normalizedNetwork,
    walletAddress,
    amountUsdt: breakdown.amount_usdt,
    feeUsdt: breakdown.fee_usdt,
    netUsdt: breakdown.net_usdt,
    feeType: feeTypeForDb,
  });

  try {
    await debitUsdt(userId, breakdown.amount_usdt, {
      description: `USDT withdrawal ${refCode} — ${formatUsdt(breakdown.net_usdt)} net to ${normalizedNetwork} (fee ${formatUsdt(breakdown.fee_usdt)})`,
      referenceType: 'usdt_withdrawal',
      referenceId: withdrawal.id,
      createdBy: 'user',
      metadata: {
        purpose: 'usdt_withdrawal',
        payout_method: 'crypto',
        payout_provider: normalizedNetwork === 'TRC20' ? 'tron_master_wallet' : 'manual',
        ref_code: refCode,
        network: normalizedNetwork,
        wallet_address: walletAddress,
        fee_usdt: breakdown.fee_usdt,
        net_usdt: breakdown.net_usdt,
      },
    });
  } catch (err) {
    await UsdtWithdrawal.updateStatus(withdrawal.id, {
      status: 'cancelled',
      adminNote: `Debit failed: ${err.message}`,
    }).catch(() => {});
    throw err;
  }

  if (breakdown.fee_usdt > 0) {
    try {
      await creditPlatformUsdtRevenue(breakdown.fee_usdt, {
        feeType: PLATFORM_FEE_TYPES.WITHDRAWAL,
        description: `USDT withdrawal fee — ${refCode} (${normalizedNetwork}, ${formatUsdt(breakdown.fee_usdt)})`,
        referenceType: 'usdt_withdrawal_requests',
        referenceId: withdrawal.id,
        relatedUserId: userId,
        metadata: {
          network: normalizedNetwork,
          payout_method: 'crypto',
          ref_code: refCode,
          fee_type: breakdown.fee_type,
          requested_amount: breakdown.amount_usdt,
        },
      });
    } catch (feeErr) {
      console.warn('[withdrawal] platform withdrawal fee credit failed:', feeErr.message);
    }
  }

  // TRC20: send immediately from master wallet (manual energy — no rental APIs).
  if (normalizedNetwork === 'TRC20') {
    await UsdtWithdrawal.updateStatus(withdrawal.id, {
      status: 'processing',
      adminNote: 'Automated TRC20 withdraw — master wallet transfer (manual energy)',
    });

    let transfer;
    try {
      transfer = await transferUsdtTrc20({
        toAddress: walletAddress,
        amountUsdt: breakdown.net_usdt,
      });
    } catch (err) {
      await UsdtWithdrawal.updateStatus(withdrawal.id, {
        status: 'rejected',
        adminNote: `On-chain transfer failed: ${err.message}`,
      }).catch(() => {});

      await creditUsdt(userId, breakdown.amount_usdt, {
        purpose: 'usdt_withdrawal_refund',
        description: `USDT withdrawal ${refCode} failed — ${formatUsdt(breakdown.amount_usdt)} refunded`,
        referenceType: 'usdt_withdrawal',
        referenceId: withdrawal.id,
        createdBy: 'system',
        metadata: {
          purpose: 'usdt_withdrawal_refund',
          reason: err.message,
        },
      }).catch((refundErr) => {
        console.error('[withdrawal] refund after transfer failure:', refundErr.message);
      });

      const wrapped = new Error(err.message || 'USDT transfer failed');
      wrapped.code = err.code || 'TRANSFER_FAILED';
      wrapped.status = 502;
      wrapped.cause = err;
      wrapped.withdrawal = await UsdtWithdrawal.findById(withdrawal.id);
      wrapped.breakdown = breakdown;
      throw wrapped;
    }

    const completed = await UsdtWithdrawal.updateStatus(withdrawal.id, {
      status: 'completed',
      txHash: transfer.txId,
      adminNote: `On-chain TRC20 transfer from master wallet (${transfer.fromAddress})`,
    });

    return {
      withdrawal: completed,
      breakdown,
      payout: {
        provider: 'tron_master_wallet',
        payout_id: transfer.txId,
        status: 'completed',
        currency: 'usdttrc20',
        tx_hash: transfer.txId,
        message: `Sent ${formatUsdt(breakdown.net_usdt)} via master wallet`,
      },
      message: `Withdrawal ${refCode} completed. ${formatUsdt(breakdown.net_usdt)} USDT sent to your TRC20 address.`,
    };
  }

  // BEP20 (and other non-TRC20 crypto): queue for manual/admin processing.
  const refreshed = await UsdtWithdrawal.findById(withdrawal.id);
  return {
    withdrawal: refreshed,
    breakdown,
    payout: null,
    message: `Withdrawal ${refCode} submitted. ${formatUsdt(breakdown.net_usdt)} will be sent to your ${normalizedNetwork} address after processing.`,
  };
}

function payoutCurrencySupported(network) {
  const n = String(network || '').toUpperCase();
  return n === 'TRC20' || n === 'BEP20';
}

async function createUsdtBankWithdrawalRequest(userId, body = {}) {
  const bank = validateBankDetails(body);
  const requestedAmount = parseFloat(body.amount_usdt);
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    throw new Error('Enter a valid USDT withdrawal amount');
  }

  const settings = await getWithdrawalFeeSettings();
  const breakdown = calculateWithdrawalBreakdown(requestedAmount, 'BANK', settings);

  if (requestedAmount < settings.minimum_usdt_withdrawal) {
    throw new Error(`Minimum withdrawal is ${formatUsdt(settings.minimum_usdt_withdrawal)}`);
  }
  if (breakdown.net_usdt <= 0 || !breakdown.amount_mmk || breakdown.amount_mmk <= 0) {
    throw new Error('Amount too small after fee — increase the USDT amount');
  }

  const refCode = await uniqueRefCode('usdt_withdrawal_requests', 'WB');
  const feeTypeForDb = ['percent', 'fixed'].includes(String(breakdown.fee_type))
    ? breakdown.fee_type
    : (String(breakdown.fee_type || '').includes('percent') ? 'percent' : 'fixed');

  const withdrawal = await UsdtWithdrawal.create({
    userId,
    refCode,
    payoutMethod: 'bank',
    network: null,
    walletAddress: null,
    amountUsdt: breakdown.amount_usdt,
    feeUsdt: breakdown.fee_usdt,
    netUsdt: breakdown.net_usdt,
    feeType: feeTypeForDb,
    exchangeRate: breakdown.exchange_rate,
    amountMmk: breakdown.amount_mmk,
    bankName: bank.bankName,
    accountName: bank.accountName,
    accountNumber: bank.accountNumber,
  });

  await debitUsdt(userId, breakdown.amount_usdt, {
    description: `USDT→Bank withdrawal ${refCode} — ${formatMmk(breakdown.amount_mmk)} to ${bank.bankName} (fee ${formatUsdt(breakdown.fee_usdt)})`,
    referenceType: 'usdt_withdrawal',
    referenceId: withdrawal.id,
    createdBy: 'user',
    metadata: {
      purpose: 'usdt_bank_withdrawal',
      payout_method: 'bank',
      ref_code: refCode,
      fee_usdt: breakdown.fee_usdt,
      net_usdt: breakdown.net_usdt,
      exchange_rate: breakdown.exchange_rate,
      amount_mmk: breakdown.amount_mmk,
      bank_name: bank.bankName,
    },
  });

  if (breakdown.fee_usdt > 0) {
    try {
      await creditPlatformUsdtRevenue(breakdown.fee_usdt, {
        feeType: PLATFORM_FEE_TYPES.WITHDRAWAL,
        description: `USDT→Bank withdrawal fee — ${refCode} (${formatUsdt(breakdown.fee_usdt)})`,
        referenceType: 'usdt_withdrawal_requests',
        referenceId: withdrawal.id,
        relatedUserId: userId,
        metadata: {
          payout_method: 'bank',
          ref_code: refCode,
          fee_type: breakdown.fee_type,
          amount_mmk: breakdown.amount_mmk,
          exchange_rate: breakdown.exchange_rate,
        },
      });
    } catch (feeErr) {
      console.warn('[withdrawal] platform bank withdrawal fee credit failed:', feeErr.message);
    }
  }

  return {
    withdrawal,
    breakdown,
    message: `Withdrawal ${refCode} submitted. ${formatMmk(breakdown.amount_mmk)} will be transferred to your ${bank.bankName} account after processing (rate 1 USDT = ${Number(breakdown.exchange_rate).toLocaleString()} MMK).`,
  };
}

async function createMmkBankWithdrawalRequest(userId, body = {}) {
  const bank = validateBankDetails(body);
  const requestedAmount = Math.round(parseFloat(body.amount_mmk) || 0);
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    throw new Error('Enter a valid MMK withdrawal amount');
  }

  const settings = await getWithdrawalFeeSettings();
  const breakdown = calculateMmkWithdrawalBreakdown(requestedAmount, settings);

  if (breakdown.below_minimum) {
    throw new Error(
      `Minimum MMK withdrawal is ${Math.round(breakdown.minimum_mmk_withdrawal).toLocaleString()} MMK`
    );
  }
  if (breakdown.invalid_net) {
    throw new Error('Amount too small after fee — increase the MMK amount');
  }

  const refCode = await uniqueRefCode('mmk_withdrawal_requests', 'WM');

  const withdrawal = await MmkWithdrawal.create({
    userId,
    refCode,
    amountMmk: breakdown.amount_mmk,
    feeMmk: breakdown.fee_mmk,
    netMmk: breakdown.net_mmk,
    feePercent: breakdown.fee_percent,
    bankName: bank.bankName,
    accountName: bank.accountName,
    accountNumber: bank.accountNumber,
  });

  await debitMmk(userId, breakdown.amount_mmk, {
    description: `MMK bank withdrawal ${refCode} — ${formatMmk(breakdown.net_mmk)} to ${bank.bankName}`,
    referenceType: 'mmk_withdrawal',
    referenceId: withdrawal.id,
    createdBy: 'user',
    metadata: {
      purpose: 'mmk_bank_withdrawal',
      ref_code: refCode,
      fee_mmk: breakdown.fee_mmk,
      net_mmk: breakdown.net_mmk,
      bank_name: bank.bankName,
    },
  });

  return {
    withdrawal,
    breakdown,
    message: `Withdrawal ${refCode} submitted. ${formatMmk(breakdown.net_mmk)} will be transferred to your ${bank.bankName} account after processing.`,
  };
}

async function processUsdtTrc20Withdrawal(row) {
  if (!row) {
    throw new Error('USDT withdrawal not found');
  }

  const network = normalizeNetwork(row.network);
  const payoutMethod = normalizePayoutMethod(row.payout_method || 'crypto');

  // MMK wallet / conversion is never part of TRC20 master-wallet payouts.
  if (payoutMethod === 'bank' || network === 'BANK') {
    const err = new Error(
      'Bank / MMK payouts are not sent from the TRON master wallet. '
      + 'Complete bank transfers manually. MMK → USDT conversion remains forbidden.'
    );
    err.code = 'MMK_WALLET_RESTRICTED';
    throw err;
  }
  if (network !== 'TRC20') {
    const err = new Error(
      `Automatic master-wallet payout supports TRC20 only (got ${network || 'unknown'}). `
      + 'Provide a tx_hash for other networks.'
    );
    err.code = 'NETWORK_NOT_SUPPORTED';
    throw err;
  }

  const netUsdt = Number(row.net_usdt);
  if (!Number.isFinite(netUsdt) || netUsdt <= 0) {
    throw new Error('Withdrawal net USDT amount is invalid');
  }
  if (!row.wallet_address) {
    throw new Error('Withdrawal is missing destination wallet address');
  }

  // Transfer USDT TRC20 from master wallet (manual energy; MASTER_PRIVATE_KEY from env).
  const transfer = await transferUsdtTrc20({
    toAddress: row.wallet_address,
    amountUsdt: netUsdt,
  });

  return {
    txId: transfer.txId,
    fromAddress: transfer.fromAddress,
    toAddress: transfer.toAddress,
    amountUsdt: transfer.amountUsdt,
    network: 'TRC20',
    currency: 'USDT',
    note: `On-chain TRC20 transfer from master wallet (${transfer.fromAddress})`,
  };
}

async function completeUsdtWithdrawal(id, { adminNote, txHash, adminId, skipOnChain } = {}) {
  const row = await UsdtWithdrawal.findById(id);
  if (!row) throw new Error('USDT withdrawal not found');
  if (!['pending', 'processing'].includes(row.status)) {
    throw new Error(`Cannot complete withdrawal in status "${row.status}"`);
  }

  let resolvedTxHash = txHash ? String(txHash).trim() : null;
  let note = adminNote || null;

  const network = normalizeNetwork(row.network);

  const shouldSendOnChain = !skipOnChain
    && row.payout_method === 'crypto'
    && network === 'TRC20'
    && !resolvedTxHash;

  if (shouldSendOnChain) {
    // Mark processing so concurrent completes do not double-send.
    await UsdtWithdrawal.updateStatus(id, {
      status: 'processing',
      adminNote: note || 'Broadcasting TRC20 USDT from master wallet (manual energy)…',
      processedBy: adminId || null,
    });

    try {
      const transfer = await processUsdtTrc20Withdrawal(row);
      resolvedTxHash = transfer.txId;
      note = note || transfer.note;
    } catch (err) {
      await UsdtWithdrawal.updateStatus(id, {
        status: 'pending',
        adminNote: `On-chain transfer failed: ${err.message}`,
        processedBy: adminId || null,
      });
      throw err;
    }
  }

  return UsdtWithdrawal.updateStatus(id, {
    status: 'completed',
    adminNote: note || (row.payout_method === 'bank'
      ? 'Bank transfer completed'
      : 'On-chain transfer completed'),
    txHash: resolvedTxHash || null,
    processedBy: adminId || null,
  });
}

async function rejectUsdtWithdrawal(id, { adminNote, adminId } = {}) {
  const row = await UsdtWithdrawal.findById(id);
  if (!row) throw new Error('USDT withdrawal not found');
  if (!['pending', 'processing'].includes(row.status)) {
    throw new Error(`Cannot reject withdrawal in status "${row.status}"`);
  }

  const note = adminNote || 'Rejected by admin — balance refunded';
  const updated = await UsdtWithdrawal.updateStatus(id, {
    status: 'rejected',
    adminNote: note,
    processedBy: adminId || null,
  });

  const amount = Number(row.amount_usdt) || 0;
  if (amount > 0) {
    await creditUsdt(row.user_id, amount, {
      description: `USDT withdrawal ${row.ref_code} rejected — ${formatUsdt(amount)} refunded`,
      referenceType: 'usdt_withdrawal',
      referenceId: row.id,
      createdBy: 'admin',
      metadata: {
        purpose: 'usdt_withdrawal_refund',
        refund: true,
        ref_code: row.ref_code,
        payout_method: row.payout_method,
      },
    });
  }

  if (Number(row.fee_usdt) > 0) {
    await reversePlatformUsdtFee(row.fee_usdt, {
      description: `Reversed fee for rejected withdrawal ${row.ref_code}`,
      referenceType: 'usdt_withdrawal_requests',
      referenceId: row.id,
    });
  }

  return updated;
}

async function completeMmkWithdrawal(id, { adminNote, adminId } = {}) {
  const row = await MmkWithdrawal.findById(id);
  if (!row) throw new Error('MMK withdrawal not found');
  if (!['pending', 'processing'].includes(row.status)) {
    throw new Error(`Cannot complete withdrawal in status "${row.status}"`);
  }

  return MmkWithdrawal.updateStatus(id, {
    status: 'completed',
    adminNote: adminNote || 'Bank transfer completed',
    processedBy: adminId || null,
  });
}

async function rejectMmkWithdrawal(id, { adminNote, adminId } = {}) {
  const row = await MmkWithdrawal.findById(id);
  if (!row) throw new Error('MMK withdrawal not found');
  if (!['pending', 'processing'].includes(row.status)) {
    throw new Error(`Cannot reject withdrawal in status "${row.status}"`);
  }

  const note = adminNote || 'Rejected by admin — balance refunded';
  const updated = await MmkWithdrawal.updateStatus(id, {
    status: 'rejected',
    adminNote: note,
    processedBy: adminId || null,
  });

  const amount = Number(row.amount_mmk) || 0;
  if (amount > 0) {
    await creditMmk(row.user_id, amount, {
      description: `MMK withdrawal ${row.ref_code} rejected — ${formatMmk(amount)} refunded`,
      referenceType: 'mmk_withdrawal',
      referenceId: row.id,
      createdBy: 'admin',
      metadata: {
        purpose: 'mmk_withdrawal_refund',
        refund: true,
        ref_code: row.ref_code,
      },
    });
  }

  return updated;
}

/** Explicit policy guard — never allow internal MMK→USDT conversion. */
function assertMmkToUsdtForbidden() {
  const err = new Error(
    'MMK to USDT conversion is not allowed on this platform. '
    + 'You may withdraw MMK to your bank account, or buy USDT via P2P using an external payment method.'
  );
  err.code = 'MMK_TO_USDT_FORBIDDEN';
  throw err;
}

module.exports = {
  createUsdtWithdrawalRequest,
  createMmkBankWithdrawalRequest,
  processUsdtTrc20Withdrawal,
  completeUsdtWithdrawal,
  rejectUsdtWithdrawal,
  completeMmkWithdrawal,
  rejectMmkWithdrawal,
  assertMmkToUsdtForbidden,
  normalizeNetwork,
  normalizePayoutMethod,
  validateWalletAddress,
  validateBankDetails,
  payoutCurrencySupported,
};
