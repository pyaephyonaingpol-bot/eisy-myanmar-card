const Card = require('../models/Card');
const TransactionLog = require('../models/TransactionLog');
const {
  CARD_STATUS,
  ADMIN_SETTABLE_STATUSES,
  normalizeCardStatus,
  displayStatusLabel,
  isPendingCardRecord,
} = require('../constants/cardStatuses');
const { mapCardForAdmin } = require('./cardBalanceService');

function assertAdminSettableStatus(status) {
  const normalized = normalizeCardStatus(status);
  if (!ADMIN_SETTABLE_STATUSES.includes(normalized)) {
    throw new Error(`status must be one of: ${ADMIN_SETTABLE_STATUSES.join(', ')}`);
  }
  return normalized;
}

async function updateCardLifecycleStatus(cardId, {
  status,
  statusReason,
  adminNotes,
  reviewedBy = 'admin',
} = {}) {
  const nextStatus = assertAdminSettableStatus(status);
  const card = await Card.findById(cardId);
  if (!card) throw new Error('Card not found');
  if (isPendingCardRecord(card)) {
    throw new Error('Cannot change lifecycle status on a pending card request — issue the card first');
  }

  const prevStatus = normalizeCardStatus(card.status);
  if (prevStatus === nextStatus && !statusReason && !adminNotes) {
    return { card: await Card.findById(cardId), unchanged: true };
  }

  const updated = await Card.updateStatus(cardId, nextStatus, {
    adminNotes: adminNotes || card.admin_notes,
    statusReason: statusReason || null,
    adminId: null,
  });

  await TransactionLog.create({
    userId: card.user_id,
    type: nextStatus === CARD_STATUS.FROZEN ? 'card_frozen'
      : nextStatus === CARD_STATUS.TERMINATED ? 'card_cancelled'
        : 'card_updated',
    direction: 'neutral',
    referenceType: 'card',
    referenceId: cardId,
    description: `Virtual card status changed to ${displayStatusLabel(nextStatus)}`,
    metadata: {
      card_id: cardId,
      previous_status: prevStatus,
      new_status: nextStatus,
      status_reason: statusReason || null,
    },
    createdBy: reviewedBy,
  });

  return { card: updated, previous_status: prevStatus, new_status: nextStatus };
}

async function listIssuedCardsForAdmin() {
  const rows = await Card.listIssuedCards();
  return rows.map((c) => {
    const user = { id: c.user_id, name: c.name, email: c.email };
    return {
      ...mapCardForAdmin(c, user),
      display_status: displayStatusLabel(c.status),
      status_reason: c.status_reason || null,
      phone: c.phone || null,
    };
  });
}

module.exports = {
  updateCardLifecycleStatus,
  listIssuedCardsForAdmin,
  assertAdminSettableStatus,
};
