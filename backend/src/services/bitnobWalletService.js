/**
 * Bitnob (Standard Card) wallet — deposit addresses + user ledger.
 *
 * Strict separation from Master Wallet:
 *   - Instant Card (Non-KYC)  → Master/HD TRON → users.balance_usdt → Kripicard
 *   - Standard Card (KYC)     → Bitnob address → users.balance_bitnob_usdt → Bitnob cards
 */

const path = require('path');
const crypto = require('crypto');
const { getDb } = require('../db');
const User = require('../models/User');
const { normalizeKycStatus, isKycVerified } = require('./kycService');
const {
  resolveBitnobCustomerId,
  assertBitnobConfigured,
} = require('./cardIssueService');
const {
  getBitnobUsdtBalance,
  creditBitnobUsdt,
  formatBitnobUsdt,
  generateJournalId,
} = require('./bitnobWalletLedgerService');

const bitnob = require(path.join(__dirname, '../../../lib/bitnob'));

function depositChain() {
  return String(process.env.BITNOB_DEPOSIT_CHAIN || 'tron').trim().toLowerCase() || 'tron';
}

async function assertKycForStandardWallet(userId) {
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.code = 'USER_NOT_FOUND';
    throw err;
  }
  const status = normalizeKycStatus(user.kyc_status);
  if (!isKycVerified(status)) {
    const err = new Error(
      'Standard Card wallet requires KYC verification. Use Instant Card (No KYC) with the Master Wallet instead.'
    );
    err.code = 'KYC_REQUIRED_FOR_BITNOB';
    err.kyc_status = status;
    throw err;
  }
  return user;
}

async function persistBitnobCustomerId(userId, customerId) {
  if (!customerId) return;
  const db = getDb();
  await db.run(
    `UPDATE users SET bitnob_customer_id = ?, updated_at = datetime('now') WHERE id = ?`,
    String(customerId).trim(),
    userId
  );
}

async function resolveCustomerForUser(user) {
  const customerId = resolveBitnobCustomerId({ user });
  if (customerId && !user.bitnob_customer_id) {
    try {
      await persistBitnobCustomerId(user.id, customerId);
    } catch (err) {
      console.warn('[bitnobWallet] persist customer id failed:', err.message);
    }
  }
  return customerId;
}

/**
 * Return (or create) a Bitnob deposit address for a KYC user.
 * Funds received here stay on Bitnob — never Master Wallet.
 */
async function getOrCreateStandardDepositAddress(userId, { forceRefresh = false } = {}) {
  assertBitnobConfigured();
  const user = await assertKycForStandardWallet(userId);
  const customerId = await resolveCustomerForUser(user);

  if (!forceRefresh && user.bitnob_deposit_address) {
    return {
      provider: 'bitnob',
      ledger: 'bitnob',
      wallet: 'bitnob_usdt',
      address: user.bitnob_deposit_address,
      chain: user.bitnob_deposit_chain || depositChain(),
      address_id: user.bitnob_deposit_address_id || null,
      reference: user.bitnob_deposit_reference || null,
      customer_id: customerId || user.bitnob_customer_id || null,
      customer_ready: Boolean(customerId),
      reused: true,
    };
  }

  const email = String(user.email || '').trim().toLowerCase();
  const reference = `eisy-u${userId}-${crypto.randomBytes(3).toString('hex')}`;
  const generated = await bitnob.generateDepositAddress({
    chain: depositChain(),
    customerEmail: email || undefined,
    label: `Eisy Business Card u${userId}`,
    reference,
  });

  const address = String(generated.address || '').trim();
  if (!address) {
    const err = new Error('Bitnob did not return a deposit address');
    err.code = 'BITNOB_ADDRESS_MISSING';
    throw err;
  }

  const db = getDb();
  await db.run(
    `UPDATE users SET
      bitnob_deposit_address = ?,
      bitnob_deposit_chain = ?,
      bitnob_deposit_address_id = ?,
      bitnob_deposit_reference = ?,
      updated_at = datetime('now')
     WHERE id = ?`,
    address,
    generated.chain || depositChain(),
    generated.id || null,
    generated.reference || reference,
    userId
  );

  return {
    provider: 'bitnob',
    ledger: 'bitnob',
    wallet: 'bitnob_usdt',
    address,
    chain: generated.chain || depositChain(),
    address_id: generated.id || null,
    reference: generated.reference || reference,
    customer_id: customerId || null,
    customer_ready: Boolean(customerId),
    reused: false,
  };
}

async function getDualWalletOverview(userId) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const kycStatus = normalizeKycStatus(user.kyc_status);
  const kycVerified = isKycVerified(kycStatus);
  const { getBitnobKycPublicStatus } = require('./bitnobKycService');
  const bitnobKyc = getBitnobKycPublicStatus(user);
  const customerId = bitnobKyc.customer_id || resolveBitnobCustomerId({ user });
  const masterUsdt = Number(user.balance_usdt ?? 0);
  const bitnobUsdt = Number(user.balance_bitnob_usdt ?? 0);

  return {
    instant: {
      card_type: 'instant',
      provider: 'kripicard',
      requires_kyc: false,
      ledger: 'master_wallet',
      wallet: 'usdt',
      balance_usdt: masterUsdt,
      usdt_formatted: `$ ${masterUsdt.toFixed(2)} USDT`,
      deposit_path: 'master_wallet_trc20',
      deposit_hint: 'Deposit USDT (TRC20) to your Master Wallet address. Balance funds Instant Card only.',
    },
    standard: {
      card_type: 'standard',
      provider: 'bitnob',
      requires_kyc: true,
      ledger: 'bitnob',
      wallet: 'bitnob_usdt',
      balance_usdt: bitnobUsdt,
      usdt_formatted: formatBitnobUsdt(bitnobUsdt),
      kyc_status: kycStatus,
      is_kyc_verified: kycVerified,
      customer_id: customerId || null,
      customer_ready: Boolean(bitnobKyc.customer_ready),
      bitnob_kyc_status: bitnobKyc.bitnob_kyc_status,
      bitnob_kyc_reason: bitnobKyc.bitnob_kyc_reason,
      can_issue_standard_card: Boolean(bitnobKyc.can_issue_standard_card),
      deposit_path: 'bitnob_address',
      deposit_address: user.bitnob_deposit_address || null,
      deposit_chain: user.bitnob_deposit_chain || depositChain(),
      deposit_hint: kycVerified
        ? (bitnobKyc.customer_ready
          ? 'Deposit USDT to your Standard Card (Bitnob) address. This balance is separate from Master Wallet.'
          : 'KYC verified — Bitnob Card KYC is still pending. You can deposit after Card KYC completes.')
        : 'Complete KYC to unlock Standard Card deposits via Bitnob.',
    },
    separation: {
      master_wallet_funds_instant_only: true,
      bitnob_wallet_funds_standard_only: true,
      cross_ledger_card_payments: false,
    },
    bitnob_kyc: bitnobKyc,
  };
}

/**
 * Credit Standard Card ledger from a Bitnob deposit webhook / admin action.
 * Idempotent on event_id.
 */
async function creditStandardWalletFromDeposit(userId, {
  amountUsdt,
  eventId,
  address,
  chain,
  txHash,
  rawPayload,
  createdBy = 'bitnob_webhook',
} = {}) {
  const amount = Number(amountUsdt);
  if (!Number.isFinite(amount) || amount <= 0) {
    const err = new Error('Deposit amount must be positive');
    err.code = 'INVALID_AMOUNT';
    throw err;
  }

  const db = getDb();
  const eid = String(eventId || txHash || generateJournalId('BNDEP')).trim();

  const existing = await db.get(
    'SELECT * FROM bitnob_deposit_events WHERE event_id = ?',
    eid
  );
  if (existing?.credited) {
    return {
      already_credited: true,
      balance_bitnob_usdt: await getBitnobUsdtBalance(userId),
      event_id: eid,
    };
  }

  if (!existing) {
    await db.run(
      `INSERT INTO bitnob_deposit_events (
        event_id, user_id, address, chain, amount_usdt, tx_hash, status, raw_payload, credited
      ) VALUES (?, ?, ?, ?, ?, ?, 'received', ?, 0)`,
      eid,
      userId,
      address || null,
      chain || null,
      amount,
      txHash || null,
      rawPayload ? JSON.stringify(rawPayload) : null
    );
  }

  const journalId = `bitnob-dep-${eid}`;
  const updated = await creditBitnobUsdt(userId, amount, {
    journalId,
    purpose: 'bitnob_deposit',
    description: `Standard Card wallet deposit — ${formatBitnobUsdt(amount)}`,
    referenceType: 'bitnob_deposit_events',
    referenceId: eid,
    createdBy,
    metadata: {
      address: address || null,
      chain: chain || null,
      tx_hash: txHash || null,
      ledger: 'bitnob',
    },
  });

  await db.run(
    `UPDATE bitnob_deposit_events SET credited = 1, status = 'credited', user_id = ? WHERE event_id = ?`,
    userId,
    eid
  );

  return {
    already_credited: false,
    balance_bitnob_usdt: Number(updated.balance_bitnob_usdt ?? 0),
    event_id: eid,
    amount_usdt: amount,
  };
}

async function findUserIdByBitnobDepositAddress(address) {
  const addr = String(address || '').trim();
  if (!addr) return null;
  const db = getDb();
  const row = await db.get(
    'SELECT id FROM users WHERE LOWER(TRIM(bitnob_deposit_address)) = LOWER(TRIM(?))',
    addr
  );
  return row?.id || null;
}

module.exports = {
  depositChain,
  assertKycForStandardWallet,
  getOrCreateStandardDepositAddress,
  getDualWalletOverview,
  creditStandardWalletFromDeposit,
  findUserIdByBitnobDepositAddress,
  getBitnobUsdtBalance,
};
