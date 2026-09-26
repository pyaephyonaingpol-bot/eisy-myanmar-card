/**
 * Bitnob virtual-card service (Express-facing).
 *
 * Wraps lib/bitnob.js and ties create/fund to the USDT wallet ledger:
 *   1. Debit the user's available USDT (1 USDT ≈ 1 USD for card load)
 *   2. Call Bitnob create / fund
 *   3. On Bitnob failure, credit the USDT back (refund)
 *
 * Sensitive PAN/CVV are never stored here — use getSecureCardDetails only
 * when the UI needs them, and discard after render.
 */

const path = require('path');
const crypto = require('crypto');

const bitnob = require(path.join(__dirname, '../../../lib/bitnob'));
const { debitUsdt, creditUsdt, formatUsdt } = require('./walletService');

function newReference(prefix = 'BN') {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}_${stamp}_${rand}`;
}

/**
 * Create a Bitnob virtual card after debiting the user's USDT wallet.
 *
 * Pricing model (USDT ≈ USD):
 *   debit = amountUsd (card load) + issuanceFeeUsdt (platform fee, optional)
 *   Bitnob create amount = amountUsd only (fee stays on platform)
 *
 * @param {string|number} userId
 * @param {{
 *   customerId: string,
 *   name: string,
 *   amountUsd: number,
 *   issuanceFeeUsdt?: number,
 *   currency?: string,
 *   reference?: string,
 *   webhookUrl?: string,
 *   contactlessPayment?: boolean,
 *   metadata?: object,
 *   skipWalletDebit?: boolean,
 * }} opts
 */
async function createVirtualCardFromUsdt(userId, opts = {}) {
  const {
    customerId,
    name,
    amountUsd,
    issuanceFeeUsdt = 0,
    currency = 'USD',
    reference,
    webhookUrl,
    contactlessPayment,
    metadata = {},
    skipWalletDebit = false,
  } = opts;

  const amountNum = Number(amountUsd);
  const feeNum = Number(issuanceFeeUsdt) || 0;
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    const err = new Error('amountUsd must be a positive number');
    err.code = 'INVALID_AMOUNT';
    throw err;
  }
  if (!Number.isFinite(feeNum) || feeNum < 0) {
    const err = new Error('issuanceFeeUsdt must be a non-negative number');
    err.code = 'INVALID_FEE';
    throw err;
  }

  const uid = String(userId);
  const ref = String(reference || newReference('BN_CREATE')).trim();
  const totalDebit = Math.round((amountNum + feeNum) * 1e6) / 1e6;
  const journalId = `bitnob-create-${ref}`;

  let debited = false;
  if (!skipWalletDebit) {
    await debitUsdt(uid, totalDebit, {
      description: `Bitnob card issue — ${formatUsdt(amountNum)} load`
        + (feeNum > 0 ? ` + ${formatUsdt(feeNum)} fee` : ''),
      createdBy: 'user',
      journalId,
      metadata: {
        purpose: 'bitnob_card_issuance',
        provider: 'bitnob',
        amount_usd: amountNum,
        issuance_fee_usdt: feeNum,
        reference: ref,
        wallet: 'usdt',
        ...metadata,
      },
    });
    debited = true;
  }

  try {
    const result = await bitnob.createVirtualCard({
      customerId,
      name,
      amountUsd: amountNum,
      currency,
      reference: ref,
      webhookUrl,
      contactlessPayment,
      createdBy: uid,
      extra: {
        user_metadata: JSON.stringify({
          eisy_user_id: uid,
          journal_id: journalId,
          ...metadata,
        }),
      },
    });

    return {
      provider: 'bitnob',
      wallet: {
        debited_usdt: skipWalletDebit ? 0 : totalDebit,
        load_usd: amountNum,
        issuance_fee_usdt: feeNum,
        journal_id: journalId,
        reference: ref,
      },
      card: result.card,
      request: result.request,
      raw: result.raw,
    };
  } catch (issueErr) {
    if (debited) {
      try {
        await creditUsdt(uid, totalDebit, {
          description: `Bitnob card issue refund — ${formatUsdt(totalDebit)} (provider failed)`,
          createdBy: 'system',
          journalId: `${journalId}-refund`,
          metadata: {
            purpose: 'bitnob_card_issuance_refund',
            provider: 'bitnob',
            reason: issueErr.message,
            code: issueErr.code || null,
            reference: ref,
          },
        });
        issueErr.refunded = true;
      } catch (refundErr) {
        console.error('[bitnob] USDT refund failed after create error:', refundErr);
        issueErr.refund_failed = true;
        issueErr.refund_error = refundErr.message;
      }
    }
    throw issueErr;
  }
}

/**
 * Fund an existing Bitnob card after debiting the user's USDT wallet.
 *
 * @param {string|number} userId
 * @param {{
 *   cardId: string,
 *   amountUsd: number,
 *   feeUsdt?: number,
 *   reference?: string,
 *   metadata?: object,
 *   skipWalletDebit?: boolean,
 * }} opts
 */
async function fundVirtualCardFromUsdt(userId, opts = {}) {
  const {
    cardId,
    amountUsd,
    feeUsdt = 0,
    reference,
    metadata = {},
    skipWalletDebit = false,
  } = opts;

  const amountNum = Number(amountUsd);
  const feeNum = Number(feeUsdt) || 0;
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    const err = new Error('amountUsd must be a positive number');
    err.code = 'INVALID_AMOUNT';
    throw err;
  }
  if (!Number.isFinite(feeNum) || feeNum < 0) {
    const err = new Error('feeUsdt must be a non-negative number');
    err.code = 'INVALID_FEE';
    throw err;
  }

  const uid = String(userId);
  const id = String(cardId || '').trim();
  if (!id) {
    const err = new Error('cardId is required');
    err.code = 'BITNOB_CARD_ID_REQUIRED';
    throw err;
  }

  const ref = String(reference || newReference('BN_FUND')).trim();
  const totalDebit = Math.round((amountNum + feeNum) * 1e6) / 1e6;
  const journalId = `bitnob-fund-${ref}`;

  let debited = false;
  if (!skipWalletDebit) {
    await debitUsdt(uid, totalDebit, {
      description: `Bitnob card fund — ${formatUsdt(amountNum)}`
        + (feeNum > 0 ? ` + ${formatUsdt(feeNum)} fee` : ''),
      createdBy: 'user',
      journalId,
      metadata: {
        purpose: 'bitnob_card_fund',
        provider: 'bitnob',
        card_id: id,
        amount_usd: amountNum,
        fee_usdt: feeNum,
        reference: ref,
        wallet: 'usdt',
        ...metadata,
      },
    });
    debited = true;
  }

  try {
    const result = await bitnob.fundCard({
      cardId: id,
      amountUsd: amountNum,
      reference: ref,
      type: 'fund',
    });

    return {
      provider: 'bitnob',
      wallet: {
        debited_usdt: skipWalletDebit ? 0 : totalDebit,
        fund_usd: amountNum,
        fee_usdt: feeNum,
        journal_id: journalId,
        reference: ref,
      },
      funding: result,
      // Funding is async at Bitnob — poll getCardDetails or wait for webhook.
      pending: String(result.status || 'pending').toLowerCase() !== 'completed',
    };
  } catch (fundErr) {
    if (debited) {
      try {
        await creditUsdt(uid, totalDebit, {
          description: `Bitnob card fund refund — ${formatUsdt(totalDebit)} (provider failed)`,
          createdBy: 'system',
          journalId: `${journalId}-refund`,
          metadata: {
            purpose: 'bitnob_card_fund_refund',
            provider: 'bitnob',
            card_id: id,
            reason: fundErr.message,
            code: fundErr.code || null,
            reference: ref,
          },
        });
        fundErr.refunded = true;
      } catch (refundErr) {
        console.error('[bitnob] USDT refund failed after fund error:', refundErr);
        fundErr.refund_failed = true;
        fundErr.refund_error = refundErr.message;
      }
    }
    throw fundErr;
  }
}

module.exports = {
  // Config / units
  getBitnobConfig: bitnob.getBitnobConfig,
  usdToMicrounits: bitnob.usdToMicrounits,
  microunitsToUsd: bitnob.microunitsToUsd,
  normalizeBitnobCard: bitnob.normalizeBitnobCard,
  newReference,

  // Direct Bitnob API (no wallet debit)
  createVirtualCard: bitnob.createVirtualCard,
  fundCard: bitnob.fundCard,
  getCardDetails: bitnob.getCardDetails,
  getSecureCardDetails: bitnob.getSecureCardDetails,
  validateAuth: bitnob.validateAuth,

  // USDT wallet–aware orchestration
  createVirtualCardFromUsdt,
  fundVirtualCardFromUsdt,
};
