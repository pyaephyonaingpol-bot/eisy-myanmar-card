const Card = require('../models/Card');
const TransactionLog = require('../models/TransactionLog');
const { normalizeCardStatus, displayStatusLabel } = require('../constants/cardStatuses');

function parseCardMetadata(card) {
  try {
    return card.metadata ? JSON.parse(card.metadata) : {};
  } catch (_) {
    return {};
  }
}

function getCardBalance(card) {
  const meta = parseCardMetadata(card);
  return Number(meta.balance_usd ?? 0);
}

function cardLast4(card) {
  const digits = String(card.card_number || '').replace(/\s/g, '');
  return digits.length >= 4 ? digits.slice(-4) : '????';
}

function mapCardForAdmin(card, user) {
  const balance = getCardBalance(card);
  return {
    id: card.id,
    user_id: card.user_id,
    user_name: user?.name,
    user_email: user?.email,
    card_number: card.card_number,
    exp_date: card.exp_date,
    cvv: card.cvv,
    card_holder_name: card.card_holder_name,
    status: card.status,
    display_status: displayStatusLabel(card.status),
    status_reason: card.status_reason || null,
    admin_notes: card.admin_notes || null,
    is_primary: Boolean(card.is_primary),
    balance_usd: balance,
    last4: cardLast4(card),
    label: card.status === 'pending'
      ? 'Pending request'
      : `•••• ${cardLast4(card)}${card.is_primary ? ' (Primary)' : ''}`,
    created_at: card.created_at,
  };
}

async function applyCardTransaction(cardId, {
  action,
  amount_usd: amountUsd,
  merchant,
  note,
  createdBy = 'admin',
}) {
  const amount = parseFloat(amountUsd);
  if (!amount || amount <= 0 || Number.isNaN(amount)) {
    throw new Error('Positive amount_usd is required');
  }

  const normalized = String(action || '').toLowerCase();
  if (!['topup', 'top-up', 'credit', 'spend', 'deduct', 'debit', 'purchase'].includes(normalized)) {
    throw new Error('action must be topup or spend/purchase/deduct');
  }

  const isCredit = ['topup', 'top-up', 'credit'].includes(normalized);
  const isDebit = !isCredit;

  const existing = await Card.findById(cardId);
  if (!existing) throw new Error('Card not found');
  if (existing.status === 'pending') {
    throw new Error('Cannot transact on a pending card');
  }
  if (normalizeCardStatus(existing.status) !== 'active') {
    throw new Error(`Card is ${displayStatusLabel(existing.status)} — only active cards can be transacted`);
  }

  const balanceBefore = getCardBalance(existing);
  const balanceAfter = isCredit ? balanceBefore + amount : balanceBefore - amount;

  if (isDebit && balanceAfter < 0) {
    throw new Error(`Insufficient card balance ($${balanceBefore.toFixed(2)} available)`);
  }

  const card = await Card.updateCardDetails(cardId, {
    balanceUsd: balanceAfter,
    adminNotes: note || existing.admin_notes,
  });

  const last4 = cardLast4(existing);
  let description;
  let logType;

  if (isCredit) {
    logType = 'card_topup';
    description = `Card Top-Up - $${amount.toFixed(2)}`;
    if (note) description += ` (${note})`;
  } else {
    logType = 'card_transaction';
    const merchantPart = merchant ? ` at ${merchant}` : '';
    description = `Card Transaction / Purchase - $${amount.toFixed(2)}${merchantPart}`;
    if (note) description += ` — ${note}`;
  }

  const transaction = await TransactionLog.create({
    userId: existing.user_id,
    type: logType,
    direction: isCredit ? 'credit' : 'debit',
    amountUsd: amount,
    balanceBefore,
    balanceAfter,
    referenceType: 'cards_v2',
    referenceId: cardId,
    description,
    createdBy,
    metadata: {
      action: normalized,
      merchant: merchant || null,
      note: note || null,
      card_last4: last4,
      card_id: cardId,
    },
  });

  return {
    card: mapCardForAdmin(card, null),
    transaction,
    balance_before: balanceBefore,
    balance_after: balanceAfter,
    amount,
    action: isCredit ? 'topup' : 'spend',
  };
}

module.exports = {
  getCardBalance,
  parseCardMetadata,
  mapCardForAdmin,
  cardLast4,
  applyCardTransaction,
};
