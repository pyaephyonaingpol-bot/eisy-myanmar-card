const Card = require('../models/Card');
const User = require('../models/User');
const DepositRequest = require('../models/DepositRequest');
const TransactionLog = require('../models/TransactionLog');
const { getDb } = require('../db');
const { parseRecordMetadata } = require('./settingsService');
const { mapCardForAdmin } = require('./cardBalanceService');
const { recordPlatformUsdFee, PLATFORM_FEE_TYPES } = require('./platformRevenueService');
const { withWriteTransaction, safeRollback } = require('../lib/dbTransactions');

function generateCardNumber() {
  const digits = '4532' + String(Math.floor(100000000000 + Math.random() * 900000000000));
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

function generateExpDate() {
  const now = new Date();
  const month = String(((now.getMonth() + 1) % 12) + 1).padStart(2, '0');
  const year = String(now.getFullYear() + 3).slice(-2);
  return `${month}/${year}`;
}

function generateCvv() {
  return String(Math.floor(100 + Math.random() * 900));
}

async function verifyCardIssuanceDeposit(deposit, { adminNote, reviewedByAdminId, createdBy = 'admin' } = {}) {
  if (!deposit) return null;
  if (deposit.status === 'VERIFIED') return deposit;

  if (['REJECTED', 'FAILED', 'CANCELLED'].includes(deposit.status)) {
    throw new Error(`Linked deposit ${deposit.ref_code} is ${deposit.status} and cannot be approved`);
  }

  const db = getDb();
  try {
    await withWriteTransaction(db, async () => {
      await DepositRequest.review(deposit.id, {
        status: 'VERIFIED',
        adminNote: adminNote || 'Approved with card activation',
        reviewedByAdminId,
      });
    });
  } catch (err) {
    await safeRollback(db);
    throw err;
  }

  const updated = await DepositRequest.findById(deposit.id);

  try {
    await TransactionLog.create({
      userId: deposit.user_id,
      type: 'deposit_verified',
      direction: 'neutral',
      amountMmk: deposit.amount_mmk,
      amountUsd: deposit.amount_usd,
      referenceType: 'deposit_requests_v2',
      referenceId: deposit.id,
      description: `Card issuance deposit verified: ${deposit.ref_code} (funds allocated to card on activation)`,
      createdBy,
      metadata: {
        purpose: 'card_issuance',
        admin_note: adminNote,
        wallet_credit_skipped: true,
      },
    });
  } catch (logErr) {
    console.warn('[cardApproval] deposit verify log failed:', logErr.message);
  }

  console.log('[cardApproval] Deposit verified for card issuance:', deposit.ref_code, 'id=', deposit.id);
  return updated;
}

async function syncLegacyCardRow(userId, cardNumber, expDate, cvv, holderName) {
  const db = getDb();
  const existing = await db.get('SELECT id FROM cards WHERE user_id = ?', userId);
  if (!existing) {
    await db.run(
      `INSERT INTO cards (user_id, card_number, exp_date, cvv, card_holder_name) VALUES (?, ?, ?, ?, ?)`,
      userId, cardNumber, expDate, cvv, holderName
    );
  } else {
    await db.run(
      `UPDATE cards SET card_number = ?, exp_date = ?, cvv = ?, card_holder_name = ? WHERE user_id = ?`,
      cardNumber, expDate, cvv, holderName, userId
    );
  }
}

/**
 * Activate a pending card request: verify linked deposit, assign details, set status active.
 */
async function approvePendingCardRequest(cardId, options = {}) {
  const {
    adminNotes,
    cardNumber,
    expDate,
    cvv,
    balanceUsd: balanceOverride,
    cardHolderName,
    reviewedByAdminId,
    createdBy = 'admin',
    skipDepositVerify = false,
  } = options;

  console.log('[cardApproval] Starting approval for card id=', cardId);

  const card = await Card.findById(cardId);
  if (!card) {
    throw new Error('Card not found');
  }

  const user = await User.findById(card.user_id);
  if (!user) throw new Error('User not found');

  if (card.status === 'active') {
    console.log('[cardApproval] Card already active — id=', cardId);
    return {
      card: mapCardForAdmin(card, user),
      deposit: null,
      user: { id: user.id, name: user.name, email: user.email },
      alreadyActive: true,
    };
  }

  if (card.status !== 'pending') {
    throw new Error(`Card is not pending (current status: ${card.status})`);
  }

  const meta = parseRecordMetadata(card.metadata);

  let deposit = null;
  if (meta.deposit_id) {
    deposit = await DepositRequest.findById(meta.deposit_id);
  } else if (meta.deposit_ref) {
    deposit = await DepositRequest.findByRefCode(meta.deposit_ref);
  }

  if (!skipDepositVerify && deposit && deposit.status !== 'VERIFIED') {
    await verifyCardIssuanceDeposit(deposit, {
      adminNote: adminNotes || 'Approved with card activation',
      reviewedByAdminId,
      createdBy,
    });
    deposit = await DepositRequest.findById(deposit.id);
  } else if (deposit?.status === 'VERIFIED') {
    console.log('[cardApproval] Linked deposit already verified:', deposit.ref_code);
  }

  const pricing = meta.pricing || {};
  const balanceUsd = balanceOverride != null && Number.isFinite(parseFloat(balanceOverride))
    ? parseFloat(balanceOverride)
    : (pricing.initial_load_usd != null
      ? parseFloat(pricing.initial_load_usd)
      : (deposit ? Math.max(0, parseFloat(deposit.amount_usd) - (pricing.issuance_fee_usd || 0)) : 0));

  const finalNumber = (cardNumber || generateCardNumber()).trim();
  const finalExp = (expDate || generateExpDate()).trim();
  const finalCvv = (cvv || generateCvv()).trim();
  const holder = cardHolderName || card.card_holder_name || user.name;

  console.log('[cardApproval] Activating card', cardId, 'balance=$' + balanceUsd.toFixed(2));

  const updated = await Card.activatePendingCard(cardId, {
    cardNumber: finalNumber,
    expDate: finalExp,
    cvv: finalCvv,
    cardHolderName: holder,
    adminNotes: adminNotes || 'Approved and activated by admin',
    adminId: reviewedByAdminId,
    balanceUsd,
  });

  if (!updated) {
    throw new Error('Failed to activate card');
  }

  if (updated.status !== 'active') {
    console.error('[cardApproval] Status mismatch after activation — expected active, got', updated.status);
    await Card.updateStatus(cardId, 'active', { adminNotes: adminNotes || 'Force activated' });
  }

  const activated = await Card.findById(cardId);
  console.log('[cardApproval] Card activated:', activated.id, 'status=', activated.status);

  await Card.setPrimary(cardId, card.user_id).catch((err) => {
    console.warn('[cardApproval] setPrimary failed:', err.message);
  });

  await syncLegacyCardRow(card.user_id, finalNumber, finalExp, finalCvv, holder);

  try {
    await TransactionLog.create({
      userId: card.user_id,
      type: 'card_issued',
      direction: 'neutral',
      amountUsd: balanceUsd,
      referenceType: 'cards_v2',
      referenceId: cardId,
      description: `Pending card approved — ending ${String(finalNumber).replace(/\s/g, '').slice(-4)}`,
      createdBy,
      metadata: {
        deposit_id: deposit?.id || meta.deposit_id || null,
        deposit_ref: deposit?.ref_code || meta.deposit_ref || null,
        pricing,
        fee_type: PLATFORM_FEE_TYPES.CARD_ISSUE,
      },
    });
  } catch (logErr) {
    console.warn('[cardApproval] card_issued log failed:', logErr.message);
  }

  const issuanceFeeUsd = Number(pricing.issuance_fee_usd);
  if (Number.isFinite(issuanceFeeUsd) && issuanceFeeUsd > 0) {
    try {
      await recordPlatformUsdFee(issuanceFeeUsd, {
        feeType: PLATFORM_FEE_TYPES.CARD_ISSUE,
        description: `Card issuance fee — CARD-${cardId} ($${issuanceFeeUsd.toFixed(2)})`,
        referenceType: 'cards_v2',
        referenceId: cardId,
        relatedUserId: card.user_id,
        createdBy,
        metadata: {
          deposit_id: deposit?.id || meta.deposit_id || null,
          deposit_ref: deposit?.ref_code || meta.deposit_ref || null,
          pricing,
        },
      });
    } catch (feeErr) {
      console.warn('[cardApproval] platform fee record failed:', feeErr.message);
    }
  }

  const last4 = String(finalNumber).replace(/\s/g, '').slice(-4);
  try {
    await TransactionLog.create({
      userId: card.user_id,
      type: 'card_updated',
      direction: 'neutral',
      amountUsd: balanceUsd,
      referenceType: 'cards_v2',
      referenceId: cardId,
      description: `Your virtual card is now ACTIVE — ending ${last4}. Initial balance: $${balanceUsd.toFixed(2)} USD`,
      createdBy,
      metadata: {
        notification: 'card_issued',
        card_id: cardId,
        status: 'ACTIVE',
        last4,
      },
    });
  } catch (logErr) {
    console.warn('[cardApproval] card_updated notification log failed:', logErr.message);
  }

  return {
    card: mapCardForAdmin(activated, user),
    deposit,
    user: { id: user.id, name: user.name, email: user.email },
  };
}

module.exports = {
  approvePendingCardRequest,
  verifyCardIssuanceDeposit,
  generateCardNumber,
  generateExpDate,
  generateCvv,
};
